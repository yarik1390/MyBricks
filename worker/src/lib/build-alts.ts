// build-alts.ts — alternate-builds (MOC) indexer for "What can I build?".
//
// Alternates come from Rebrickable's per-set /alternates/ endpoint and are
// cached in D1 (set_alt_builds + set_alts_fetched). The route only indexes
// SYNC_FETCH_CAP sets per visit, so a large vault would take dozens of Build
// visits to fill in — and one thrown error (rate limit, network blip, D1 hiccup)
// aborted the whole pass. This module provides:
//   • indexMissingAlts(env, opts) — resilient batch indexer (per-set try/catch),
//     reusable from the cron scheduler and the admin job runner;
//   • ensureAltsCached moved here so the route and the job share one impl.

import type { Env } from '../types';
import { fetchSetAlternates } from './rebrickable';

export const ALT_SYNC_CAP = 6;

// Ensure set_alt_builds is populated for the given sets. Sets we've never
// fetched are pulled from Rebrickable (capped), cached, and marked fetched.
// Returns the number of sets still un-indexed after this pass.
export async function ensureAltsCached(env: Env, setNums: string[]): Promise<number> {
  if (!setNums.length) return 0;
  // D1 allows at most 100 bound parameters per individual statement on every
  // plan. A serious collector can own far more than that, so discover cached
  // sets in bounded chunks rather than building one unbounded IN (...).
  const done = new Set<string>();
  for (let i = 0; i < setNums.length; i += 90) {
    const chunk = setNums.slice(i, i + 90);
    const ph = chunk.map(() => '?').join(',');
    const fetched = await env.DB.prepare(
      `SELECT set_num FROM set_alts_fetched WHERE set_num IN (${ph})`,
    ).bind(...chunk).all<{ set_num: string }>();
    for (const row of fetched.results || []) done.add(row.set_num);
  }
  const pending = setNums.filter((s) => !done.has(s));
  if (!pending.length) return 0;

  const toFetch = pending.slice(0, ALT_SYNC_CAP);
  let failed = 0;
  for (const setNum of toFetch) {
    try {
      const alts = await fetchSetAlternates(setNum, env);
      if (alts === null) { failed++; continue; } // missing key / hard failure — retry next time
      const stmts: D1PreparedStatement[] = alts.map((a) => env.DB.prepare(
        `INSERT INTO set_alt_builds
           (set_num,moc_num,name,num_parts,year,designer,moc_img_url,moc_url,cached_at)
         VALUES (?,?,?,?,?,?,?,?,datetime('now'))
         ON CONFLICT(set_num,moc_num) DO UPDATE SET
           name=excluded.name, num_parts=excluded.num_parts, year=excluded.year,
           designer=excluded.designer, moc_img_url=excluded.moc_img_url,
           moc_url=excluded.moc_url, cached_at=datetime('now')`,
      ).bind(setNum, a.moc_num, a.name, a.num_parts, a.year, a.designer,
             a.moc_img_url, a.moc_url));
      stmts.push(env.DB.prepare(
        `INSERT INTO set_alts_fetched (set_num,fetched_at,alt_count)
         VALUES (?,datetime('now'),?)
         ON CONFLICT(set_num) DO UPDATE SET
           fetched_at=datetime('now'), alt_count=excluded.alt_count`,
      ).bind(setNum, alts.length));
      for (let i = 0; i < stmts.length; i += 100) {
        await env.DB.batch(stmts.slice(i, i + 100));
      }
    } catch (e) {
      // One bad set must not abort indexing of the rest of this pass.
      console.warn(`[build-alts] ${setNum} index failed:`, (e as Error).message);
      failed++;
    }
  }
  return Math.max(0, pending.length - ALT_SYNC_CAP + failed);
}

export interface AltIndexResult {
  indexed: number;   // sets newly marked fetched
  alts: number;      // total alternate builds stored (new rows upserted)
  remaining: number; // owned sets still un-indexed after this pass
}

// Batch indexer for scheduled/admin runs: walks every distinct set in
// user_collection that has never been alt-indexed, oldest-added first, and
// indexes up to `limit` of them with per-set error isolation.
export async function indexMissingAlts(
  env: Env,
  opts: { limit?: number; userId?: string } = {},
): Promise<AltIndexResult> {
  const limit = Math.max(1, Math.min(opts.limit ?? 40, 150));
  const ownedRes = await env.DB.prepare(
    `SELECT DISTINCT uc.set_num
     FROM user_collection uc
     LEFT JOIN set_alts_fetched f ON f.set_num = uc.set_num
     WHERE uc.deleted_at IS NULL AND uc.is_complete = 1 AND f.set_num IS NULL
       ${opts.userId ? 'AND uc.user_id = ?' : ''}
     ORDER BY uc.added_at ASC
     LIMIT ?`,
  ).bind(...(opts.userId ? [opts.userId, limit] : [limit]))
   .all<{ set_num: string }>();
  const pending = (ownedRes.results || []).map((r) => r.set_num);

  let indexed = 0;
  let alts = 0;
  for (const setNum of pending) {
    try {
      const found = await fetchSetAlternates(setNum, env);
      if (found === null) continue; // key outage / hard failure: leave unmarked
      const stmts: D1PreparedStatement[] = found.map((a) => env.DB.prepare(
        `INSERT INTO set_alt_builds
           (set_num,moc_num,name,num_parts,year,designer,moc_img_url,moc_url,cached_at)
         VALUES (?,?,?,?,?,?,?,?,datetime('now'))
         ON CONFLICT(set_num,moc_num) DO UPDATE SET
           name=excluded.name, num_parts=excluded.num_parts, year=excluded.year,
           designer=excluded.designer, moc_img_url=excluded.moc_img_url,
           moc_url=excluded.moc_url, cached_at=datetime('now')`,
      ).bind(setNum, a.moc_num, a.name, a.num_parts, a.year, a.designer,
             a.moc_img_url, a.moc_url));
      stmts.push(env.DB.prepare(
        `INSERT INTO set_alts_fetched (set_num,fetched_at,alt_count)
         VALUES (?,datetime('now'),?)
         ON CONFLICT(set_num) DO UPDATE SET
           fetched_at=datetime('now'), alt_count=excluded.alt_count`,
      ).bind(setNum, found.length));
      await env.DB.batch(stmts);
      indexed++;
      alts += found.length;
    } catch (e) {
      console.warn(`[build-alts] batch index ${setNum} failed:`, (e as Error).message);
    }
  }

  const remRow = await env.DB.prepare(
    `SELECT COUNT(DISTINCT uc.set_num) AS n
     FROM user_collection uc
     LEFT JOIN set_alts_fetched f ON f.set_num = uc.set_num
     WHERE uc.deleted_at IS NULL AND uc.is_complete = 1 AND f.set_num IS NULL`,
  ).first<{ n: number }>();
  return { indexed, alts, remaining: remRow?.n ?? 0 };
}
