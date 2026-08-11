import type { Env } from '../types';
import { appBaseUrl } from '../lib/app-url';
import { recomputeBlendedValues } from '../lib/market-sources';
import { isPlausibleMarketValue } from '../lib/valuation';
import { recordIntegrationAttempt } from '../lib/integration-health';
import { sourceEnabled } from '../lib/source-config';

// ---------------------------------------------------------------------------
// PriceCharting bulk LEGO CSV import (Legendary tier).
//
// Two entry points share one core (processBulkCsv):
//   • runPriceChartingBulkFetch — downloads the LEGO-sets price guide directly
//     from PriceCharting (…/price-guide/download-custom?t=TOKEN&category=lego-sets).
//     One ~2 MB request covers the whole LEGO catalog (~13k sets) vs thousands of
//     per-set API calls. Driven by a weekly (Sunday) cron + an admin button. A
//     full-catalog re-stage + upsert is heavy on D1 rows-written, so it runs
//     weekly (not daily) and skips unchanged prices (change-only upsert below).
//   • runPriceChartingBulk — same parser for an admin-UPLOADED CSV (PRICECHARTING_PRO).
//
// The per-set /api/product path (jobs/pricecharting-enrich.ts) stays as the
// always-on top-up for new sets and misses.
//
// IMPORTANT format note: the CSV DOWNLOAD formats money as "$57.94" dollar strings
// (NOT the integer pennies the per-set API returns). LEGO product-names embed the
// set number as "…#4620". Sets are matched by upc → pc_id → "#<num>"→"<num>-1".
// ---------------------------------------------------------------------------

const PROGRESS_KEY = 'pc_bulk_last_result';

function parseLine(line: string): string[] {
  const cols: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  cols.push(cur.trim());
  return cols;
}

interface BulkRow {
  pcId: string | null;
  upc: string | null;
  productTitle: string;
  setBase: string | null; // e.g. "10300" parsed from product-name
  newValue: number | null;
  completeValue: number | null;
  looseValue: number | null;
  salesVolume: number | null;
}

