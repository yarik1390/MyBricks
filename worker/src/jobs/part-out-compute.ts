import type { Env } from '../types';
import { computePartOutValue, partKey, type PartLot } from '../lib/part-out';

/**
 * Compute and store each set's part-out (sum-of-parts) value from the shared
 * part_prices cache. Pure D1 — no external calls, no quota: reads each due set's
 * parts + cached unit prices, sums via computePartOutValue (the same tested
 * logic the rest of the app uses), and stores part_out_value + part_out_coverage
 * (raw — the display gate on coverage lives in enrichSetRecord, so it can be
 * tuned without recompute). Recomputes on a rolling 7-day cycle, never-computed
 * and owned/wishlisted/high-value sets first, so values track the price trickle.
 */
export async function runPartOutCompute(env: Env, options: { limit?: number } = {}) {
  const requestedLimit = Number(options.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 500)
    : 120;

  const { results: sets } = await env.DB.prepare(`
    SELECT ls.set_num
    FROM lego_sets ls
    WHERE ls.year >= 2000
      AND EXISTS (SELECT 1 FROM set_parts sp WHERE sp.set_num = ls.set_num)
      AND (ls.part_out_cached_at IS NULL OR ls.part_out_cached_at < datetime('now', '-7 days'))
    ORDER BY
      CASE WHEN ls.part_out_cached_at IS NULL THEN 0 ELSE 1 END,
      CASE WHEN EXISTS (
        SELECT 1 FROM user_collection uc WHERE uc.set_num = ls.set_num AND uc.deleted_at IS NULL
      ) OR EXISTS (
        SELECT 1 FROM user_wishlist uw WHERE uw.set_num = ls.set_num
      ) THEN 0 ELSE 1 END,
      COALESCE(NULLIF(ls.blended_value, 0), ls.current_value, 0) DESC
    LIMIT ?
  `).bind(limit).all<{ set_num: string }>();

  if (!sets.length) return { processed: 0, valued: 0, limit };

  const ids = sets.map((s) => s.set_num);
  const partsBySet = new Map<string, PartLot[]>();
  const priceMap = new Map<string, number>();

  // Load parts + cached prices in bounded chunks (one read per chunk), grouping
  // by set. priceMap is shared across chunks since parts recur across sets.
  const CHUNK = 30;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const ph = chunk.map(() => '?').join(',');
    const { results } = await env.DB.prepare(`
      SELECT sp.set_num, sp.part_num, sp.color_id, sp.quantity, sp.is_spare, pp.price_new
      FROM set_parts sp
      LEFT JOIN part_prices pp ON pp.part_num = sp.part_num AND pp.color_id = sp.color_id
      WHERE sp.set_num IN (${ph})
    `).bind(...chunk).all<{
      set_num: string; part_num: string; color_id: number; quantity: number; is_spare: number; price_new: number | null;
    }>();
    for (const r of results) {
      let arr = partsBySet.get(r.set_num);
      if (!arr) { arr = []; partsBySet.set(r.set_num, arr); }
      arr.push({ part_num: r.part_num, color_id: r.color_id, quantity: r.quantity, is_spare: r.is_spare });
      if (r.price_new != null && r.price_new > 0) priceMap.set(partKey(r.part_num, r.color_id), r.price_new);
    }
  }

  let processed = 0;
  let valued = 0;
  const updates: D1PreparedStatement[] = [];
  for (const set_num of ids) {
    processed++;
    const po = computePartOutValue(partsBySet.get(set_num) || [], priceMap);
    if (po.value != null) valued++;
    updates.push(env.DB.prepare(
      `UPDATE lego_sets SET part_out_value=?, part_out_coverage=?, part_out_cached_at=datetime('now') WHERE set_num=?`,
    ).bind(po.value, po.coverage, set_num));
  }

  for (let i = 0; i < updates.length; i += 90) await env.DB.batch(updates.slice(i, i + 90));
  return { processed, valued, limit };
}
