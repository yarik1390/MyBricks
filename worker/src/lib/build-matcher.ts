// build-matcher.ts — "What can I build?" parts matcher + per-user cache.
//
// The parts-based matcher scans every set_parts row NOT owned by the user and
// aggregates a parts-pool join over it (~1.35M rows today). Measured locally at
// ~2.8s on fast NVMe with SQLite; on D1 this runs multiple seconds cold. The
// result is cached per user keyed by a fingerprint of their owned sets, which
// auto-invalidates whenever the collection changes — meaning the FIRST Build
// visit after every vault add was guaranteed-cold and slow.
//
// To fix that, the recompute is also fired in the BACKGROUND (waitUntil) right
// after any collection mutation (add/edit/delete/sell/import), so the cache is
// warm again long before the user opens Build. This module holds the shared
// implementation so routes/build.ts and routes/collection.ts compute
// byte-identical payloads.

import type { Env } from '../types';

export const MIN_REQ_PARTS = 50;                       // ignore book/gear/promo "sets"
export const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;     // refresh weekly (picks up value/catalog drift)
export const CACHE_VERSION = 'v2';                     // bump to invalidate all caches (e.g. after a set_parts reload)

export interface BuildFingerprintDeps {
  userId: string;
  minParts: number;
  limit: number;
}

