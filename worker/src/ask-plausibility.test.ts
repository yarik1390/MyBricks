/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { plausibleAskValue } from './lib/valuation';
import { buildMarketSources, computeDealSignal } from './lib/market-sources';
import { legacySignalsFor } from './lib/valuation-v3';
import { isValidLegoSetSaleTitle } from './lib/ebay';
import { runBlendRecomputeBackfill } from './jobs/recompute-blends';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;

// The live UCS Millennium Falcon row that motivated this: an $89.95 eBay
// "asking price" (LED kits and stands quoting 75192) against ~$750 sold.
const falcon = {
  set_num: '75192-1', retail_price: 849.99, brickset_msrp: 849.99,
  ebay_new_value: 750, ebay_new_qty: 6, ebay_ask_value: 89.95, ebay_ask_qty: 19,
  stockx_ask: 738,
};

describe('plausibleAskValue', () => {
  it('drops an ask far below the set\'s own sold comps', () => {
    expect(plausibleAskValue(falcon)).toBeNull();
  });

  it('keeps an ask inside the band around the comps', () => {
    expect(plausibleAskValue({ ...falcon, ebay_ask_value: 720 })).toBe(720);
    expect(plausibleAskValue({ ...falcon, ebay_ask_value: 300 })).toBe(300); // a real discount is kept
  });

  it('drops an ask wildly above the comps', () => {
    expect(plausibleAskValue({ ebay_ask_value: 4597, bl_new_value: 500 })).toBeNull();
  });

  it('uses an independent retail anchor as a floor only when no comps exist', () => {
    expect(plausibleAskValue({ ebay_ask_value: 57.99, brickset_msrp: 499.99 })).toBeNull();
    // Retired sets legitimately list at many times RRP: retail never caps the top.
    expect(plausibleAskValue({ ebay_ask_value: 3500, brickset_msrp: 499.99 })).toBe(3500);
  });

  it('ignores BrickEconomy as a reference (the ask corroborates it, not vice versa)', () => {
    expect(plausibleAskValue({ ebay_ask_value: 300, be_value_new: 15000 })).toBe(300);
  });

  it('passes an ask through when nothing can judge it', () => {
    expect(plausibleAskValue({ ebay_ask_value: 42 })).toBe(42);
    expect(plausibleAskValue({})).toBeNull();
  });
});

describe('junk asks never reach users', () => {
  it('does not badge an accessory-contaminated ask as a deal', () => {
    const d = computeDealSignal(falcon, { value: 699.99, confidence: 'high' });
    expect(d.signal).toBeNull();
    expect(d.available_price).toBeNull();
  });

  it('never calls a buy more than 60% under a corroborated value', () => {
    // No comps on the row to screen the ask, but the discount alone is not credible.
    const d = computeDealSignal({ ebay_ask_value: 40 }, { value: 1000, confidence: 'medium' });
    expect(d.signal).toBeNull();
  });

  it('still flags a genuine discount', () => {
    const d = computeDealSignal({ ...falcon, ebay_ask_value: 560 }, { value: 699.99, confidence: 'high' });
    expect(d.signal).toBe('buy');
    expect(d.available_price).toBe(560);
  });

  it('omits the implausible ask from the source list', () => {
    expect(buildMarketSources(falcon).some(s => s.id === 'ebay_ask')).toBe(false);
    expect(buildMarketSources({ ...falcon, ebay_ask_value: 720 }).find(s => s.id === 'ebay_ask')?.value).toBe(720);
  });

  it('lets a junk ask neither enter v3 nor veto a plausible BrickEconomy value', () => {
    // Retired $89.99 set, BE says $400, the only "corroborator" is a $29.36 ask.
    const row = {
      set_num: '7783-1', valuation_method: 'brickeconomy', brickset_msrp: 89.99, pieces: 1075,
      be_value_new: 400, be_cached_at: new Date().toISOString(),
      ebay_ask_value: 29.36, ebay_ask_qty: 5, ebay_ask_cached_at: new Date().toISOString(),
    };
    const signals = legacySignalsFor(row);
    expect(signals.some(s => s.source === 'ebay_asking')).toBe(false);
    expect(signals.find(s => s.source === 'brickeconomy_new')?.match_status).toBe('verified');
  });
});

describe('eBay title screen', () => {
  it('rejects accessory listings that quote the set number', () => {
    for (const title of [
      'LED Light Kit for LEGO 75192 Millennium Falcon',
      'Lighting set for Lego 10182 Cafe Corner',
      'Acrylic Display Case for LEGO 75192',
      'Display Stand for LEGO Star Wars 75192 UCS',
      'Wall Mount compatible with Lego 75159',
      'LEGO 10185 Green Grocer - set not included',
    ]) expect(isValidLegoSetSaleTitle(title, title.match(/\d{4,5}/)![0] + '-1'), title).toBe(false);
  });

  it('keeps real set listings, including light-up set names', () => {
    expect(isValidLegoSetSaleTitle('LEGO Star Wars 75192 Millennium Falcon UCS New Sealed', '75192-1')).toBe(true);
    expect(isValidLegoSetSaleTitle('LEGO 7261 Clone Turbo Tank Light-Up Mace Windu NISB', '7261-1')).toBe(true);
    expect(isValidLegoSetSaleTitle('Lego 10182 Cafe Corner modular sealed', '10182-1')).toBe(true);
  });
});

describe('persisted deal re-check', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'set_market_ext', 'user_collection', 'user_wishlist', 'user_prefs', 'set_value_history', 'set_valuation_state', 'pricing_write_ledger', 'pricing_signals', 'app_settings']);
  });

  it('re-derives stale buy rows outside the rotation page', async () => {
    const now = new Date().toISOString();
    await db.prepare(`INSERT INTO lego_sets (set_num, name) VALUES ('A-1', 'A')`).run();
    await db.prepare(
      `INSERT INTO lego_sets (set_num, name, valuation_method, retail_price, bl_new_value, bl_new_qty, bl_cached_at,
         ebay_new_value, ebay_new_qty, ebay_new_cached_at, ebay_ask_value, ebay_ask_qty, ebay_ask_cached_at,
         deal_signal, deal_discount_pct)
       VALUES ('Z-1', 'Z', 'market', 139.99, 2000, 8, ?1, 2300, 6, ?1, 204.5, 6, ?1, 'buy', 93.5)`,
    ).bind(now).run();
    // Page of one: the rotation only visits A-1, the deal lane reaches Z-1.
    await runBlendRecomputeBackfill(env as any, { limit: 1 });
    const row = await db.prepare(`SELECT deal_signal FROM lego_sets WHERE set_num='Z-1'`).first<{ deal_signal: string | null }>();
    expect(row!.deal_signal).not.toBe('buy');
  });
});
