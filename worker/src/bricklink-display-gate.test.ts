import { describe, it, expect } from 'vitest';
import {
  buildMarketSources,
  enrichSetRecord,
  marketConfidence,
  primaryValueSource,
  valuationExplanation,
  bricklinkDisplayable,
  BRICKLINK_DISPLAY_MAX_AGE_HOURS,
} from './lib/market-sources';

// BrickLink's written permission allows a free app to display its price-guide
// content only while it is at most 24h older than the live site. These tests pin
// that boundary in both directions AND the fact that the gate is presentation
// only — it must not move confidence tiers or blend inputs.
describe('BrickLink 24h display gate', () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600 * 1000).toISOString();

  const row = (blCachedAt: string | null) => ({
    set_num: 'GATE-1',
    valuation_method: 'market',
    current_value: 120,
    bl_new_value: 120,
    bl_new_min: 100,
    bl_new_max: 140,
    bl_new_qty: 8,
    bl_used_qty: 4,
    used_value: 90,
    bl_cached_at: blCachedAt,
    cached_at: blCachedAt,
  });

  it('honors the boundary exactly at the 24h edge', () => {
    expect(bricklinkDisplayable(row(hoursAgo(23)))).toBe(true);
    expect(bricklinkDisplayable(row(hoursAgo(25)))).toBe(false);
    expect(bricklinkDisplayable(row(null))).toBe(false);
    expect(bricklinkDisplayable(row('not-a-date'))).toBe(false);
    expect(BRICKLINK_DISPLAY_MAX_AGE_HOURS).toBe(24);
  });

  it('names BrickLink and publishes guide figures inside the window', () => {
    const fresh = row(hoursAgo(2));
    const sources = buildMarketSources(fresh);
    const bl = sources.find((s) => s.id === 'bricklink_new');
    expect(bl?.value).toBe(120);
    expect(bl?.name).toBe('BrickLink');
    expect(primaryValueSource(fresh)).toBe('bricklink_new');
    expect(valuationExplanation(fresh, 'medium', 'fresh')).toContain('BrickLink');

    const out = enrichSetRecord({ ...fresh }) as Record<string, unknown>;
    expect(out.bl_new_value).toBe(120);
    expect(out.bl_new_qty).toBe(8);
  });

  it('withholds BrickLink name, guide figures and payload columns outside the window', () => {
    const stale = row(hoursAgo(30 * 24));
    const sources = buildMarketSources(stale);
    expect(sources.some((s) => s.id === 'bricklink_new')).toBe(false);
    expect(sources.some((s) => s.id === 'bricklink_used')).toBe(false);
    expect(sources.some((s) => /bricklink/i.test(s.name))).toBe(false);

    expect(primaryValueSource(stale)).toBe('derived_market');
    expect(valuationExplanation(stale, 'medium', 'fresh')).not.toContain('BrickLink');

    // The detail endpoint SELECT *s the row, so the raw guide columns have to be
    // stripped from the payload or the client re-renders them from its fallback.
    const out = enrichSetRecord({ ...stale }) as Record<string, unknown>;
    for (const key of ['bl_new_value', 'bl_new_min', 'bl_new_max', 'bl_new_qty',
      'bl_used_min', 'bl_used_max', 'bl_used_qty', 'bl_cached_at']) {
      expect(out[key], `${key} must not be published outside the 24h window`).toBeUndefined();
    }
    // The value itself is ours, so the estimate is still published.
    expect(out.current_value).toBe(120);
    expect(out.market_value).toBeGreaterThan(0);
  });

  it('keeps the confidence tier identical either side of the gate', () => {
    // Whether we may re-publish the figures and how strong the evidence is are
    // separate questions; gating display must not silently downgrade badges.
    expect(marketConfidence(row(hoursAgo(2)))).toBe(marketConfidence(row(hoursAgo(30 * 24))));
  });
});

// PriceCharting's permission covers ATTRIBUTED estimates carrying a direct
// product link. The provider-native price columns are read server-side by the
// blend and must not ride along in a public payload where they could be shown
// with no credit and no link. The one figure the UI does consume
// (pc_sales_volume, the liquidity badge) is deliberately kept.
describe('PriceCharting raw columns never reach a public payload', () => {
  it('strips the provider-native price columns but keeps the attributed path', () => {
    const out = enrichSetRecord({
      set_num: 'PC-1',
      valuation_method: 'market',
      current_value: 120,
      pc_new_value: 130,
      pc_complete_value: 95,
      pc_loose_value: 70,
      pc_cached_at: '2026-09-20 04:31:00',
      pc_sales_volume: 42,
      pc_id: '7725504',
      __pricecharting_item_id: '7725504',
    }) as Record<string, unknown>;

    for (const key of ['pc_new_value', 'pc_complete_value', 'pc_loose_value', 'pc_cached_at', 'pc_id']) {
      expect(out[key], `${key} must not be published`).toBeUndefined();
    }
    // Kept: the liquidity badge's input and the attributed identity, which is
    // what carries the credit + direct product link.
    expect(out.pc_sales_volume).toBe(42);
    expect(out.pricecharting_item_id).toBe('7725504');
  });
});
