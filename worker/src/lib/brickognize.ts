import type { Env } from '../types';

const BRICKOGNIZE_SETS_URL = 'https://api.brickognize.com/predict/sets/?top_k_items=3&min_similarity_items=0.3';
const BRICKOGNIZE_TIMEOUT_MS = 3_000;
const BRICKOGNIZE_ACCEPTED_CACHE_SECONDS = 30 * 24 * 60 * 60;
const BRICKOGNIZE_FALLBACK_CACHE_SECONDS = 24 * 60 * 60;
const BRICKOGNIZE_SCORE_MIN = 0.75;
const BRICKOGNIZE_MARGIN_MIN = 0.10;
const CIRCUIT_FAILURE_LIMIT = 3;
const CIRCUIT_OPEN_MS = 60_000;
const MAX_IMAGE_BYTES = 1_500_000;
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 8;

export type BrickognizePrediction = {
  id: string;
  name: string;
  type: string;
  score: number;
};

export type BrickognizeRunOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type BrickognizeOutcome =
  | { kind: 'accepted'; top: BrickognizePrediction; second?: BrickognizePrediction; cached: boolean }
  | { kind: 'fallback'; reason: 'disabled' | 'unsupported_image' | 'low_confidence' | 'ambiguous' | 'empty' | 'circuit_open'; cached: boolean }
  | { kind: 'error'; reason: 'timeout' | 'provider_error' | 'invalid_response'; message: string; cached: false };

type BrickognizeResponse = { items?: unknown };

type CircuitState = { failures: number; openedAt: number };
let circuit: CircuitState = { failures: 0, openedAt: 0 };

function enabled(env: Env): boolean {
  return env.BRICKOGNIZE_ENABLED !== '0';
}

function validPrediction(value: unknown): value is BrickognizePrediction {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string'
    && typeof item.name === 'string'
    && item.type === 'set'
    && typeof item.score === 'number'
    && Number.isFinite(item.score);
}

function base64Bytes(image: string): { bytes: Uint8Array; mime: string } | null {
  if (image.length > MAX_BASE64_CHARS + 40) return null;
  const match = image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  try {
    const binary = atob(match[2]);
    if (!binary.length || binary.length > MAX_IMAGE_BYTES) return null;
    return {
      bytes: Uint8Array.from(binary, char => char.charCodeAt(0)),
      mime: match[1].toLowerCase(),
    };
  } catch {
    return null;
  }
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function cacheKey(imageBytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', exactArrayBuffer(imageBytes));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return `scan:brickognize:v1:${hash}`;
}

function inspect(items: unknown, cached: boolean): BrickognizeOutcome {
  if (!Array.isArray(items)) return { kind: 'error', reason: 'invalid_response', message: 'Brickognize returned an invalid response.', cached: false };
  const predictions = items.filter(validPrediction);
  const top = predictions[0];
  if (!top) return { kind: 'fallback', reason: 'empty', cached };
  const second = predictions[1];
  if (top.score < BRICKOGNIZE_SCORE_MIN) return { kind: 'fallback', reason: 'low_confidence', cached };
  if (second && top.score - second.score < BRICKOGNIZE_MARGIN_MIN) return { kind: 'fallback', reason: 'ambiguous', cached };
  return { kind: 'accepted', top, second, cached };
}

function circuitOpen(now = Date.now()): boolean {
  if (circuit.failures < CIRCUIT_FAILURE_LIMIT) return false;
  if (now - circuit.openedAt < CIRCUIT_OPEN_MS) return true;
  circuit = { failures: 0, openedAt: 0 };
  return false;
}

function recordFailure(): void {
  circuit.failures += 1;
  if (circuit.failures >= CIRCUIT_FAILURE_LIMIT) circuit.openedAt = Date.now();
}

function recordSuccess(): void {
  circuit = { failures: 0, openedAt: 0 };
}

export async function identifySetWithBrickognize(
  env: Env,
  image: string,
  options: BrickognizeRunOptions = {},
): Promise<BrickognizeOutcome> {
  if (!enabled(env)) return { kind: 'fallback', reason: 'disabled', cached: false };
  if (circuitOpen()) return { kind: 'fallback', reason: 'circuit_open', cached: false };
  const decoded = base64Bytes(image);
  if (!decoded) return { kind: 'fallback', reason: 'unsupported_image', cached: false };

  const key = await cacheKey(decoded.bytes);
  if (env.CACHE_KV) {
    try {
      const cached = await env.CACHE_KV.get<BrickognizeResponse>(key, 'json');
      if (cached) return inspect(cached.items, true);
    } catch (error) {
      console.warn('[brickognize] cache read failed:', (error as Error).message);
    }
  }

  const form = new FormData();
  form.append('query_image', new Blob([exactArrayBuffer(decoded.bytes)], { type: decoded.mime }), `scan.${decoded.mime.split('/')[1]}`);
  const timeoutSignal = AbortSignal.timeout(Math.max(250, Math.min(options.timeoutMs ?? BRICKOGNIZE_TIMEOUT_MS, BRICKOGNIZE_TIMEOUT_MS)));
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  try {
    const response = await fetch(BRICKOGNIZE_SETS_URL, {
      method: 'POST',
      body: form,
      headers: { 'User-Agent': 'BricksVault/1.0 (+https://bricksvault.app)' },
      signal,
    });
    if (!response.ok) {
      recordFailure();
      return { kind: 'error', reason: 'provider_error', message: `Brickognize HTTP ${response.status}.`, cached: false };
    }
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || !Array.isArray((payload as BrickognizeResponse).items)) {
      recordFailure();
      return { kind: 'error', reason: 'invalid_response', message: 'Brickognize returned an invalid response.', cached: false };
    }
    recordSuccess();
    if (env.CACHE_KV) {
      try {
        const outcome = inspect((payload as BrickognizeResponse).items, false);
        await env.CACHE_KV.put(key, JSON.stringify(payload), {
          expirationTtl: outcome.kind === 'accepted'
            ? BRICKOGNIZE_ACCEPTED_CACHE_SECONDS
            : BRICKOGNIZE_FALLBACK_CACHE_SECONDS,
        });
      } catch (error) {
        console.warn('[brickognize] cache write failed:', (error as Error).message);
      }
    }
    return inspect((payload as BrickognizeResponse).items, false);
  } catch (error) {
    recordFailure();
    const timedOut = (error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError';
    return {
      kind: 'error',
      reason: timedOut ? 'timeout' : 'provider_error',
      message: timedOut ? 'Brickognize timed out.' : `Brickognize failed: ${(error as Error).message}`,
      cached: false,
    };
  }
}

export function resetBrickognizeCircuitForTests(): void {
  circuit = { failures: 0, openedAt: 0 };
}
