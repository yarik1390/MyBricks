import type { Env } from '../types';
import { fetchAdditionalImages } from '../lib/brickset';
import { quotaRemaining, spendQuota } from '../lib/api-quota';

/**
 * Real-photo training set for the scan model (scripts/siglip-finetune).
 *
 * 23:00 UTC: Brickset extra photos (official LEGO images) for the most owned
 * sets, using what is left of the day's Brickset budget minus a reserve for
 * set pages. Stored in lego_sets.brickset_image_urls, the same cache the set
 * page gallery uses.
 *
 * Creative Commons photos from Openverse are collected by the "Openverse
 * photos" GitHub workflow (scripts/openverse-photos.mjs), because Openverse
 * throttles shared Cloudflare Workers IPs. LEGO.com gallery photos are
 * collected by lego-stock-refresh.
 */
const BRICKSET_RESERVE = 15;

export async function runBricksetGalleryTrickle(env: Env) {
  if (!env.BRICKSET_API_KEY) return { skipped: 'no BRICKSET_API_KEY' };
  const spare = (await quotaRemaining(env, 'brickset')) - BRICKSET_RESERVE;
  if (spare <= 0) return { skipped: 'no spare Brickset budget today' };
  const { results } = await env.DB.prepare(
    `SELECT s.set_num, s.brickset_set_id FROM lego_sets s
      WHERE s.brickset_set_id > 0 AND s.additional_image_count > 0 AND s.brickset_images_cached_at IS NULL
      ORDER BY (SELECT COUNT(*) FROM user_collection uc WHERE uc.set_num = s.set_num AND uc.deleted_at IS NULL) DESC,
               s.year DESC
      LIMIT ?`,
  ).bind(spare).all<{ set_num: string; brickset_set_id: number }>();
  let fetched = 0; let photos = 0;
  for (const row of results) {
    if (!(await spendQuota(env, 'brickset'))) break;
    const urls = await fetchAdditionalImages(Number(row.brickset_set_id), env).catch(() => null);
    if (urls === null) continue;
    await env.DB.prepare("UPDATE lego_sets SET brickset_image_urls=?, brickset_images_cached_at=datetime('now') WHERE set_num=?")
      .bind(JSON.stringify(urls), row.set_num).run();
    fetched++; photos += urls.length;
  }
  return { spare, fetched, photos };
}

export async function runTrainingPhotos(env: Env, now = new Date()) {
  if (now.getUTCHours() !== 23) return { skipped: 'Brickset photos run at 23:00 UTC; Openverse runs on GitHub' };
  const brickset = await runBricksetGalleryTrickle(env) as Record<string, unknown>;
  return {
    processed: Number(brickset.fetched ?? 0),
    updated: Number(brickset.photos ?? 0),
    failed: 0,
    ...(typeof brickset.skipped === 'string' ? { skipped: `brickset: ${brickset.skipped}` } : {}),
    brickset,
  };
}