export async function buildFingerprint(parts: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface OwnedRow { set_num: string; quantity: number }

async function loadOwnedComplete(env: Env, userId: string): Promise<OwnedRow[]> {
  const ownedRes = await env.DB.prepare(
    `SELECT set_num, quantity FROM user_collection
     WHERE user_id = ? AND deleted_at IS NULL AND is_complete = 1
     ORDER BY set_num`,
  ).bind(userId).all<OwnedRow>();
  return ownedRes.results || [];
}

export interface BuildPayload {
  builds: Array<{
    set_num: unknown; name: unknown; theme: unknown; year: unknown;
    pieces: unknown; image_url: unknown; current_value: unknown;
    req_total: number; have_total: number; pct: number; need: number; buildable: boolean;
  }>;
  can_build: number;
  near: number;
  owned_sets: number;
  parts_sets: number;
  min_parts: number;
}

export function fingerprintFor(userId: string, owned: OwnedRow[], minParts: number, lim: number): Promise<string> {
  return buildFingerprint(
    `${CACHE_VERSION}|user=${userId}|min=${minParts}|lim=${lim}|`
    + owned.map((r) => `${r.set_num}x${r.quantity || 1}`).join(','),
  );
}

// Run the heavy matcher and persist the payload into user_build_cache.
// Returns the computed payload, or null when the user owns nothing buildable-
// eligible (empty collection) — callers treat null as "nothing to do".
export async function computeAndCacheBuildableSets(
  env: Env,
  userId: string,
  minParts = MIN_REQ_PARTS,
  lim = 120,
): Promise<{ payload: BuildPayload; cached: boolean } | null> {
  const owned = await loadOwnedComplete(env, userId);
  if (!owned.length) return null;

  // Coverage readout: how many catalog sets actually have parts data.
  const cov = await env.DB.prepare(
    `SELECT COUNT(DISTINCT sp.set_num) AS n
     FROM set_parts sp
     WHERE sp.set_num IN (
       SELECT set_num FROM user_collection
       WHERE user_id = ? AND deleted_at IS NULL AND is_complete = 1
     )`,
  ).bind(userId).first<{ n: number }>();

  // Pool = every part/color you own (owned set parts x owned quantity). For each
  // candidate set, have_total = sum(min(required, owned)); req_total = sum(required).
  const sql =
    `WITH pool AS (
       SELECT sp.part_num, sp.color_id, SUM(sp.quantity * uc.quantity) AS have
       FROM user_collection uc
       JOIN set_parts sp ON sp.set_num = uc.set_num
       WHERE uc.user_id = ? AND uc.deleted_at IS NULL AND uc.is_complete = 1
       GROUP BY sp.part_num, sp.color_id
     ),
     cand AS (
       SELECT sp.set_num,
              COUNT(DISTINCT sp.part_num) AS distinct_parts,
              MAX(sp.quantity) AS max_part_qty,
              SUM(sp.quantity) AS req_total,
              SUM(MIN(sp.quantity, COALESCE(p.have, 0))) AS have_total
       FROM set_parts sp
       LEFT JOIN pool p ON p.part_num = sp.part_num AND p.color_id = sp.color_id
       WHERE sp.is_spare = 0 AND sp.set_num NOT IN (
         SELECT set_num FROM user_collection
         WHERE user_id = ? AND deleted_at IS NULL AND is_complete = 1
       )
       GROUP BY sp.set_num
     )
     SELECT c.set_num, s.name, s.theme, s.year, s.pieces, s.image_url,
            s.current_value, c.req_total, c.have_total,
            ROUND(100.0 * c.have_total / c.req_total, 1) AS pct
     FROM cand c
     JOIN lego_sets s ON s.set_num = c.set_num
     WHERE c.req_total >= ? AND c.have_total > 0
       -- Exclude spare-part / brick-pack / assortment 'sets': they are
       -- trivially 'buildable' but are not real models. Real builds use
       -- many distinct part molds and aren't dominated by one part.
       AND c.distinct_parts >= 8
       AND (c.max_part_qty * 1.0 / c.req_total) < 0.7
       AND COALESCE(s.theme, '') NOT IN ('Bulk Bricks', 'Service Packs', 'Supplemental')
       AND s.name NOT LIKE 'Basic Bricks%'
       AND s.name NOT LIKE '%Pack of%'
       AND s.name NOT LIKE '%Assortment%'
       AND s.name NOT LIKE '%Large Package%'
     ORDER BY (c.have_total >= c.req_total) DESC, pct DESC, c.req_total DESC
     LIMIT ?`;
  const rows = await env.DB.prepare(sql)
    .bind(userId, userId, minParts, lim)
    .all<Record<string, unknown>>();

  const builds = (rows.results || []).map((r) => {
    const req = Number(r.req_total) || 0;
    const have = Number(r.have_total) || 0;
    return {
      set_num: r.set_num, name: r.name, theme: r.theme, year: r.year,
      pieces: r.pieces, image_url: r.image_url, current_value: r.current_value,
      req_total: req, have_total: have,
      pct: Number(r.pct) || 0,
      need: Math.max(0, req - have),
      buildable: have >= req,
    };
  });

  const payload: BuildPayload = {
    builds,
    can_build: builds.filter((b) => b.buildable).length,
    near: builds.filter((b) => !b.buildable && b.pct >= 80).length,
    owned_sets: owned.length,
    parts_sets: cov?.n ?? 0,
    min_parts: minParts,
  };

  const fingerprint = await fingerprintFor(userId, owned, minParts, lim);
  try {
    await env.DB.prepare(
      `INSERT INTO user_build_cache (user_id, fingerprint, payload, computed_at)
       VALUES (?, ?, ?, CAST(strftime('%s','now') AS INTEGER))
       ON CONFLICT(user_id) DO UPDATE SET
         fingerprint=excluded.fingerprint, payload=excluded.payload, computed_at=excluded.computed_at`,
    ).bind(userId, fingerprint, JSON.stringify(payload)).run();
  } catch {
    // Cache write is best-effort; the live compute above already succeeded.
  }
  return { payload, cached: false };
}

// Fire-and-forget recompute used by collection mutations (add/edit/delete/
// sell/import). Never throws — a failed pre-warm just means the next Build
// visit recomputes inline, exactly as before.
export function scheduleBuildCacheRecompute(env: Env, userId: string, ctx: { waitUntil(promise: Promise<unknown>): void }): void {
  ctx.waitUntil((async () => {
    try {
      await computeAndCacheBuildableSets(env, userId);
    } catch (e) {
      console.warn('[build] background recompute failed:', (e as Error).message);
    }
  })());
}
