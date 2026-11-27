import type { Env } from '../types';
import type { BrickognizePrediction } from './brickognize';

/**
 * SigLIP second opinion for photo scans.
 *
 * When Brickognize is unsure (score < 0.60 or top two too close), its top 5
 * candidates are re-scored with SigLIP image similarity: the photo is embedded
 * by the bricksvault-siglip Worker (a Cloudflare Container running SigLIP base,
 * reached through the SIGLIP service binding) and compared with each set's
 * catalog image vector in the Vectorize index SIGLIP_INDEX. SigLIP's own nearest
 * sets join the candidate list. Final score = Brickognize score + similarity
 * above the lowest similarity seen for that photo.
 *
 * Measured 2026-11-26 on 78 real photos (scripts/scan-eval/fusion.mjs): 95% right
 * first vs 90% for Brickognize alone. Brickognize's own confident answers never
 * changed, so those are left alone; of its 23 unsure photos, a fused margin of
 * at least 0.20 answered 8 with none wrong. Everything below that still goes to
 * the AI steps exactly as before.
 *
 * Extra official views (LEGO.com gallery, Brickset extra photos; see
 * jobs/siglip-backfill.ts) are extra vectors "<set>#<hash>"; each set counts
 * with its best-matching image. SIGLIP_VIEWS=0 ignores them.
 *
 * Fully optional: without the binding, the index, or with SIGLIP_FUSION=0, scans
 * behave as before. Every failure returns null.
 */
export const SIGLIP_DIMENSIONS = 768;
export const SIGLIP_FUSION_WEIGHT = 1;
export const SIGLIP_ACCEPT_MARGIN = 0.2;

type Fetcher = { fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response> };

export function siglipAvailable(env: Env): boolean {
  return !!env.SIGLIP && !!env.SIGLIP_INDEX && env.SIGLIP_FUSION !== '0';
}

export const canonicalSetNum = (id: string) => (/-\d+$/.test(id) ? id : `${id}-1`);
const bare = (id: string) => id.replace(/-\d+$/, '');

/** Embed images (data URLs or http(s) URLs) with the SigLIP container. */
export async function siglipEmbed(
  env: Env,
  input: { images?: string[]; urls?: string[] },
  timeoutMs = 2_500,
  lane: 'scan' | 'bulk' = 'scan',
): Promise<(number[] | null)[] | null> {
  const svc = env.SIGLIP as unknown as Fetcher | undefined;
  if (!svc) return null;
  try {
    const res = await svc.fetch('https://siglip/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Siglip-Lane': lane },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = await res.json() as { vectors?: unknown };
    if (!Array.isArray(body.vectors)) return null;
    return body.vectors.map((v) => (Array.isArray(v) && v.length === SIGLIP_DIMENSIONS ? v as number[] : null));
  } catch (e) {
    console.warn('[siglip] embed failed:', (e as Error)?.message);
    return null;
  }
}

const dot = (a: number[], b: number[]) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

export interface FusedCandidate { id: string; brickognize: number; similarity: number; score: number }

/**
 * Pure fusion of Brickognize candidates with SigLIP similarities.
 * `candidateSims` maps canonical set numbers to similarity (missing = no image).
 */
export function fuseCandidates(
  predictions: Pick<BrickognizePrediction, 'id' | 'score'>[],
  candidateSims: Map<string, number>,
  siglipTop: { id: string; similarity: number }[],
  weight = SIGLIP_FUSION_WEIGHT,
): { ranked: FusedCandidate[]; margin: number } | null {
  const sims = [...candidateSims.values(), ...siglipTop.map((x) => x.similarity)];
  if (!predictions.length || !sims.length) return null;
  const lo = Math.min(...sims);
  const byBare = new Map<string, { id: string; brickognize: number; similarity: number }>();
  for (const p of predictions) {
    const id = canonicalSetNum(p.id);
    if (!byBare.has(bare(id))) byBare.set(bare(id), { id, brickognize: p.score, similarity: candidateSims.get(id) ?? lo });
  }
  for (const s of siglipTop) {
    const id = canonicalSetNum(s.id);
    if (!byBare.has(bare(id))) byBare.set(bare(id), { id, brickognize: 0, similarity: s.similarity });
  }
  const ranked = [...byBare.values()]
    .map((c) => ({ ...c, score: c.brickognize + weight * (c.similarity - lo) }))
    .sort((a, b) => b.score - a.score);
  return { ranked, margin: ranked.length > 1 ? ranked[0].score - ranked[1].score : ranked[0].score };
}

