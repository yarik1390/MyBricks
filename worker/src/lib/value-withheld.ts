import type { Env } from '../types';

// "No market price" for no-sales sets whose estimate swings (Iaroslav's choice,
// 2026-10-27). Rare promo and exclusive items (LEGO Inside Tour sets, employee
// gifts, convention exclusives) have no BrickLink, eBay or PriceCharting sales,
// and their estimate jumped between an old stored value and the formula:
// Ole Kirk's House went $60,249 -> $257 overnight. Showing either number in a
// collector's total is worse than showing none.
//
// detectValueMovers stamps set_market_ext.value_unstable_at for those sets and
// clears it once a real sale appears. Readers withhold the value through two
// chokepoints: enrichSetRecord (every set payload) and holdingValueForRollout
// (every portfolio total). The flagged list is small, so it is loaded once per
// isolate every few minutes rather than joined into every query.

const TTL_MS = 5 * 60_000;
let memo: { sets: Set<string>; at: number } = { sets: new Set(), at: 0 };

/** Refresh the withheld list (cached per isolate). Fails open to the last list. */
export async function loadWithheldValues(env: Env): Promise<void> {
  if (Date.now() - memo.at < TTL_MS) return;
  try {
    const { results } = await env.DB.prepare(
      `SELECT set_num FROM set_market_ext WHERE value_unstable_at IS NOT NULL`,
    ).all<{ set_num: string }>();
    memo = { sets: new Set((results ?? []).map((r) => r.set_num)), at: Date.now() };
  } catch {
    // Column missing (fresh DB before migration) or a transient D1 error.
    memo = { sets: memo.sets, at: Date.now() };
  }
}

export function isValueWithheld(setNum: unknown): boolean {
  return typeof setNum === 'string' && memo.sets.has(setNum);
}

/** Tests only. */
export function setWithheldValuesForTest(setNums: string[]): void {
  memo = { sets: new Set(setNums), at: Date.now() };
}

/** Same filter the detector uses: no live sales from any market source. */
export const NO_LIVE_SALES_SQL = `ls.bl_new_value IS NULL AND ls.used_value IS NULL
  AND ls.ebay_new_value IS NULL AND ls.ebay_used_value IS NULL
  AND ls.pc_new_value IS NULL AND ls.pc_complete_value IS NULL`;
