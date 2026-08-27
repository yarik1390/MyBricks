// Owned CLIP/MobileCLIP image embedder client.
//
// Workers AI has NO image-embedding models (text embeddings + VLMs only).
// Query-time vectors come from a Cloudflare Container running MobileCLIP-S2
// ONNX, bound as CLIP_EMBED (Fetcher) or CLIP_EMBED_URL (HTTP). Neither is
// Gemini Embedding 2 — that would lock the Vectorize index to Google.

import type { Env } from '../types';

export const CLIP_MODEL = 'mobileclip-s2';
export const CLIP_DIM = 512;
export const CLIP_EMBED_TIMEOUT_MS = 2_500;
const CIRCUIT_FAILURE_LIMIT = 3;
const CIRCUIT_OPEN_MS = 60_000;
const MAX_IMAGE_BYTES = 1_500_000;
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 8;
const KV_TTL_SECONDS = 30 * 24 * 60 * 60;

type CircuitState = { failures: number; openedAt: number };
let circuit: CircuitState = { failures: 0, openedAt: 0 };

export type DecodedScanImage = { bytes: Uint8Array; mime: string };

export function clipEnabled(env: Env): boolean {
  return env.CLIP_ENABLED !== '0';
}

export function clipConfigured(env: Env): boolean {
  return clipEnabled(env) && !!env.SET_CLIP && !!(env.CLIP_EMBED || (env.CLIP_EMBED_URL || '').trim());
}

export function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function decodeScanImage(image: string): DecodedScanImage | null {
  if (image.length > MAX_BASE64_CHARS + 40) return null;
  const match = image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  try {
    const binary = atob(match[2]);
    if (!binary.length || binary.length > MAX_IMAGE_BYTES) return null;
    return {
      bytes: Uint8Array.from(binary, (char) => char.charCodeAt(0)),
      mime: match[1].toLowerCase(),
    };
  } catch {
    return null;
  }
}

export async function imageHashHex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', exactArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function clipEmbeddingCacheKey(hash: string): string {
  return `scan:clip:v1:${hash}`;
}

export function l2Normalize(values: number[]): number[] {
  let sum = 0;
  for (const x of values) sum += x * x;
  const mag = Math.sqrt(sum);
  if (!Number.isFinite(mag) || mag < 1e-12) return values;
  return values.map((x) => x / mag);
}

export function validClipVector(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length !== CLIP_DIM) return false;
  return value.every((x) => typeof x === 'number' && Number.isFinite(x));
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

export function resetClipCircuitForTests(): void {
  circuit = { failures: 0, openedAt: 0 };
}

async function readCachedVector(env: Env, key: string): Promise<number[] | null> {
  if (!env.CACHE_KV) return null;
  try {
    const cached = await env.CACHE_KV.get<{ vector?: unknown }>(key, 'json');
    if (cached && validClipVector(cached.vector)) return l2Normalize(cached.vector);
  } catch (error) {
    console.warn('[clip] cache read failed:', (error as Error).message);
  }
  return null;
}

async function writeCachedVector(env: Env, key: string, vector: number[]): Promise<void> {
  if (!env.CACHE_KV) return;
  try {
    await env.CACHE_KV.put(key, JSON.stringify({ vector, model: CLIP_MODEL, dim: CLIP_DIM }), {
      expirationTtl: KV_TTL_SECONDS,
    });
  } catch (error) {
    console.warn('[clip] cache write failed:', (error as Error).message);
  }
}

function parseEmbedResponse(payload: unknown): number[] | null {
  if (!payload || typeof payload !== 'object') return null;
  const row = payload as Record<string, unknown>;
  const vector = row.vector ?? row.embedding ?? row.values;
  if (!validClipVector(vector)) return null;
  return l2Normalize(vector);
}

async function postEmbed(
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  url: string,
  decoded: DecodedScanImage,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<number[]> {
  const timeoutSignal = AbortSignal.timeout(Math.max(250, Math.min(timeoutMs, CLIP_EMBED_TIMEOUT_MS)));
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': decoded.mime, accept: 'application/json' },
    body: exactArrayBuffer(decoded.bytes),
    signal: combined,
  });
  if (!response.ok) {
    throw new Error(`CLIP embed HTTP ${response.status}`);
  }
  const parsed = parseEmbedResponse(await response.json());
  if (!parsed) throw new Error('CLIP embed returned an invalid vector.');
  return parsed;
}

export type EmbedResult =
  | { kind: 'ok'; vector: number[]; cached: boolean }
  | { kind: 'fallback'; reason: 'unconfigured' | 'circuit_open' }
  | { kind: 'error'; reason: 'timeout' | 'embed_failed'; message: string };

/**
 * Embed one image. KV-caches the 512-d vector by SHA-256 of the bytes
 * (same idea as Brickognize's per-image cache; the Vectorize query still runs
 * so an updated index is visible without waiting for TTL).
 */
export async function embedQueryImage(
  env: Env,
  decoded: DecodedScanImage,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<EmbedResult> {
  if (!clipConfigured(env)) return { kind: 'fallback', reason: 'unconfigured' };
  if (circuitOpen()) return { kind: 'fallback', reason: 'circuit_open' };

  const hash = await imageHashHex(decoded.bytes);
  const key = clipEmbeddingCacheKey(hash);
  const cached = await readCachedVector(env, key);
  if (cached) return { kind: 'ok', vector: cached, cached: true };

  const timeoutMs = options.timeoutMs ?? CLIP_EMBED_TIMEOUT_MS;
  try {
    let vector: number[];
    if (env.CLIP_EMBED) {
      vector = await postEmbed(
        (input, init) => env.CLIP_EMBED!.fetch(input, init),
        'https://clip-embed/embed',
        decoded,
        timeoutMs,
        options.signal,
      );
    } else {
      const base = (env.CLIP_EMBED_URL || '').trim().replace(/\/+$/, '');
      vector = await postEmbed(fetch, `${base}/embed`, decoded, timeoutMs, options.signal);
    }
    recordSuccess();
    await writeCachedVector(env, key, vector);
    return { kind: 'ok', vector, cached: false };
  } catch (error) {
    recordFailure();
    const timedOut = (error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError';
    return {
      kind: 'error',
      reason: timedOut ? 'timeout' : 'embed_failed',
      message: timedOut ? 'CLIP embed timed out.' : `CLIP embed failed: ${(error as Error).message}`,
    };
  }
}

/** Indexer path: embed raw bytes already fetched from R2 / Rebrickable. */
export async function embedImageBytes(
  env: Env,
  bytes: Uint8Array,
  mime: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<EmbedResult> {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    return { kind: 'error', reason: 'embed_failed', message: 'Image too large or empty for CLIP embed.' };
  }
  return embedQueryImage(env, { bytes, mime }, options);
}
