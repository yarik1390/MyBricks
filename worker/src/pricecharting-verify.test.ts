/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { runPriceChartingVerify } from './jobs/pricecharting-verify';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;

describe('runPriceChartingVerify (price-agreement promotion)', () => {
  beforeEach(async () => {
    await applyTestTables(db, [
      'lego_sets', 'set_market_ext', 'pricing_source_map', 'pricing_signals',
      'set_valuation_state', 'app_settings', 'user_collection', 'user_wishlist',
    ]);
  });

  it('verifies agreeing mappings, leaves disagreeing and uncorroborated ones quarantined', async () => {
    await db.batch([
      // PC $105 vs BrickLink $100 sold (12 lots) — agreement, promote.
      db.prepare(`INSERT INTO lego_sets (set_num, name, pc_id, pc_new_value, pc_complete_value, pc_cached_at, bl_new_value, bl_new_qty) VALUES ('AGREE-1','Agreeing set','pc123', 105, 80, datetime('now'), 100, 12)`),
      db.prepare(`INSERT INTO set_market_ext (set_num, pc_loose_value, pc_sales_volume) VALUES ('AGREE-1', 55, 40)`),
      // PC $900 vs BrickLink $100 — a wrong-item mapping; must stay out.
      db.prepare(`INSERT INTO lego_sets (set_num, name, pc_id, pc_new_value, bl_new_value) VALUES ('WRONG-1','Mismatched set','pc999', 900, 100)`),
      // PC value but no independent comp — nothing to agree with; stays out.
      db.prepare(`INSERT INTO lego_sets (set_num, name, pc_new_value) VALUES ('LONE-1','Uncorroborated set', 250)`),
      // Agreement via the eBay sold column (no BrickLink), and no pc_id —
      // the synthetic legacy item id path.
      db.prepare(`INSERT INTO lego_sets (set_num, name, pc_new_value, ebay_new_value, pc_cached_at) VALUES ('EBAY-1','Ebay-corroborated set', 60, 50, datetime('now'))`),
    ]);

    const r = await runPriceChartingVerify(env as any);

    expect(r.skipped).toBeUndefined();
    expect(r.promoted).toBe(2);
    const mapRows = await db.prepare(`SELECT set_num, source_item_id, match_method, status FROM pricing_source_map ORDER BY set_num`).all<{ set_num: string; source_item_id: string; match_method: string; status: string }>();
    expect(mapRows.results).toEqual([
      { set_num: 'AGREE-1', source_item_id: 'pc123', match_method: 'price_agreement', status: 'verified' },
      { set_num: 'EBAY-1', source_item_id: 'legacy:EBAY-1', match_method: 'price_agreement', status: 'verified' },
    ]);

    // Signals materialized for verified mappings only — all three conditions
    // for AGREE-1 (new/complete from lego_sets, loose from set_market_ext).
    const sig = await db.prepare(`SELECT set_num, condition, value, sales_volume, match_status FROM pricing_signals ORDER BY set_num, condition`).all<Record<string, unknown>>();
    expect(sig.results).toEqual([
      { set_num: 'AGREE-1', condition: 'loose', value: 55, sales_volume: 40, match_status: 'verified' },
      { set_num: 'AGREE-1', condition: 'new_sealed', value: 105, sales_volume: 40, match_status: 'verified' },
      { set_num: 'AGREE-1', condition: 'used_complete', value: 80, sales_volume: 40, match_status: 'verified' },
      { set_num: 'EBAY-1', condition: 'new_sealed', value: 60, sales_volume: null, match_status: 'verified' },
    ]);
  });

  it('promotes on used-condition agreement (PC complete vs used comp) with no new comp', async () => {
    await db.batch([
      // PC complete $80 agrees with BrickLink used_value $75; there is NO
      // new-condition comp, so only the used axis can confirm identity.
      db.prepare(`INSERT INTO lego_sets (set_num, name, pc_id, pc_complete_value, pc_cached_at, used_value) VALUES ('USED-1','Used-corroborated set','pcU', 80, datetime('now'), 75)`),
      // PC complete $500 vs used_value $75 — disagreement; a wrong-item mapping,
      // stays quarantined.
      db.prepare(`INSERT INTO lego_sets (set_num, name, pc_id, pc_complete_value, used_value) VALUES ('USEDBAD-1','Wrong item','pcB', 500, 75)`),
    ]);

    const r = await runPriceChartingVerify(env as any);
    expect(r.skipped).toBeUndefined();
    expect(r.promoted).toBe(1);
    const mapRows = await db.prepare(`SELECT set_num, status, match_method FROM pricing_source_map ORDER BY set_num`).all<{ set_num: string; status: string; match_method: string }>();
    expect(mapRows.results).toEqual([
      { set_num: 'USED-1', status: 'verified', match_method: 'price_agreement' },
    ]);
    // The used_complete signal is materialized from pc_complete_value.
    const sig = await db.prepare(`SELECT set_num, condition, value FROM pricing_signals ORDER BY set_num, condition`).all<Record<string, unknown>>();
    expect(sig.results).toEqual([
      { set_num: 'USED-1', condition: 'used_complete', value: 80 },
    ]);
  });

  it('is idempotent — a second run promotes nothing new and rewrites no signals', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, pc_id, pc_new_value, bl_new_value) VALUES ('AGREE-2','Set','pcA', 110, 100)`),
    ]);
    const first = await runPriceChartingVerify(env as any);
    expect(first.promoted).toBe(1);
    const second = await runPriceChartingVerify(env as any);
    expect(second.promoted).toBe(0);
    expect(second.signals).toBe(0); // change-only upsert: unchanged prices write nothing
  });

  it('drain mode still materializes signals for what it promotes', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, pc_id, pc_new_value, bl_new_value) VALUES ('DRAIN-1','Set','pcD', 110, 100)`),
    ]);
    const r = await runPriceChartingVerify(env as any, { limit: 400, refreshSignals: false });
    expect(r.promoted).toBe(1);
    const sig = await db.prepare(`SELECT COUNT(*) AS n FROM pricing_signals WHERE set_num='DRAIN-1'`).first<{ n: number }>();
    expect(sig!.n).toBe(1);
    // Drained: the next drain-mode run skips the signal sweep entirely.
    const idle = await runPriceChartingVerify(env as any, { limit: 400, refreshSignals: false });
    expect(idle.promoted).toBe(0);
    expect(idle.signals).toBe(0);
  });

  it('never demotes a manually verified mapping', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, pc_id, pc_new_value, bl_new_value) VALUES ('MAN-1','Set','pcM', 110, 100)`),
      db.prepare(`INSERT INTO pricing_source_map (source, source_item_id, set_num, match_method, match_confidence, status) VALUES ('pricecharting','pcM','MAN-1','manual',1.0,'manual')`),
    ]);
    const r = await runPriceChartingVerify(env as any);
    expect(r.promoted).toBe(0); // already verified/manual — not a candidate
    const row = await db.prepare(`SELECT status, match_method FROM pricing_source_map WHERE source_item_id='pcM'`).first<{ status: string; match_method: string }>();
    expect(row!.status).toBe('manual');
    expect(row!.match_method).toBe('manual');
  });
});
