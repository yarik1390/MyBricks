import type { Env } from '../types';
import { SIGLIP_DIMENSIONS, siglipEmbed } from '../lib/siglip';

/**
 * Every 10 minutes: embed catalog set photos with SigLIP (bricksvault-siglip
 * container) into SIGLIP_INDEX, the catalog side of the photo-scan second
 * opinion (lib/siglip.ts). The first pass over ~29k sets takes a few hours;
 * after that only new sets (and failed images, after 30 days) are picked, so
 * the container stays asleep. Progress lives in siglip_embeddings (D1).
 *
 * With time left, a second pass embeds extra official views of each set
 * (LEGO.com gallery photos from training_images, Brickset extra photos from
 * lego_sets.brickset_image_urls), at most MAX_VIEWS_PER_SET per set, as extra
 * vectors "<set_num>#<hash>" (lib/siglip.ts takes the best view per set).
 * Progress lives in siglip_view_embeddings.
 */
export const MAX_VIEWS_PER_SET = 8;

/** Vectorize id for an extra view: set number plus a short hash of the URL (ids max 64 bytes). */
export async function viewVectorId(setNum: string, url: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  const hex = Array.from(new Uint8Array(d).slice(0, 5)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${setNum.slice(0, 48)}#${hex}`;
}
const imageUrl = (setNum: string, url: string | null) =>
  url && /^https:\/\//.test(url) ? url : `https://cdn.rebrickable.com/media/sets/${setNum}.jpg`;

export async function runSiglipBackfill(
  env: Env,
  opts: { limit?: number; batch?: number; concurrency?: number; budgetMs?: number; viewLimit?: number } = {},
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
  const views = Date.now() < deadline && next >= chunks.length
    // Never fails the catalog pass (missing table, D1 hiccup).
    ? await embedViews(env, { limit: opts.viewLimit ?? 1500, batch, concurrency, deadline })
      .catch((e) => ({ error: String((e as Error)?.message || e).slice(0, 200) }))
    : null;
  return { picked: results.length, embedded, noImage, failedBatches, stoppedEarly: next < chunks.length, ...(views ? { views } : {}) };
}

async function embedViews(
  env: Env,
  o: { limit: number; batch: number; concurrency: number; deadline: number },
) {
  const { results } = await env.DB.prepare(
    `WITH v AS (
       SELECT set_num, url, 'lego.com' AS source FROM training_images WHERE source = 'lego.com'
       UNION ALL
       SELECT s.set_num, j.value AS url, 'brickset' AS source
         FROM lego_sets s, json_each(s.brickset_image_urls) j
        WHERE s.brickset_image_urls LIKE '[%' AND j.type = 'text'
     ),
     ranked AS (
       SELECT v.*, ROW_NUMBER() OVER (PARTITION BY v.set_num ORDER BY v.source DESC, v.url) AS n
         FROM v JOIN lego_sets s ON s.set_num = v.set_num
        WHERE v.url LIKE 'https://%' AND v.url <> COALESCE(s.image_url, '')
     )
     SELECT r.set_num, r.url, r.source
       FROM ranked r LEFT JOIN siglip_view_embeddings e ON e.url = r.url
      WHERE r.n <= ? AND (e.url IS NULL OR (e.ok = 0 AND e.embedded_at < datetime('now', '-30 days')))
      LIMIT ?`,
  ).bind(MAX_VIEWS_PER_SET, o.limit).all<{ set_num: string; url: string; source: string }>();

  const chunks: typeof results[] = [];
  for (let i = 0; i < results.length; i += o.batch) chunks.push(results.slice(i, i + o.batch));
  let embedded = 0;
  let failed = 0;
  let failedBatches = 0;
  let next = 0;
  const worker = async () => {
    while (next < chunks.length && Date.now() < o.deadline) {
      const chunk = chunks[next++];
      const vecs = await siglipEmbed(env, { urls: chunk.map((r) => r.url) }, 90_000, 'bulk');
      if (!vecs || vecs.length !== chunk.length) { failedBatches++; continue; }
      const ids = await Promise.all(chunk.map((r) => viewVectorId(r.set_num, r.url)));
      const good = chunk.flatMap((_, j) => (vecs[j]?.length === SIGLIP_DIMENSIONS ? [{ id: ids[j], values: vecs[j]! }] : []));
      if (good.length) await env.SIGLIP_INDEX!.upsert(good);
      // 6 params per row: 16 rows per statement stays under D1's 100.
      for (let k = 0; k < chunk.length; k += 16) {
        const part = chunk.slice(k, k + 16);
        await env.DB.prepare(
          `INSERT INTO siglip_view_embeddings (url, set_num, vec_id, source, ok, embedded_at)
           VALUES ${part.map(() => "(?, ?, ?, ?, ?, datetime('now'))").join(', ')}
           ON CONFLICT(url) DO UPDATE SET ok = excluded.ok, embedded_at = excluded.embedded_at`,
        ).bind(...part.flatMap((r, j) => [r.url, r.set_num, ids[k + j], r.source, vecs[k + j] ? 1 : 0])).run();
      }
      embedded += good.length;
      failed += chunk.length - good.length;
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.concurrency, chunks.length) }, worker));
  return { picked: results.length, embedded, failed, failedBatches, stoppedEarly: next < chunks.length };
}
