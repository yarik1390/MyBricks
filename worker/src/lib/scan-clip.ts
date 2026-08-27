// CLIP/Vectorize visual set identification.
//
// After OCR misses, embed the photo (MobileCLIP-S2, 512-d) and nearest-neighbor
// search the official-catalog Vectorize index. Accept/margin gates match
// Brickognize (score ≥ 0.75 and ≥ 0.10 gap vs the next *set*, not the next
// view of the same set). Ambiguous / low / embed failure fall through.

import type { Env } from '../types';
import {
  clipConfigured,
  clipEnabled,
  decodeScanImage,
  embedQueryImage,
} from './clip-embed';

export { CLIP_MODEL } from './clip-embed';

// Same numeric gates as lib/brickognize.ts. Vectorize `cosine` scores are
// cosine similarity on L2-normalized MobileCLIP-S2 vectors, so 0.75 is a
// conservative "this is the same official pack shot" bar — not a claim that
// built-set photos will match Brickognize recall. See docs/clip-set-index.md.
export const CLIP_SCORE_MIN = 0.75;
export const CLIP_MARGIN_MIN = 0.10;
export const CLIP_QUERY_TOP_K = 8;

export type ClipRankedSet = {
  setNum: string;
  score: number;
  vectorId: string;
  view?: string;
};

export type ClipMatch = {
  id: string;
  score: number;
  metadata?: Record<string, unknown> | null;
};

export type ClipOutcome =
  | { kind: 'accepted'; top: ClipRankedSet; second?: ClipRankedSet; cached: boolean }
  | {
    kind: 'fallback';
    reason: 'disabled' | 'unconfigured' | 'unsupported_image' | 'low_confidence' | 'ambiguous' | 'empty' | 'circuit_open';
    cached: boolean;
  }
  | { kind: 'error'; reason: 'timeout' | 'embed_failed' | 'provider_error'; message: string; cached: false };

export type ClipRunOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

export function setNumFromClipId(id: string, metadata?: Record<string, unknown> | null): string {
  const fromMeta = metadata && typeof metadata.set_num === 'string' ? metadata.set_num.trim() : '';
  if (fromMeta) return fromMeta;
  // vector id form: clip:v1:{set_num}:{view}
  const parts = String(id || '').split(':');
  if (parts.length >= 4 && parts[0] === 'clip') return parts.slice(2, -1).join(':');
  return String(id || '').trim();
}

export function clipVectorId(setNum: string, view: string): string {
  return `clip:v1:${setNum}:${view}`;
}

/**
 * Collapse Vectorize neighbors to one row per catalog set_num, keeping the
 * best score. Two views of 75192-1 must not look like an ambiguous pair.
 */
export function collapseBySetNum(matches: ClipMatch[]): ClipRankedSet[] {
  const best = new Map<string, ClipRankedSet>();
  for (const match of matches) {
    if (!match || typeof match.id !== 'string' || !Number.isFinite(match.score)) continue;
    const setNum = setNumFromClipId(match.id, match.metadata);
    if (!setNum) continue;
    const view = match.metadata && typeof match.metadata.view === 'string' ? match.metadata.view : undefined;
    const prev = best.get(setNum);
    if (!prev || match.score > prev.score) {
      best.set(setNum, { setNum, score: match.score, vectorId: match.id, view });
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.setNum.localeCompare(b.setNum));
}

export function inspectClipRanks(ranked: ClipRankedSet[], cached: boolean): ClipOutcome {
  const top = ranked[0];
  if (!top) return { kind: 'fallback', reason: 'empty', cached };
  if (top.score < CLIP_SCORE_MIN) return { kind: 'fallback', reason: 'low_confidence', cached };
  const second = ranked[1];
  if (second && top.score - second.score < CLIP_MARGIN_MIN) {
    return { kind: 'fallback', reason: 'ambiguous', cached };
  }
  return { kind: 'accepted', top, second, cached };
}

export function inspectClipMatches(matches: ClipMatch[], cached: boolean): ClipOutcome {
  return inspectClipRanks(collapseBySetNum(matches), cached);
}

export async function identifySetWithClip(
  env: Env,
  image: string,
  options: ClipRunOptions = {},
): Promise<ClipOutcome> {
  if (!clipEnabled(env)) return { kind: 'fallback', reason: 'disabled', cached: false };
  if (!clipConfigured(env)) return { kind: 'fallback', reason: 'unconfigured', cached: false };
  const decoded = decodeScanImage(image);
  if (!decoded) return { kind: 'fallback', reason: 'unsupported_image', cached: false };

  const embedded = await embedQueryImage(env, decoded, options);
  if (embedded.kind === 'fallback') {
    return { kind: 'fallback', reason: embedded.reason, cached: false };
  }
  if (embedded.kind === 'error') {
    return { kind: 'error', reason: embedded.reason, message: embedded.message, cached: false };
  }

  try {
    const result = await env.SET_CLIP!.query(embedded.vector, {
      topK: CLIP_QUERY_TOP_K,
      returnMetadata: 'all',
    });
    const matches: ClipMatch[] = Array.isArray(result?.matches)
      ? result.matches.map((row) => ({
        id: String(row.id || ''),
        score: Number(row.score),
        metadata: (row.metadata || null) as Record<string, unknown> | null,
      }))
      : [];
    return inspectClipMatches(matches, embedded.cached);
  } catch (error) {
    return {
      kind: 'error',
      reason: 'provider_error',
      message: `Vectorize query failed: ${(error as Error).message}`,
      cached: false,
    };
  }
}

export function clipTimingOutcome(outcome: ClipOutcome): string {
  if (outcome.kind === 'accepted') return outcome.cached ? 'accepted_cache' : 'accepted';
  if (outcome.kind === 'fallback') return outcome.reason;
  return outcome.reason;
}
