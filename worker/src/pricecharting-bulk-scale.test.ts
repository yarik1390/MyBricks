/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runPriceChartingBulk } from './jobs/pricecharting-bulk';
import { recomputeBlendedValues } from './lib/market-sources';
import { clearSourceConfigCache, saveSourceConfig } from './lib/source-config';

vi.mock('./lib/market-sources', () => ({
  recomputeBlendedValues: vi.fn(async () => 0),
}));

const db = (env as any).DB as D1Database;
const enabledEnv = () => ({ ...env, PRICECHARTING_PRO: '1', PRICECHARTING_VERIFIED_ENABLED: '1' } as any);

const HEADER = 'id,console-name,upc,product-name,loose-price,cib-price,new-price,sales-volume';

const OLD = '2026-08-01T00:00:00Z';

async function importRows(rows: string[]) {
  const e = enabledEnv();
  await saveSourceConfig(e, { pricecharting: { enabled: true, weight: 1 } } as any);
  clearSourceConfigCache();
  return runPriceChartingBulk(e, [HEADER, ...rows].join('\n'));
}

describe('PriceCharting bulk import at catalog scale', () => {
  beforeEach(async () => {
    vi.mocked(recomputeBlendedValues).mockClear();
    for (const table of ['lego_sets', 'set_market_ext', 'app_settings', 'pricing_source_map', 'pricing_signals', 'user_collection', 'user_wishlist']) {
      await db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
    }
    await db.prepare(`CREATE TABLE lego_sets (
      set_num TEXT PRIMARY KEY, name TEXT, upc TEXT, category TEXT, pc_id TEXT,
      pc_new_value REAL, pc_complete_value REAL, pc_cached_at TEXT,
      blended_value REAL, current_value REAL
    )`).run();
    await db.prepare(`CREATE TABLE set_market_ext (
      set_num TEXT PRIMARY KEY, pc_loose_value REAL, pc_sales_volume INTEGER
    )`).run();
    await db.prepare(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)`).run();
    await db.prepare(`CREATE TABLE pricing_source_map (
      source TEXT, source_item_id TEXT, set_num TEXT, source_title TEXT, upc TEXT,
      variant_key TEXT, match_method TEXT, match_confidence REAL, status TEXT,
      verified_at TEXT, created_at TEXT, updated_at TEXT, PRIMARY KEY(source, source_item_id)
    )`).run();
    await db.prepare(`CREATE TABLE pricing_signals (
      set_num TEXT, source TEXT, source_item_id TEXT, provider_family TEXT,
      condition TEXT, signal_type TEXT, currency TEXT, value REAL, low REAL, high REAL,
      sample_count INTEGER, sales_volume INTEGER, source_observed_at TEXT, checked_at TEXT,
      match_status TEXT, flags_json TEXT, updated_at TEXT,
      PRIMARY KEY(set_num, source, condition)
    )`).run();
    await db.prepare(`CREATE TABLE user_collection (set_num TEXT, deleted_at TEXT)`).run();
    await db.prepare(`CREATE TABLE user_wishlist (set_num TEXT)`).run();
    // Production indexes the import relies on.
    await db.prepare(`CREATE INDEX idx_pricing_source_map_set ON pricing_source_map(set_num, source, status)`).run();
    await db.prepare(`CREATE INDEX idx_sets_upc ON lego_sets(upc)`).run();
  });

  // Before the SETBASE/CAND helper tables, base-number matching used
  // `ls.set_num LIKE s.setbase || '-%'`, which SQLite cannot index: two statements
  // scanned the catalog once per CSV row and took 40-55s on a 13k-set catalog,
  // past D1's 30s query limit. This size took ~14s that way; it now takes well
  // under a second.
  it('imports and re-confirms a 4,000-set catalog quickly, keeping variant rules', async () => {
    const N = 4000;
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < N; i++) {
      const base = 10000 + i;
      const pcid = String(500000 + i);
      stmts.push(db.prepare(`INSERT INTO lego_sets (set_num,name,category) VALUES (?,?,'Normal')`).bind(`${base}-1`, `Set ${base}`));
      // Every fifth base has a second variant, so a bare "#base" title is ambiguous.
      if (i % 5 === 0) stmts.push(db.prepare(`INSERT INTO lego_sets (set_num,name,category) VALUES (?,?,'Normal')`).bind(`${base}-2`, `Set ${base} v2`));
      stmts.push(db.prepare(`INSERT INTO pricing_source_map (source,source_item_id,set_num,source_title,variant_key,match_method,match_confidence,status,verified_at,updated_at)
        VALUES ('pricecharting',?,?,?,?,'set_token',1,'verified',?,?)`).bind(pcid, `${base}-1`, `Castle Set #${base}-1`, `${base}-1`, OLD, OLD));
      stmts.push(db.prepare(`INSERT INTO pricing_signals (set_num,source,source_item_id,provider_family,condition,signal_type,currency,value,sample_count,sales_volume,source_observed_at,checked_at,match_status,flags_json,updated_at)
        VALUES (?,'pricecharting',?,'ebay_market','new_sealed','sold','USD',50,12,12,?,?,'verified','[]',?)`).bind(`${base}-1`, pcid, OLD, OLD, OLD));
    }
    for (let i = 0; i < stmts.length; i += 500) await db.batch(stmts.slice(i, i + 500));
    // A third of titles carry only the base number.
    const rows = Array.from({ length: N }, (_, i) => {
      const base = 10000 + i;
      return `${500000 + i},LEGO Sets,,Castle Set #${i % 3 ? `${base}-1` : base},$40,$60,$50,12`;
    });

    const started = Date.now();
    const result = await importRows(rows);
    expect(Date.now() - started).toBeLessThan(6000);

    // Explicit "#base-1" titles and unambiguous bare "#base" titles match;
    // a bare "#base" with a -2 sibling (i % 3 == 0 and i % 5 == 0) cannot.
    const ambiguous = Array.from({ length: N }, (_, i) => i).filter((i) => i % 3 === 0 && i % 5 === 0).length;
    expect(result.matched).toBe(N - ambiguous);
    const fresh = await db.prepare(`SELECT count(*) AS n FROM pricing_signals WHERE condition='new_sealed' AND checked_at > '2026-09-01'`).first<{ n: number }>();
    // Re-confirmation is capped at 2,500 rows per run (PC_RECONFIRM_BUDGET).
    expect(fresh!.n).toBe(2500);
    expect(await db.prepare(`SELECT name FROM sqlite_master WHERE name LIKE '_pc_bulk_%'`).all())
      .toMatchObject({ results: [] });
  }, 60000);
});
