import type { Env } from '../types';

/**
 * Smart catalog search: every set is embedded once (name, theme, year, size,
 * the start of its description) with a multilingual Workers AI model and stored
 * in the Vectorize index SETS_INDEX. A search query is embedded the same way and
 * the nearest sets come back, so "pirate ship with shark" or "piraten schiff"
 * finds sets whose names never contain those words.
 *
 * Cost stays near zero for good: bge-m3 is $0.012 per million tokens (the whole
 * catalog is ~5M tokens, inside one day's free Neurons), and Vectorize bills
 * stored vectors once plus ~1k dimensions per query. Everything is optional:
 * without the AI binding or the index, search works exactly as before.
 */
export const EMBEDDING_MODEL = '@cf/baai/bge-m3';
export const EMBEDDING_DIMENSIONS = 1024;
/** Below this cosine score a "similar" set is noise, not a match. */
export const MIN_SIMILAR_SCORE = 0.5;

type AiRunner = { run: (model: string, input: unknown) => Promise<unknown> };

export function smartSearchAvailable(env: Env): boolean {
  return !!env.AI && !!env.SETS_INDEX;
}

export interface EmbeddableSet {
  set_num: string;
  name: string;
  theme?: string | null;
  subtheme?: string | null;
  year?: number | null;
  pieces?: number | null;
  brickset_description?: string | null;
}

/** The text a set is known by in the index. Stable, so its hash means "changed". */
export function setEmbeddingText(s: EmbeddableSet): string {
  const parts = [s.name];
  const theme = [s.theme, s.subtheme].filter(Boolean).join(' / ');
  if (theme) parts.push(`Theme: ${theme}`);
  if (s.year) parts.push(String(s.year));
  if (s.pieces) parts.push(`${s.pieces} pieces`);
  const desc = (s.brickset_description || '').replace(/\s+/g, ' ').trim();
  if (desc) parts.push(desc.slice(0, 700));
  return parts.join('. ');
}

export async function embedTexts(env: Env, texts: string[]): Promise<number[][] | null> {
  const ai = env.AI as unknown as AiRunner | undefined;
  if (!ai || !texts.length) return null;
  try {
    const raw = await ai.run(EMBEDDING_MODEL, { text: texts }) as { data?: number[][] };
    const data = raw?.data;
    if (!Array.isArray(data) || data.length !== texts.length) return null;
    if (data.some(v => !Array.isArray(v) || v.length !== EMBEDDING_DIMENSIONS)) return null;
    return data;
  } catch (e) {
    console.warn('[set-embeddings] embed failed:', (e as Error)?.message);
    return null;
  }
}

/** Nearest sets for a free-text query, best first. Empty on any failure. */
export async function similarSets(
  env: Env, query: string, topK = 24,
): Promise<{ setNum: string; score: number }[]> {
  if (!smartSearchAvailable(env)) return [];
  const q = query.trim().slice(0, 200);
  if (q.length < 3) return [];
  const vecs = await embedTexts(env, [q]);
  if (!vecs) return [];
  try {
    const res = await env.SETS_INDEX!.query(vecs[0], { topK: Math.min(topK, 50) });
    return (res.matches || [])
      .filter(m => m.score >= MIN_SIMILAR_SCORE)
      .map(m => ({ setNum: m.id, score: m.score }));
  } catch (e) {
    console.warn('[set-embeddings] query failed:', (e as Error)?.message);
    return [];
  }
}

/**
 * Smart matches are worth adding when keyword search came up short and the
 * query reads like a description rather than a set number or exact name.
 */
export function wantsSimilarSets(q: string, keywordHits: number, pageSize: number): boolean {
  const s = q.trim();
  if (s.length < 3 || /^\d{3,7}(-\d+)?$/.test(s)) return false;
  const words = s.split(/\s+/).filter(Boolean).length;
  if (keywordHits === 0) return true;
  return words >= 2 && keywordHits < Math.min(8, pageSize);
}