// PriceCharting's CSV download formats money as "$57.94" dollar strings (unlike
// the per-set /api/product, which returns integer pennies). Strip the $ / commas
// and parse as dollars directly.
const money = (v: string | undefined): number | null => {
  if (!v) return null;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const gate = (v: number | null): number | null => (v != null && isPlausibleMarketValue(v, {}) ? v : null);

export function parsePriceChartingCsv(text: string): BulkRow[] {
  const lines = text.split('\n');
  if (!lines.length) return [];
  const headers = parseLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (name: string) => headers.indexOf(name);
  const iId = idx('id'), iUpc = idx('upc'), iName = idx('product-name');
  const iNew = idx('new-price'), iCib = idx('cib-price'), iLoose = idx('loose-price'), iVol = idx('sales-volume');

  const rows: BulkRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const line = lines[li];
    if (!line.trim()) continue;
    const v = parseLine(line);
    const name = iName >= 0 ? v[iName] ?? '' : '';
    // LEGO product-names embed the set number as "…#4620"; prefer that, else a
    // bare 4–6 digit run.
    const setMatch = name.match(/#(\d{3,7})/) || name.match(/\b(\d{4,6})\b/);
    const vol = Number(iVol >= 0 ? v[iVol] : undefined);
    rows.push({
      pcId: iId >= 0 && v[iId] ? v[iId] : null,
      upc: iUpc >= 0 && v[iUpc] ? v[iUpc] : null,
      productTitle: name,
      setBase: setMatch ? setMatch[1] : null,
      newValue: gate(money(iNew >= 0 ? v[iNew] : undefined)),
      completeValue: gate(money(iCib >= 0 ? v[iCib] : undefined)),
      looseValue: gate(money(iLoose >= 0 ? v[iLoose] : undefined)),
      salesVolume: Number.isFinite(vol) && vol > 0 ? Math.round(vol) : null,
    });
  }
  return rows;
}

export interface BulkResult {
  rows: number;
  matched: number;
  unmatched: number;
  updated: number;
  skipped?: string;
  detail?: string;
  finished_at?: string;
}

// Persist a bulk outcome (success OR skip/error) so every run is diagnosable in
// admin diagnostics — silent skips were previously invisible. Fail-open.
async function persistBulk(env: Env, result: BulkResult): Promise<BulkResult> {
  const out = { ...result, finished_at: result.finished_at ?? new Date().toISOString() };
  try {
    await env.DB.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=?2, updated_at=datetime('now')`,
    ).bind(PROGRESS_KEY, JSON.stringify(out)).run();
  } catch { /* non-fatal */ }
  return out;
}

/**
 * Import an uploaded PriceCharting price-guide CSV. Matches each row to a set by
 * upc → pc_id → "<base>-1" set number, writes pc_new/pc_complete/pc_id to
 * lego_sets and pc_loose/sales-volume to set_market_ext, then recomputes the
 * blend for touched sets. Writes a summary to app_settings for admin diagnostics.
 */
export async function runPriceChartingBulk(env: Env, csvText: string): Promise<BulkResult> {
  if (!/^(1|true|yes|on)$/i.test(String(env.PRICECHARTING_PRO ?? ''))) {
    return { rows: 0, matched: 0, unmatched: 0, updated: 0, skipped: 'PRICECHARTING_PRO not set (Legendary tier required for bulk CSV)' };
  }
  if (!(await sourceEnabled(env, 'pricecharting'))) {
    return persistBulk(env, { rows: 0, matched: 0, unmatched: 0, updated: 0, skipped: 'PriceCharting is quarantined/disabled' });
  }
  return processBulkCsv(env, csvText);
}

const LEGO_CSV_URL = 'https://www.pricecharting.com/price-guide/download-custom';

/**
 * Fetch the LEGO-sets price guide CSV directly from PriceCharting (Legendary
 * tier) and bulk-populate. One ~2 MB request covers the whole LEGO catalog
 * (~13k sets) vs thousands of per-set API calls. The download endpoint enforces
 * the tier itself, so this gates only on PRICECHARTING_TOKEN. CSV downloads are
 * rate-limited to 1 per 10 minutes — keep callers (weekly cron) well within that.
 */
export async function runPriceChartingBulkFetch(env: Env): Promise<BulkResult> {
  if (!(await sourceEnabled(env, 'pricecharting'))) {
    return persistBulk(env, { rows: 0, matched: 0, unmatched: 0, updated: 0, skipped: 'PriceCharting is quarantined/disabled' });
  }
  const token = env.PRICECHARTING_TOKEN;
  if (!token) return persistBulk(env, { rows: 0, matched: 0, unmatched: 0, updated: 0, skipped: 'PRICECHARTING_TOKEN not set' });
  let text: string;
  try {
    const resp = await fetch(`${LEGO_CSV_URL}?t=${token}&category=lego-sets`, {
      headers: { 'User-Agent': `BrickvaultBot/1.0 (+${appBaseUrl(env)})`, Accept: 'text/csv,*/*' },
      signal: AbortSignal.timeout(120_000),
    });
    if (!resp.ok) {
      await recordIntegrationAttempt(env, 'pricecharting', false, `bulk download HTTP ${resp.status}`);
      return persistBulk(env, { rows: 0, matched: 0, unmatched: 0, updated: 0, skipped: `download HTTP ${resp.status}` });
    }
    text = (await resp.text()).replace(/^﻿/, '').trimStart();
    // Guard against an error/HTML body (e.g. tier not entitled) instead of a CSV.
    // Capture a snippet so the failure is diagnosable from admin diagnostics.
    if (!/^id,console-name,product-name/i.test(text.slice(0, 200))) {
      await recordIntegrationAttempt(env, 'pricecharting', false, 'bulk download returned non-CSV body');
      return persistBulk(env, {
        rows: 0, matched: 0, unmatched: 0, updated: 0,
        skipped: 'unexpected (non-CSV) download body — check the token is the Legendary-tier token',
        detail: text.slice(0, 200),
      });
    }
  } catch (e) {
    await recordIntegrationAttempt(env, 'pricecharting', false, `bulk download failed: ${(e as Error).message}`);
    return persistBulk(env, { rows: 0, matched: 0, unmatched: 0, updated: 0, skipped: `download failed: ${(e as Error).message}` });
  }
  const result = await processBulkCsv(env, text);
  await recordIntegrationAttempt(env, 'pricecharting', result.matched > 0, result.skipped ?? null);
  return result;
}

const STAGE = '_pc_bulk_stage';

async function processBulkCsv(env: Env, csvText: string): Promise<BulkResult> {
  const rows = parsePriceChartingCsv(csvText);
  if (!rows.length) return persistBulk(env, { rows: 0, matched: 0, unmatched: 0, updated: 0, skipped: 'no rows parsed' });

  // Stage rows into a temp table and resolve matches with set-based JOINs. This
  // avoids D1's 100-bound-parameters-per-query limit (a 150-row chunk with three
  // IN(...) lists bound up to ~450 params and threw before any write — the reason
  // earlier runs left no trace) and keeps the whole import subrequest-lean.
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS ${STAGE} (
      pcid TEXT, upc TEXT, title TEXT, setbase TEXT, setnum TEXT,
      newv REAL, cibv REAL, loosev REAL, salesvol INTEGER
    )`,
  ).run();
  await env.DB.prepare(`DELETE FROM ${STAGE}`).run();

  // Bulk-insert via multi-row statements (16 rows × 6 cols = 96 binds, under the
  // 100/statement limit), 80 statements per D1 batch (1 subrequest each).
  const PER_STMT = 11;
  const placeholders = Array.from({ length: PER_STMT }, () => '(?,?,?,?,?,?,?,?,?)').join(',');
  let batch: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += PER_STMT) {
    const slice = rows.slice(i, i + PER_STMT);
    const ph = slice.length === PER_STMT ? placeholders : slice.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
    const binds: unknown[] = [];
    for (const r of slice) {
      // `setnum` intentionally stays NULL. The former base-number -> "-1"
      // shortcut caused variant collisions (for example Finch Dallow #75188).
      binds.push(r.pcId, r.upc, r.productTitle, r.setBase, null, r.newValue, r.completeValue, r.looseValue, r.salesVolume);
    }
    batch.push(env.DB.prepare(`INSERT INTO ${STAGE} (pcid,upc,title,setbase,setnum,newv,cibv,loosev,salesvol) VALUES ${ph}`).bind(...binds));
    if (batch.length >= 80) { await env.DB.batch(batch); batch = []; }
  }
  if (batch.length) await env.DB.batch(batch);

  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS ${STAGE}_pcid ON ${STAGE}(pcid)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS ${STAGE}_upc ON ${STAGE}(upc)`).run();

  // Resolve matches by set_num first (exact "<base>-1"), then by UPC. COALESCE so
  // a present value wins and we never overwrite existing data with NULL.
  const newUpdate = (joinOn: string) => env.DB.prepare(
    `UPDATE lego_sets AS ls SET
       pc_new_value = COALESCE(s.newv, ls.pc_new_value),
       pc_complete_value = COALESCE(s.cibv, ls.pc_complete_value),
       pc_cached_at = datetime('now')
     FROM ${STAGE} s WHERE ${joinOn} AND (s.newv IS NOT NULL OR s.cibv IS NOT NULL)`,
  );
  // COALESCE so a present value wins and NULL never clobbers existing data; the
  // trailing WHERE skips the write entirely when neither column actually changes
  // (IS NOT = null-safe inequality). Most rows are unchanged run-to-run, so this
  // turns a full-table rewrite into a write only for genuinely-moved prices —
  // set_market_ext has no freshness timestamp, so skipping no-ops has no downside.
  const extInsert = (joinOn: string) => env.DB.prepare(
    `INSERT INTO set_market_ext (set_num, pc_loose_value, pc_sales_volume)
       SELECT ls.set_num, s.loosev, s.salesvol FROM ${STAGE} s JOIN lego_sets ls ON ${joinOn}
       WHERE s.loosev IS NOT NULL OR s.salesvol IS NOT NULL
     ON CONFLICT(set_num) DO UPDATE SET
       pc_loose_value = COALESCE(excluded.pc_loose_value, set_market_ext.pc_loose_value),
       pc_sales_volume = COALESCE(excluded.pc_sales_volume, set_market_ext.pc_sales_volume)
     WHERE COALESCE(excluded.pc_loose_value, set_market_ext.pc_loose_value) IS NOT set_market_ext.pc_loose_value
        OR COALESCE(excluded.pc_sales_volume, set_market_ext.pc_sales_volume) IS NOT set_market_ext.pc_sales_volume`,
  );
  const BY_SETNUM = 's.setnum = ls.set_num';
  const BY_UPC = "s.upc = ls.upc AND s.upc IS NOT NULL AND s.upc <> '' AND NOT EXISTS (SELECT 1 FROM lego_sets dup WHERE dup.upc=s.upc AND dup.set_num<>ls.set_num)";
  await env.DB.batch([newUpdate(BY_SETNUM), newUpdate(BY_UPC), extInsert(BY_SETNUM), extInsert(BY_UPC)]);

  const matchedRow = await env.DB.prepare(
    `SELECT COUNT(DISTINCT ls.set_num) AS n FROM ${STAGE} s
       JOIN lego_sets ls ON (s.setnum = ls.set_num) OR (s.upc = ls.upc AND s.upc <> '')`,
  ).first<{ n: number }>().catch(() => ({ n: 0 }));
  const matched = Number(matchedRow?.n ?? 0);

  // Preserve every old pc_id as a review candidate, never as verified evidence.
  await env.DB.prepare(`
    INSERT INTO pricing_source_map (
      source, source_item_id, set_num, source_title, upc, variant_key,
      match_method, match_confidence, status, updated_at
    )
    SELECT 'pricecharting', ls.pc_id, ls.set_num, ls.name, ls.upc, ls.set_num,
           'legacy_pc_id', 0.2, 'quarantined', datetime('now')
    FROM lego_sets ls WHERE ls.pc_id IS NOT NULL AND ls.pc_id <> ''
    ON CONFLICT(source, source_item_id) DO NOTHING
  `).run();

  // Unique UPC is the only automatic bulk verification path. Full title and
  // variant are retained for admin review and regression diagnostics.
  await env.DB.prepare(`
    INSERT INTO pricing_source_map (
      source, source_item_id, set_num, source_title, upc, variant_key,
      match_method, match_confidence, status, verified_at, updated_at
    )
    SELECT 'pricecharting', s.pcid, ls.set_num, s.title, s.upc, ls.set_num,
           'upc', 1.0, 'verified', datetime('now'), datetime('now')
    FROM ${STAGE} s JOIN lego_sets ls ON ls.upc=s.upc
    WHERE s.pcid IS NOT NULL AND s.upc IS NOT NULL AND s.upc <> ''
      AND NOT EXISTS (SELECT 1 FROM lego_sets dup WHERE dup.upc=s.upc AND dup.set_num<>ls.set_num)
    ON CONFLICT(source, source_item_id) DO UPDATE SET
      set_num=excluded.set_num, source_title=excluded.source_title,
      upc=excluded.upc, variant_key=excluded.variant_key,
      match_method='upc', match_confidence=1.0, status='verified',
      verified_at=datetime('now'), updated_at=datetime('now')
  `).run();

  // Base-number candidates are quarantine-only. Even an apparent "-1" match is
  // never applied automatically because promotions and named variants reuse it.
  await env.DB.prepare(`
    INSERT INTO pricing_source_map (
      source, source_item_id, set_num, source_title, upc, variant_key,
      match_method, match_confidence, status, updated_at
    )
    SELECT 'pricecharting', s.pcid, candidate.set_num, s.title, s.upc, s.setbase,
           'base_candidate', 0.1, 'quarantined', datetime('now')
    FROM ${STAGE} s
    LEFT JOIN lego_sets candidate ON candidate.set_num=(s.setbase || '-1')
    LEFT JOIN pricing_source_map pm ON pm.source='pricecharting' AND pm.source_item_id=s.pcid
    WHERE s.pcid IS NOT NULL AND pm.source_item_id IS NULL
    ON CONFLICT(source, source_item_id) DO NOTHING
  `).run();

  const VERIFIED_JOIN = `${STAGE} s JOIN pricing_source_map pm
    ON pm.source='pricecharting' AND pm.source_item_id=s.pcid
   AND pm.status IN ('verified','manual')
    JOIN lego_sets ls ON ls.set_num=pm.set_num`;

  // Manual mappings can exist without a UPC. Dual-write the legacy columns for
  // rollback, but only normalized signals participate in pricing v3.
  await env.DB.prepare(`
    UPDATE lego_sets AS ls SET
      pc_new_value=COALESCE(s.newv, ls.pc_new_value),
      pc_complete_value=COALESCE(s.cibv, ls.pc_complete_value),
      pc_id=s.pcid, pc_cached_at=datetime('now')
    FROM ${STAGE} s JOIN pricing_source_map pm
      ON pm.source='pricecharting' AND pm.source_item_id=s.pcid
     AND pm.status IN ('verified','manual')
    WHERE pm.set_num=ls.set_num AND (s.newv IS NOT NULL OR s.cibv IS NOT NULL)
      AND (ls.pc_new_value IS NOT COALESCE(s.newv, ls.pc_new_value)
        OR ls.pc_complete_value IS NOT COALESCE(s.cibv, ls.pc_complete_value)
        OR ls.pc_id IS NOT s.pcid)
  `).run();

  await env.DB.prepare(`
    INSERT INTO set_market_ext (set_num, pc_loose_value, pc_sales_volume)
      SELECT ls.set_num, s.loosev, s.salesvol FROM ${VERIFIED_JOIN}
      WHERE s.loosev IS NOT NULL OR s.salesvol IS NOT NULL
    ON CONFLICT(set_num) DO UPDATE SET
      pc_loose_value=COALESCE(excluded.pc_loose_value, set_market_ext.pc_loose_value),
      pc_sales_volume=COALESCE(excluded.pc_sales_volume, set_market_ext.pc_sales_volume)
    WHERE COALESCE(excluded.pc_loose_value, set_market_ext.pc_loose_value) IS NOT set_market_ext.pc_loose_value
       OR COALESCE(excluded.pc_sales_volume, set_market_ext.pc_sales_volume) IS NOT set_market_ext.pc_sales_volume
  `).run();

  const signalInsert = (condition: string, column: string) => env.DB.prepare(`
    INSERT INTO pricing_signals (
      set_num, source, source_item_id, provider_family, condition, signal_type,
      currency, value, sample_count, sales_volume, source_observed_at, checked_at,
      match_status, flags_json, updated_at
    )
    SELECT ls.set_num, 'pricecharting', s.pcid, 'ebay_market', '${condition}',
           'sold', 'USD', s.${column}, s.salesvol, s.salesvol, datetime('now'),
           datetime('now'), pm.status, '[]', datetime('now')
    FROM ${VERIFIED_JOIN} WHERE s.${column} IS NOT NULL
    ON CONFLICT(set_num, source, condition) DO UPDATE SET
      source_item_id=excluded.source_item_id, value=excluded.value,
      sample_count=excluded.sample_count, sales_volume=excluded.sales_volume,
      source_observed_at=excluded.source_observed_at, checked_at=excluded.checked_at,
      match_status=excluded.match_status, flags_json='[]', updated_at=datetime('now')
    WHERE pricing_signals.value IS NOT excluded.value
       OR pricing_signals.sample_count IS NOT excluded.sample_count
       OR pricing_signals.match_status IS NOT excluded.match_status
  `);
  await env.DB.batch([
    signalInsert('new_sealed', 'newv'),
    signalInsert('used_complete', 'cibv'),
    signalInsert('loose', 'loosev'),
  ]);

  // Recompute the persisted blend for OWNED + WISHLISTED sets only (user-facing
  // priority, bounded). Everything else surfaces live on read and catches up on
  // the next daily valuation pass.
  try {
    const { results } = await env.DB.prepare(
      `SELECT set_num FROM user_collection WHERE deleted_at IS NULL UNION SELECT set_num FROM user_wishlist`,
    ).all<{ set_num: string }>();
    const priority = results.map((r) => r.set_num);
    if (priority.length) await recomputeBlendedValues(env.DB, priority);
  } catch (e) {
    console.warn('[pc-bulk] priority recompute failed:', (e as Error).message);
  }

  await env.DB.prepare(`DROP TABLE IF EXISTS ${STAGE}`).run().catch(() => {});

  return persistBulk(env, {
    rows: rows.length,
    matched,
    unmatched: rows.length - matched,
    updated: matched,
  });
}
