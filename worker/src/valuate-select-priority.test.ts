/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyTestTables } from './test-schema';
import { hasPositiveLegacySealedValue, selectDueSets } from './jobs/valuate-select';

const db = (env as any).DB as D1Database;

interface SeedOptions {
  ageHours?: number;
  value?: number;
  year?: number;
  blValue?: number | null;
  valuationMethod?: string;
  pcValue?: number | null;
}

async function insertSet(setNum: string, options: SeedOptions = {}) {
  const ageHours = options.ageHours ?? 23;
  const value = options.value ?? 200;
  await db.prepare(`INSERT INTO lego_sets
    (set_num, name, theme, year, pieces, retired, current_value, blended_value,
     valuation_method, valuation_expires_at, bl_new_value, bl_cached_at, pc_new_value)
    VALUES (?1, ?1, 'Town', ?2, 500, 1, ?3, ?3, ?4, datetime('now', '-1 day'),
            ?5, datetime('now', ?6), ?7)`)
    .bind(
      setNum,
      options.year ?? 2000,
      value,
      options.valuationMethod ?? 'market',
      options.blValue === undefined ? 120 : options.blValue,
      `-${ageHours} hours`,
      options.pcValue ?? null,
    ).run();
}

async function selectBrickLink(limit = 20) {
  return selectDueSets({ ...(env as any), BRICKLINK_CONSUMER_KEY: 'test-key' }, {
    scope: 'all', options: { limit, blStale: true },
    includeSupplemental: false, includeBrickLink: true, includeEbay: false,
    includeEbaySold: false, includeAiFallback: false,
  });
}

describe('dedicated BrickLink refresh selection', () => {
  beforeEach(async () => {
    await applyTestTables(db, [
      'lego_sets', 'set_market_ext', 'user_collection', 'user_wishlist',
      'api_quota', 'integration_health', 'pricing_signals',
    ]);
  });

  it('selects 23h and 25h rows but leaves a genuinely fresh row alone', async () => {
    await insertSet('BL-23H', { ageHours: 23 });
    await insertSet('BL-25H', { ageHours: 25 });
    await insertSet('BL-FRESH', { ageHours: 21 });

    const { results } = await selectBrickLink();
    const picked = results.map((row) => row.set_num);
    expect(picked).toContain('BL-23H');
    expect(picked).toContain('BL-25H');
    expect(picked).not.toContain('BL-FRESH');
  });

  it('orders owned, wishlist, then catalogue rows by value and newest year', async () => {
    await insertSet('OWNED', { value: 100, year: 1990 });
    await insertSet('WISHED', { value: 90, year: 2025 });
    await insertSet('CAT-HIGH', { value: 900, year: 1995 });
    await insertSet('CAT-NEW', { value: 500, year: 2026 });
    await insertSet('CAT-OLD', { value: 500, year: 1980 });
    await db.batch([
      db.prepare(`INSERT INTO user_collection (user_id, set_num) VALUES ('u1', 'OWNED')`),
      db.prepare(`INSERT INTO user_wishlist (user_id, set_num) VALUES ('u1', 'WISHED')`),
    ]);

    const { results } = await selectBrickLink();
    expect(results.map((row) => row.set_num)).toEqual([
      'OWNED', 'WISHED', 'CAT-HIGH', 'CAT-NEW', 'CAT-OLD',
    ]);
  });

  it('bounds starvation by promoting a week-old catalogue row above personal rows', async () => {
    await insertSet('AGED', { ageHours: 8 * 24, value: 1 });
    await insertSet('OWNED-23H', { ageHours: 23, value: 999 });
    await db.prepare(`INSERT INTO user_collection (user_id, set_num) VALUES ('u1', 'OWNED-23H')`).run();

    const { results } = await selectBrickLink(1);
    expect(results[0]?.set_num).toBe('AGED');
  });

  it('keeps the 90-day BrickLink no-data backoff out of quota grants', async () => {
    await insertSet('BACKED-OFF');
    await db.prepare(`INSERT INTO set_market_ext (set_num, bl_nodata_at)
      VALUES ('BACKED-OFF', datetime('now', '-10 days'))`).run();

    const selected = await selectDueSets({ ...(env as any), BRICKLINK_CONSUMER_KEY: 'test-key' }, {
      scope: 'all', options: { limit: 10, blStale: true },
      includeSupplemental: false, includeBrickLink: true, includeEbay: false,
      includeEbaySold: false, includeAiFallback: false,
    });
    expect(selected.results.map((row) => row.set_num)).toContain('BACKED-OFF');
    expect(selected.grants.bricklink).toBe(0);
  });
});

describe('legacy sealed-target priority semantics', () => {
  beforeEach(async () => {
    await applyTestTables(db, [
      'lego_sets', 'set_market_ext', 'user_collection', 'user_wishlist',
      'api_quota', 'integration_health', 'pricing_signals',
    ]);
  });

  it('does not describe positive used or raw PriceCharting fields as sealed evidence', () => {
    expect(hasPositiveLegacySealedValue({ bl_new_value: 0, ebay_new_value: null })).toBe(false);
    expect(hasPositiveLegacySealedValue({ used_value: 90, pc_new_value: 140 })).toBe(false);
    expect(hasPositiveLegacySealedValue({ be_value_new: 110 })).toBe(true);
  });

  it('does not let a quarantined PriceCharting signal displace a no-sealed-value row', async () => {
    await insertSet('A-NO-SEALED', { blValue: null, valuationMethod: 'formula_bulk' });
    await insertSet('Z-PC-QUARANTINED', {
      blValue: null, valuationMethod: 'formula_bulk', pcValue: 800,
    });
    await db.prepare(`INSERT INTO pricing_signals
      (set_num, source, source_item_id, provider_family, condition, signal_type,
       value, checked_at, match_status)
      VALUES ('Z-PC-QUARANTINED', 'pricecharting', 'pc-1', 'pricecharting',
              'new_sealed', 'modeled', 800, datetime('now'), 'quarantined')`).run();

    const { results } = await selectDueSets(env as any, {
      scope: 'all', options: { limit: 10 },
      includeSupplemental: false, includeBrickLink: false, includeEbay: false,
      includeEbaySold: false, includeAiFallback: false,
    });
    expect(results.map((row) => row.set_num).slice(0, 2)).toEqual([
      'A-NO-SEALED', 'Z-PC-QUARANTINED',
    ]);
  });
});
