import type { Env } from '../types';
import { fetchAdditionalImages } from '../lib/brickset';
import { quotaRemaining, spendQuota } from '../lib/api-quota';

/**
 * Real-photo training set for the scan model (scripts/siglip-finetune).
 *
 * Hourly:
 *  - Openverse (Creative Commons photos, mostly Flickr and Wikimedia): one
 *    search per set, "lego <number>", commercial-use licences only, kept when
 *    the title or tags carry the set number. Licence, creator and source page
 *    are stored for attribution. Needs OPENVERSE_CLIENT_ID/SECRET; skipped
 *    without them.
 *  - 23:00 UTC only: Brickset extra photos (official LEGO images) for the most
 *    owned sets, using what is left of the day's Brickset budget minus a
 *    reserve for set pages. Stored in lego_sets.brickset_image_urls, the same
 *    cache the set page gallery uses.
 *
 * LEGO.com gallery photos are collected by lego-stock-refresh.
 */
const OPENVERSE = 'https://api.openverse.org/v1';
const UA = 'BricksVault/1.0 (+https://bricksvault.app)';
const BRICKSET_RESERVE = 15;

export const bareSetNum = (s: string) => s.replace(/-\d+$/, '');

export interface OpenverseImage {
  url?: string; title?: string; creator?: string | null; license?: string; license_version?: string | null;
  foreign_landing_url?: string; source?: string; tags?: { name?: string }[] | null;
}

