import type { Env } from '../types';
import { hashSource } from '../lib/describe-i18n';
import { embedTexts, setEmbeddingText, smartSearchAvailable, type EmbeddableSet } from '../lib/set-embeddings';

/**
 * Hourly: embed catalog sets that are not in the smart-search index yet, then
 * re-check the oldest embeddings (30+ days) and re-embed only those whose
 * name/theme/description text changed. The first pass over ~29k sets takes
 * about a day; after that it is mostly new sets from the weekly import.
 * Progress lives in set_embeddings (D1), the vectors in Vectorize (SETS_INDEX).
 */
export async function runEmbedSets(env: Env, opts: { limit?: number; batch?: number } = {}) {
  if (!smartSearchAvailable(env)) return { skipped: 'no AI binding or SETS_INDEX' };
  const limit = opts.limit ?? 1000;
  const batch = Math.min(opts.batch ?? 50, 50);

  const { results } = await env.DB.prepare(
    `SELECT s.set_num, s.name, s.theme, s.subtheme, s.year, s.pieces, s.brickset_description,
            e.source_hash AS done_hash
       FROM lego_sets s
       LEFT JOIN set_embeddings e ON e.set_num = s.set_num
      WHERE e.set_num IS NULL OR e.embedded_at < datetime('now', '-30 days')
      ORDER BY e.set_num IS NOT NULL, e.embedded_at, s.year DESC
      LIMIT ?`,
  ).bind(limit).all<EmbeddableSet & { done_hash: string | null }>();

  const todo: { setNum: string; text: string; hash: string }[] = [];
  const unchanged: string[] = [];
  for (const s of results) {
    const text = setEmbeddingText(s);
    const hash = hashSource(text);
    if (s.done_hash === hash) unchanged.push(s.set_num);
    else todo.push({ setNum: s.set_num, text, hash });
  }

  let embedded = 0;
  let failedBatches = 0;
  for (let i = 0; i < todo.length; i += batch) {
    const chunk = todo.slice(i, i + batch);
    const vecs = await embedTexts(env, chunk.map(c => c.text));
    if (!vecs) { failedBatches++; continue; }
    await env.SETS_INDEX!.upsert(chunk.map((c, j) => ({ id: c.setNum, values: vecs[j] })));
    // One multi-row statement per chunk: D1 caps queries per invocation (1,000)
    // and bound parameters per statement (100), so batch ≤ 50.
    await env.DB.prepare(
      `INSERT INTO set_embeddings (set_num, source_hash, embedded_at)
       VALUES ${chunk.map(() => "(?, ?, datetime('now'))").join(', ')}
       ON CONFLICT(set_num) DO UPDATE SET source_hash = excluded.source_hash, embedded_at = excluded.embedded_at`,
    ).bind(...chunk.flatMap(c => [c.setNum, c.hash])).run();
    embedded += chunk.length;
  }
  for (let i = 0; i < unchanged.length; i += 100) {
    const ids = unchanged.slice(i, i + 100);
    await env.DB.prepare(
      `UPDATE set_embeddings SET embedded_at = datetime('now') WHERE set_num IN (${ids.map(() => '?').join(',')})`,
    ).bind(...ids).run();
  }
  return { picked: results.length, embedded, unchanged: unchanged.length, failedBatches };
}
