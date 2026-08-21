import { SCAN_SYSTEM_PROMPT } from './llm';
import { matchSetsToCatalog, type DescribedMinifig, type DescribedSet } from './scan-match';
import type { Env } from '../types';

const PATEWAY_RESPONSES_URL = 'https://api.pateway.ai/v1/responses';
export const PATEWAY_ECONOMY_MODEL = 'gpt-5.6-luna';
export const PATEWAY_ECONOMY_TIMEOUT_MS = 8_000;
const MAX_OUTPUT_TOKENS = 300;

export interface PatewayUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
}

export interface PatewayScanResult {
  sets: DescribedSet[];
  minifigs: DescribedMinifig[];
  usage?: PatewayUsage;
  model: string;
}

type PatewayOptions = {
  fetcher?: typeof fetch;
  timeoutMs?: number;
  prompt?: string;
};

export function normalizePatewaySetNumber(value: unknown): string {
  return String(value ?? '').trim().replace(/-\d+$/, '');
}

export function shouldVerifyWithPatewayEconomy(
  shelfMode: boolean,
  matchedSets: Record<string, unknown>[],
  apiKey?: string,
): boolean {
  return !shelfMode
    && matchedSets.length === 1
    && !!normalizePatewaySetNumber(matchedSets[0]?.set_num)
    && !!apiKey?.trim();
}

/**
 * Accept an Economy answer only when normal catalog matching resolves it to the
 * same catalog set as the synchronous scan. Raw model strings alone are never
 * treated as verification.
 */
export async function patewaySetAgreement(
  env: Env,
  expectedSetNum: string,
  describedSets: DescribedSet[],
): Promise<boolean> {
  const candidate = describedSets.filter((set) => (set.confidence ?? 'none') !== 'none');
  if (!candidate.length) return false;
  const matched = await matchSetsToCatalog(env, candidate);
  const expected = normalizePatewaySetNumber(expectedSetNum);
  return !!expected && matched.sets.some((set) => normalizePatewaySetNumber(set.set_num) === expected);
}

function outputText(body: Record<string, unknown>): string {
  if (typeof body.output_text === 'string') return body.output_text;
  const output = Array.isArray(body.output) ? body.output : [];
  return output.flatMap((item) => {
    if (!item || typeof item !== 'object' || (item as { type?: unknown }).type !== 'message') return [];
    const content = Array.isArray((item as { content?: unknown }).content)
      ? (item as { content: unknown[] }).content
      : [];
    return content.flatMap((part) => {
      if (!part || typeof part !== 'object' || (part as { type?: unknown }).type !== 'output_text') return [];
      const text = (part as { text?: unknown }).text;
      return typeof text === 'string' ? [text] : [];
    });
  }).join('\n');
}

function parsePayload(text: string): { sets: DescribedSet[]; minifigs: DescribedMinifig[] } {
  const cleaned = text.replace(/```json?\n?|```/g, '').trim();
  const parsed = JSON.parse(cleaned) as { sets?: unknown; minifigs?: unknown };
  return {
    sets: Array.isArray(parsed.sets) ? parsed.sets as DescribedSet[] : [],
    minifigs: Array.isArray(parsed.minifigs) ? parsed.minifigs as DescribedMinifig[] : [],
  };
}

/**
 * Calls the Economy-key-bound Pateway Responses endpoint exactly once. The
 * caller owns any retry policy; this function intentionally never replays a
 * timed-out image request.
 */
export async function callPatewayEconomyScan(
  image: string,
  apiKey: string,
  options: PatewayOptions = {},
): Promise<PatewayScanResult> {
  const key = apiKey.trim();
  if (!key) throw new Error('Pateway Economy is not configured');
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? PATEWAY_ECONOMY_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('Pateway Economy scan timed out'), timeoutMs);
  try {
    const response = await fetcher(PATEWAY_RESPONSES_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: PATEWAY_ECONOMY_MODEL,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: options.prompt || SCAN_SYSTEM_PROMPT },
            { type: 'input_image', image_url: image },
          ],
        }],
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`Pateway Economy HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    const body = await response.json() as Record<string, unknown>;
    const parsed = parsePayload(outputText(body));
    return {
      ...parsed,
      usage: body.usage && typeof body.usage === 'object' ? body.usage as PatewayUsage : undefined,
      model: typeof body.model === 'string' ? body.model : PATEWAY_ECONOMY_MODEL,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Current advertised Economy Luna rates per million tokens. */
export function estimatePatewayEconomyCostUsd(usage?: PatewayUsage | null): number | null {
  if (!usage) return null;
  const input = Math.max(0, Number(usage.input_tokens) || 0);
  const cached = Math.min(input, Math.max(0, Number(usage.input_tokens_details?.cached_tokens) || 0));
  const output = Math.max(0, Number(usage.output_tokens) || 0);
  return ((input - cached) * 0.01 + cached * 0.001 + output * 0.06) / 1_000_000;
}
