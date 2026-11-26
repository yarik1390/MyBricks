import type { Env } from '../types';
import { SIGLIP_DIMENSIONS, siglipEmbed } from '../lib/siglip';

/**
 * Every 10 minutes: embed catalog set photos with SigLIP (bricksvault-siglip
 * container) into SIGLIP_INDEX, the catalog side of the photo-scan second
 * opinion (lib/siglip.ts). The first pass over ~29k sets takes a few hours;
 * after that only new sets (and failed images, after 30 days) are picked, so
 * the container stays asleep. Progress lives in siglip_embeddings (D1).
 */
const imageUrl = (setNum: string, url: string | null) =>
  url && /^https:\/\//.test(url) ? url : `https://cdn.rebrickable.com/media/sets/${setNum}.jpg`;

export async function runSiglipBackfill(
  env: Env,
  opts: { limit?: number; batch?: number; concurrency?: number; budgetMs?: number } = {},
) {
  if (!env.SIGLIP || !env.SIGLIP_INDEX) return { skipped: 'no SIGLIP binding or SIGLIP_INDEX' };
  const limit = opts.limit ?? 2000;
  const batch = Math.min(opts.batch ?? 16, 32);
  const concurrency = opts.concurrency ?? 4;
  const deadline = Date.now() + (opts.budgetMs ?? 210_000);

  const { results } = await env.DB.prepare(
    `SELECT s.set_num, s.image_url
       FROM lego_sets s
       LEFT JOIN siglip_embeddings e ON e.set_num = s.set_num
      WHERE e.set_num IS NULL OR (e.ok = 0 AND e.embedded_at < datetime('now', '-30 days'))
      ORDER BY e.set_num IS NOT NULL, s.year DESC
      LIMIT ?`,
  ).bind(limit).all<{ set_num: string; image_url: string | null }>();

  const chunks: { set_num: string; image_url: string | null }[][] = [];
  for (let i = 0; i < results.length; i += batch) chunks.push(results.slice(i, i + batch));

  let embedded = 0;
  let noImage = 0;
  let failedBatches = 0;
  let next = 0;
  const worker = async () => {
    while (next < chunks.length && Date.now() < deadline) {
      const chunk = chunks[next++];
      const vecs = await siglipEmbed(env, { urls: chunk.map((s) => imageUrl(s.set_num, s.image_url)) }, 90_000, 'bulk');
      if (!vecs || vecs.length !== chunk.length) { failedBatches++; continue; }
      const good = chunk.flatMap((s, j) => (vecs[j]?.length === SIGLIP_DIMENSIONS ? [{ id: s.set_num, values: vecs[j]! }] : []));
      if (good.length) await env.SIGLIP_INDEX!.upsert(good);
      // One multi-row statement per chunk (D1: 100 bound params, 1,000 queries per run).
      await env.DB.prepare(
        `INSERT INTO siglip_embeddings (set_num, ok, embedded_at)
         VALUES ${chunk.map(() => "(?, ?, datetime('now'))").join(', ')}
         ON CONFLICT(set_num) DO UPDATE SET ok = excluded.ok, embedded_at = excluded.embedded_at`,
      ).bind(...chunk.flatMap((s, j) => [s.set_num, vecs[j] ? 1 : 0])).run();
      embedded += good.length;
      noImage += chunk.length - good.length;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));
  return { picked: results.length, embedded, noImage, failedBatches, stoppedEarly: next < chunks.length };
}