/**
 * Re-score Brickognize's candidates for a photo vector. Returns the fused
 * winner only when its margin clears SIGLIP_ACCEPT_MARGIN.
 */
export async function siglipSecondOpinion(
  env: Env,
  photoVector: number[],
  predictions: BrickognizePrediction[],
): Promise<{ accepted: FusedCandidate | null; ranked: FusedCandidate[]; margin: number } | null> {
  const index = env.SIGLIP_INDEX;
  if (!index || !predictions.length) return null;
  try {
    const sets = [...new Set(predictions.map((p) => canonicalSetNum(p.id)))];
    const useViews = env.SIGLIP_VIEWS !== '0';
    const viewIds = useViews ? await candidateViewIds(env, sets) : [];
    const ids = [...sets, ...viewIds];
    const [storedChunks, nearest] = await Promise.all([
      Promise.all(chunk(ids, GET_BY_IDS_MAX).map((part) => index.getByIds(part))),
      index.query(photoVector, { topK: NEAREST_TOP_K }),
    ]);
    // Best similarity per set over its catalog photo and its extra views.
    const candidateSims = new Map<string, number>();
    for (const v of storedChunks.flat()) {
      const values = Array.from(v.values as ArrayLike<number>);
      if (values.length !== SIGLIP_DIMENSIONS) continue;
      const set = vectorSetNum(v.id);
      const sim = dot(photoVector, values);
      if (sim > (candidateSims.get(set) ?? -Infinity)) candidateSims.set(set, sim);
    }
    const siglipTop = collapseNearest(nearest.matches || [], useViews);
    const fused = fuseCandidates(predictions, candidateSims, siglipTop);
    if (!fused) return null;
    return { ...fused, accepted: fused.margin >= SIGLIP_ACCEPT_MARGIN ? fused.ranked[0] : null };
  } catch (e) {
    console.warn('[siglip] second opinion failed:', (e as Error)?.message);
    return null;
  }
}

// Vectorize: getByIds takes at most 20 ids; topK up to 100 without values.
const GET_BY_IDS_MAX = 20;
const NEAREST_TOP_K = 30;
const chunk = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** "75192-1#a1b2c3d4e5" (extra view) and "75192-1" (catalog photo) both belong to 75192-1. */
export const vectorSetNum = (id: string) => id.split('#')[0];

/** Nearest vectors collapsed to the best one per set, top 5 sets. Views ignored when off. */
export function collapseNearest(matches: { id: string; score: number }[], useViews = true): { id: string; similarity: number }[] {
  const best = new Map<string, number>();
  for (const m of matches) {
    if (!useViews && m.id.includes('#')) continue;
    const set = vectorSetNum(m.id);
    if (m.score > (best.get(set) ?? -Infinity)) best.set(set, m.score);
  }
  return [...best].map(([id, similarity]) => ({ id, similarity })).sort((a, b) => b.similarity - a.similarity).slice(0, 5);
}

async function candidateViewIds(env: Env, sets: string[]): Promise<string[]> {
  if (!sets.length) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT vec_id FROM siglip_view_embeddings WHERE ok = 1 AND set_num IN (${sets.map(() => '?').join(',')}) LIMIT 60`,
    ).bind(...sets).all<{ vec_id: string }>();
    return (results ?? []).map((r) => r.vec_id);
  } catch {
    return []; // table missing or D1 hiccup: catalog photos only
  }
}
