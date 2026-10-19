// ---------------------------------------------------------------------------
// Set detail for signed-out callers: our own estimate, not the per-source feed.
//
// GET /api/sets/:setnum is public (guests browse the catalog), and the full
// body carries every partner's raw numbers — BrickLink min/avg/max, eBay sold
// and asking prices, BrickEconomy, PriceCharting volume, the value model. Our
// partners' terms allow showing those to app users, not redistributing them;
// served unauthenticated they let anyone script a copy of all their data. So a
// guest gets the blended market value, its range and confidence, and which
// sources fed it (attribution), but not the sources' own figures.
// ---------------------------------------------------------------------------

const SOURCE_PREFIXES = ['ebay_', 'bl_', 'be_', 'bo_', 'pa_', 'pc_', 'model_'];
const SOURCE_KEYS = new Set([
  'sales_volume',
  // The cheapest live listing (an eBay or BrickLink ask), not our number.
  'deal_available_price', 'deal_available_channel', 'deal_available_merchant',
]);

function withoutValues(list: unknown): unknown {
  if (!Array.isArray(list)) return list;
  return list.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const { value: _value, sample_count: _n, ...rest } = item as Record<string, unknown>;
    return rest;
  });
}

export function publicSetDetail(set: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(set)) {
    if (SOURCE_KEYS.has(key) || SOURCE_PREFIXES.some((p) => key.startsWith(p))) continue;
    out[key] = value;
  }
  out.market_sources = withoutValues(set.market_sources);
  out.market_value_basis = withoutValues(set.market_value_basis);
  const valuation = set.valuation as Record<string, unknown> | null | undefined;
  if (valuation && typeof valuation === 'object') {
    const v: Record<string, unknown> = { ...valuation };
    for (const cond of ['new', 'used']) {
      const state = v[cond] as Record<string, unknown> | null | undefined;
      if (state && typeof state === 'object') v[cond] = { ...state, basis: withoutValues(state.basis) };
    }
    out.valuation = v;
  }
  return out;
}