/** Keep a result only when its title or tags name the set number as a whole token. */
export function openverseMatches(setNum: string, img: OpenverseImage): boolean {
  const num = bareSetNum(setNum);
  if (!/^\d{3,}$/.test(num) || !img.url || !/^https:\/\//.test(img.url)) return false;
  const re = new RegExp(`(^|[^0-9])${num}([^0-9]|$)`);
  return re.test(img.title ?? '') || (img.tags ?? []).some((t) => re.test(t?.name ?? ''));
}

const TOKEN_KEY = 'openverse:token';

/**
 * Bearer token for Openverse. Tokens last about 12 hours and the token endpoint
 * is rate limited on its own, so the token is kept in KV and reused instead of
 * being requested every hour. Returns the token or why there is none.
 */
async function openverseToken(env: Env): Promise<{ token: string | null; why?: string }> {
  if (!env.OPENVERSE_CLIENT_ID || !env.OPENVERSE_CLIENT_SECRET) return { token: null, why: 'no OPENVERSE_CLIENT_ID' };
  const cached = await env.CACHE_KV?.get(TOKEN_KEY).catch(() => null);
  if (cached) return { token: cached };
  try {
    const res = await fetch(`${OPENVERSE}/auth_tokens/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.OPENVERSE_CLIENT_ID, client_secret: env.OPENVERSE_CLIENT_SECRET }),
    });
    if (!res.ok) return { token: null, why: `token HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 100)}` };
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) return { token: null, why: 'token reply had no access_token' };
    const ttl = Math.max(60, Math.min(Number(body.expires_in) || 3600, 43_200) - 600);
    await env.CACHE_KV?.put(TOKEN_KEY, body.access_token, { expirationTtl: ttl }).catch(() => {});
    return { token: body.access_token };
  } catch (e) { return { token: null, why: `token fetch failed: ${(e as Error)?.message}` }; }
}

export async function runOpenversePhotos(env: Env, opts: { limit?: number; budgetMs?: number } = {}) {
  const { token, why } = await openverseToken(env);
  if (!env.OPENVERSE_CLIENT_ID) return { skipped: why ?? 'no OPENVERSE_CLIENT_ID' };
  // Without a token Openverse still answers anonymously, at a lower rate, so
  // run a small batch instead of nothing and report why the token failed.
  const limit = token ? (opts.limit ?? 150) : Math.min(opts.limit ?? 150, 15);
  const deadline = Date.now() + (opts.budgetMs ?? 150_000);
  // Owned/wishlisted sets first, then recent sets with 50+ pieces (rarely photographed otherwise).
  const { results } = await env.DB.prepare(
    `SELECT s.set_num FROM lego_sets s
      LEFT JOIN training_photo_queries q ON q.set_num = s.set_num AND q.source = 'openverse'
      WHERE q.set_num IS NULL AND s.name IS NOT NULL AND COALESCE(s.pieces, 0) >= 50
      ORDER BY EXISTS (SELECT 1 FROM user_collection uc WHERE uc.set_num = s.set_num AND uc.deleted_at IS NULL) DESC,
               EXISTS (SELECT 1 FROM user_wishlist uw WHERE uw.set_num = s.set_num) DESC,
               s.year DESC
      LIMIT ?`,
  ).bind(limit).all<{ set_num: string }>();

  let queried = 0; let photos = 0; let errors = 0; let lastError: string | undefined;
  for (const { set_num } of results) {
    if (Date.now() > deadline) break;
    const q = new URLSearchParams({ q: `lego ${bareSetNum(set_num)}`, license_type: 'commercial', page_size: '50' });
    let items: OpenverseImage[] = [];
    try {
      const headers: Record<string, string> = { 'User-Agent': UA };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${OPENVERSE}/images/?${q}`, { headers });
      if (res.status === 401 && token) await env.CACHE_KV?.delete(TOKEN_KEY).catch(() => {});
      if (res.status === 429 || res.status === 401) { lastError = `search HTTP ${res.status}`; errors++; break; } // try again next hour
      if (!res.ok) { lastError = `search HTTP ${res.status}`; errors++; continue; }
      items = ((await res.json()) as { results?: OpenverseImage[] }).results ?? [];
    } catch (e) { lastError = `search failed: ${(e as Error)?.message}`; errors++; continue; }
    queried++;
    const keep = items.filter((i) => openverseMatches(set_num, i));
    for (let j = 0; j < keep.length; j += 14) { // 7 params per row, D1 max 100
      const chunk = keep.slice(j, j + 14);
      await env.DB.prepare(`INSERT OR IGNORE INTO training_images (set_num, url, source, license, creator, landing_url)
        VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}`)
        .bind(...chunk.flatMap((i) => [set_num, i.url!, `openverse:${i.source ?? 'unknown'}`,
          [i.license, i.license_version].filter(Boolean).join(' ') || null, i.creator ?? null, i.foreign_landing_url ?? null]))
        .run();
    }
    photos += keep.length;
    await env.DB.prepare(`INSERT OR REPLACE INTO training_photo_queries (set_num, source, hits, queried_at)
      VALUES (?, 'openverse', ?, datetime('now'))`).bind(set_num, keep.length).run();
    await new Promise((r) => setTimeout(r, 400)); // stay well under Openverse's per-second limit
  }
  return { picked: results.length, queried, photos, errors, anonymous: !token, ...(why || lastError ? { reason: [why, lastError].filter(Boolean).join('; ') } : {}) };
}

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
  const openverse = await runOpenversePhotos(env);
  const brickset = now.getUTCHours() === 23 ? await runBricksetGalleryTrickle(env) : { skipped: 'runs at 23:00 UTC' };
  // Flat counters so the admin console's run summary shows them.
  const ov = openverse as Record<string, unknown>;
  const bs = brickset as Record<string, unknown>;
  const queried = Number(ov.queried ?? 0);
  const failed = queried === 0 && Number(ov.errors ?? 0) > 0 ? Number(ov.errors) : 0;
  return {
    processed: queried,
    updated: Number(ov.photos ?? 0) + Number(bs.photos ?? 0),
    failed,
    ...(typeof ov.skipped === 'string' && !('photos' in bs) ? { skipped: `openverse: ${ov.skipped}` } : {}),
    ...(typeof ov.reason === 'string' ? { reason: ov.reason } : {}),
    openverse, brickset,
  };
}
