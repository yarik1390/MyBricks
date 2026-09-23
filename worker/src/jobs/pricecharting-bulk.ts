import type { Env } from '../types';
import { appBaseUrl } from '../lib/app-url';
import { recomputeBlendedValues } from '../lib/market-sources';
import { isPlausibleMarketValue } from '../lib/valuation';
import { recordIntegrationAttempt } from '../lib/integration-health';
import { sourceEnabled } from '../lib/source-config';
import { isExactNormalizedPriceChartingTitle } from '../lib/pricecharting';

// ---------------------------------------------------------------------------
// PriceCharting bulk LEGO CSV import (Legendary tier).
//
// Two entry points share one core (processBulkCsv):
//   • runPriceChartingBulkFetch — downloads the LEGO-sets price guide directly
//     from PriceCharting (…/price-guide/download-custom?t=TOKEN&category=lego-sets).
//     One ~2 MB request covers the whole LEGO catalog (~13k sets) vs thousands of
//     per-set API calls. Driven by the DAILY 04:30 cron + an admin button (this
//     comment said "weekly (Sunday)" long after the schedule changed; the trigger
//     in wrangler.toml/index.ts is authoritative). A full-catalog re-stage +
//     upsert is heavy on D1 rows-written, so unchanged prices are skipped by the
//     change-only upsert below — which is why a re-confirmed but unchanged price
//     keeps its original source_observed_at and must not be read as "stale data".
//     Freshness for these rows is better judged by whether the set is reachable
//     by the verified join at all (see docs/pricing-partner-compliance.md §3).
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

// Re-confirmation cadence + daily write budget for re-observed-but-unchanged
// PriceCharting rows. The change-only upsert above deliberately skips writes
// when a price is re-published unchanged, which leaves `checked_at` pinned to
// the value's last CHANGE while the pricing engine (valuation-v3) reads
// `checked_at` as "when we last confirmed this evidence" and demotes the
// family to stale after 14 days. A price the daily full-catalog sweep keeps
// re-publishing is current evidence, so it must be stamped as such — bounded so
// the re-confirmation itself can never become a D1 rows-written problem.
// 7 days refreshes the ~22k verified signals on a rolling basis inside the cap.
const PC_RECONFIRM_DAYS = 7;
const PC_RECONFIRM_BUDGET = 2500;

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
  providerCategory: string;
  productTitle: string;
  setBase: string | null; // e.g. "10300" parsed from product-name
  explicitSetNum: string | null; // full provider token, e.g. "75188-2"
  identitySafe: boolean;
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
  const iId = idx('id'), iUpc = idx('upc'), iName = idx('product-name'), iCategory = idx('console-name');
  const iNew = idx('new-price'), iCib = idx('cib-price'), iLoose = idx('loose-price'), iVol = idx('sales-volume');

  const rows: BulkRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const line = lines[li];
    if (!line.trim()) continue;
    const v = parseLine(line);
    const name = iName >= 0 ? v[iName] ?? '' : '';
    // Count every token, including repeated tokens: bundles must not silently
    // become the first set in the title. Do not parse quantities like 3-in-1.
    const tokens = [...name.matchAll(/(?:^|[^\w-])(#?\d{3,7}(?:-\d+)?)(?![\w-])/g)]
      .map((m) => m[1]).filter((t) => t.startsWith('#') || t.includes('-') || /^\d{4,6}$/.test(t));
    const token = tokens.length === 1 ? tokens[0].replace(/^#/, '') : null;
    const explicitSetNum = token?.includes('-') ? token : null;
    const setBase = token?.replace(/-\d+$/, '') ?? null;
    const vol = Number(iVol >= 0 ? v[iVol] : undefined);
    rows.push({
      pcId: iId >= 0 && v[iId] ? v[iId] : null,
      upc: iUpc >= 0 && v[iUpc] ? v[iUpc] : null,
      providerCategory: iCategory >= 0 ? v[iCategory] ?? '' : '',
      productTitle: name,
      setBase,
      explicitSetNum,
      identitySafe: tokens.length <= 1,
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

async function processBulkCsv(env: Env, csvText: string): Promise<BulkResult> {
  // Isolate overlapping cron/admin imports; one run must never drop another's
  // evidence. A failed run can leave an orphan stage, but cannot poison a peer.
  const STAGE = `_pc_bulk_${crypto.randomUUID().replace(/-/g, '')}`;
  const rows = parsePriceChartingCsv(csvText);
  const idCounts = new Map<string, number>();
  const baseCounts = new Map<string, number>();
  const baseByProviderId = new Map<string, string>();
  for (const r of rows) {
    if (r.pcId) {
      idCounts.set(r.pcId, (idCounts.get(r.pcId) ?? 0) + 1);
      if (r.setBase) baseByProviderId.set(r.pcId, r.setBase);
    }
    if (r.setBase) baseCounts.set(r.setBase, (baseCounts.get(r.setBase) ?? 0) + 1);
  }
  // A provider ID is the durable source-map key. If the feed repeats it, none of
  // its observations are trustworthy: choosing one based on CSV order would make
  // same-set price disagreements and cross-set identity conflicts nondeterministic.
  const stageRows = rows.filter((r) => r.pcId && idCounts.get(r.pcId) === 1
    && (r.identitySafe || r.explicitSetNum !== null || r.setBase !== null));
  if (!rows.length) return persistBulk(env, { rows: 0, matched: 0, unmatched: 0, updated: 0, skipped: 'no rows parsed' });

  let result: BulkResult | undefined;
  let importError: unknown;
  try {
  // Stage rows into a temp table and resolve matches with set-based JOINs. This
  // avoids D1's 100-bound-parameters-per-query limit (a 150-row chunk with three
  // IN(...) lists bound up to ~450 params and threw before any write — the reason
  // earlier runs left no trace) and keeps the whole import subrequest-lean.
  await env.DB.prepare(
    `CREATE TABLE ${STAGE} (
      pcid TEXT, upc TEXT, provider_category TEXT, title TEXT, setbase TEXT, setnum TEXT,
      titleok INTEGER NOT NULL DEFAULT 0,
      newv REAL, cibv REAL, loosev REAL, salesvol INTEGER
    )`,
  ).run();

  // Bind one JSON array per statement and expand it in SQLite. This stays well
  // below D1's 100 bind-parameter limit while the byte cap leaves headroom under
  // the 100 KiB query-parameter limit. Chunk by UTF-8 bytes, not row count,
  // because provider titles are unbounded CSV input.
  const MAX_JSON_BYTES = 90 * 1024;
  const encoder = new TextEncoder();
  let jsonRows: unknown[][] = [];
  let jsonBytes = 2; // []
  const flushStageRows = async () => {
    if (!jsonRows.length) return;
    await env.DB.prepare(`
      INSERT INTO ${STAGE} (pcid,upc,provider_category,title,setbase,setnum,titleok,newv,cibv,loosev,salesvol)
      SELECT
        json_extract(value,'$[0]'), json_extract(value,'$[1]'),
        json_extract(value,'$[2]'), json_extract(value,'$[3]'),
        json_extract(value,'$[4]'), json_extract(value,'$[5]'), 0,
        json_extract(value,'$[6]'), json_extract(value,'$[7]'),
        json_extract(value,'$[8]'), json_extract(value,'$[9]')
      FROM json_each(?1)
    `).bind(JSON.stringify(jsonRows)).run();
    jsonRows = [];
    jsonBytes = 2;
  };
  for (const r of stageRows) {
    const values = [r.pcId, r.upc, r.providerCategory, r.productTitle, r.setBase, r.explicitSetNum,
      r.newValue, r.completeValue, r.looseValue, r.salesVolume];
    const rowBytes = encoder.encode(JSON.stringify(values)).byteLength + (jsonRows.length ? 1 : 0);
    if (rowBytes + 2 > MAX_JSON_BYTES) {
      throw new Error(`PriceCharting staging row exceeds ${MAX_JSON_BYTES} byte safety cap`);
    }
    if (jsonBytes + rowBytes > MAX_JSON_BYTES) await flushStageRows();
    jsonRows.push(values);
    jsonBytes += rowBytes;
  }
  await flushStageRows();

  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS ${STAGE}_pcid ON ${STAGE}(pcid)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS ${STAGE}_upc ON ${STAGE}(upc)`).run();
  // Both branches of the duplicate-evidence OR must be indexed; otherwise
  // its correlated anti-join scans the entire CSV once per candidate row.
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS ${STAGE}_setbase ON ${STAGE}(setbase)`).run();

  // Title compatibility is intentionally computed in JS rather than approximated
  // in SQL. Only current bare-base rows need it; explicit set tokens and UPCs keep
  // their independent identity paths.
  const baseCandidates = await env.DB.prepare(`
    SELECT s.pcid, s.title, ls.name
    FROM ${STAGE} s JOIN lego_sets ls ON ls.set_num LIKE s.setbase || '-%'
    WHERE s.setnum IS NULL AND s.setbase IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM lego_sets variant
        WHERE variant.set_num LIKE s.setbase || '-%' AND variant.set_num<>ls.set_num)
  `).all<{ pcid: string; title: string; name: string }>();
  const titleCompatibleIds = baseCandidates.results
    .filter((row) => baseCounts.get(baseByProviderId.get(row.pcid) ?? '') === 1)
    .filter((row) => isExactNormalizedPriceChartingTitle(row.name, row.title))
    .map((row) => row.pcid);
  if (titleCompatibleIds.length) {
    await env.DB.prepare(`
      UPDATE ${STAGE} SET titleok=1
      WHERE pcid IN (SELECT value FROM json_each(?1))
    `).bind(JSON.stringify(titleCompatibleIds)).run();
  }

  const CATEGORY_COMPATIBLE = `(lower(s.provider_category) LIKE '%lego%'
    AND (ls.category IS NULL OR ls.category='' OR lower(ls.category)='normal'
      OR lower(s.provider_category) LIKE '%' || lower(ls.category) || '%'))`;
  const TOKEN_COMPATIBLE = `(s.setnum=ls.set_num OR (s.setnum IS NULL AND
    (s.setbase IS NULL OR (ls.set_num LIKE s.setbase || '-%' AND NOT EXISTS (
      SELECT 1 FROM lego_sets variant WHERE variant.set_num LIKE s.setbase || '-%'
        AND variant.set_num<>ls.set_num)))))`;
  const UPC_COMPATIBLE = `(s.upc IS NULL OR s.upc='' OR (
    (ls.upc IS NULL OR ls.upc='' OR ls.upc=s.upc)
    AND NOT EXISTS (SELECT 1 FROM lego_sets dup WHERE dup.upc=s.upc AND dup.set_num<>ls.set_num)))`;
  const BASE_TITLE_COMPATIBLE = `(s.setnum IS NULL AND s.setbase IS NOT NULL AND s.titleok=1
    AND (s.upc IS NULL OR s.upc='' OR (ls.upc=s.upc AND NOT EXISTS (
      SELECT 1 FROM lego_sets dup WHERE dup.upc=s.upc AND dup.set_num<>ls.set_num))))`;
  const BY_SAFE_UPC = `s.upc=ls.upc AND s.upc IS NOT NULL AND s.upc<>''
    AND ${TOKEN_COMPATIBLE} AND ${UPC_COMPATIBLE} AND ${CATEGORY_COMPATIBLE}`;

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

  // Resolve CSV evidence without trusting copied legacy IDs or price agreement.
  // Existing provider IDs are never reassigned, including quarantined ones.
  await env.DB.prepare(`
    INSERT INTO pricing_source_map (
      source, source_item_id, set_num, source_title, upc, variant_key,
      match_method, match_confidence, status, verified_at, updated_at
    )
    SELECT 'pricecharting', s.pcid, ls.set_num, s.title, s.upc, ls.set_num,
           CASE WHEN s.setnum IS NOT NULL THEN 'set_token'
                WHEN s.setbase IS NOT NULL AND s.titleok=1 AND (s.upc IS NULL OR s.upc='') THEN 'base_title'
                ELSE 'upc' END,
           CASE WHEN ${CATEGORY_COMPATIBLE} THEN 1.0 ELSE 0.1 END,
           CASE WHEN ${CATEGORY_COMPATIBLE} THEN 'verified' ELSE 'quarantined' END, datetime('now'), datetime('now')
    FROM ${STAGE} s JOIN lego_sets ls ON
      (s.setnum=ls.set_num OR (${BASE_TITLE_COMPATIBLE} AND ${TOKEN_COMPATIBLE}) OR (${BY_SAFE_UPC}))
    WHERE ${CATEGORY_COMPATIBLE} AND ${TOKEN_COMPATIBLE}
      AND (s.setnum IS NOT NULL OR ${BASE_TITLE_COMPATIBLE} OR s.upc IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM ${STAGE} other WHERE other.pcid<>s.pcid
        AND ((s.setbase IS NOT NULL AND other.setbase=s.setbase)
          OR (s.upc IS NOT NULL AND s.upc<>'' AND other.upc=s.upc)))
      AND NOT EXISTS (SELECT 1 FROM pricing_source_map protected
        WHERE protected.source='pricecharting' AND protected.set_num=ls.set_num
          AND protected.status IN ('manual','rejected'))
      AND NOT EXISTS (SELECT 1 FROM pricing_source_map competing
        WHERE competing.source='pricecharting' AND competing.set_num=ls.set_num
          AND competing.source_item_id<>s.pcid AND competing.status IN ('verified','manual')
          AND competing.source_item_id NOT LIKE 'legacy:%')
    ON CONFLICT(source, source_item_id) DO UPDATE SET
      source_title=excluded.source_title, upc=excluded.upc, variant_key=excluded.variant_key,
      match_method=excluded.match_method, match_confidence=excluded.match_confidence,
      status=excluded.status, verified_at=excluded.verified_at, updated_at=excluded.updated_at
    WHERE pricing_source_map.status NOT IN ('manual','rejected')
      AND pricing_source_map.set_num=excluded.set_num
      AND (pricing_source_map.status IS NOT excluded.status
        OR pricing_source_map.match_method IS NOT excluded.match_method
        OR pricing_source_map.source_title IS NOT excluded.source_title
        OR pricing_source_map.upc IS NOT excluded.upc)
  `).run();

  // Keep rejected identity evidence visible for review; never let it feed prices.
  await env.DB.prepare(`
    INSERT INTO pricing_source_map
      (source,source_item_id,set_num,source_title,upc,variant_key,match_method,match_confidence,status,updated_at)
    SELECT 'pricecharting',s.pcid,ls.set_num,s.title,s.upc,ls.set_num,
      CASE WHEN s.setnum=ls.set_num THEN 'set_token_conflict' ELSE 'base_candidate' END,
      0.1,'quarantined',datetime('now')
    FROM ${STAGE} s JOIN lego_sets ls ON
      (s.setnum=ls.set_num OR (s.setbase IS NOT NULL AND ls.set_num LIKE s.setbase || '-%'))
    WHERE s.pcid IS NOT NULL
      AND (NOT ${CATEGORY_COMPATIBLE} OR NOT ${TOKEN_COMPATIBLE})
      OR (s.setbase IS NOT NULL AND s.upc IS NULL AND NOT EXISTS (SELECT 1 FROM lego_sets v
        WHERE v.set_num LIKE s.setbase || '-%' AND v.set_num<>ls.set_num))
      AND NOT EXISTS (SELECT 1 FROM pricing_source_map pm
        WHERE pm.source='pricecharting' AND pm.source_item_id=s.pcid)
    ON CONFLICT(source,source_item_id) DO NOTHING
  `).run();

  const OBSERVATION_IDENTITY_COMPATIBLE = `${CATEGORY_COMPATIBLE}
    AND ${TOKEN_COMPATIBLE} AND ${UPC_COMPATIBLE}
    AND (pm.match_method<>'base_title' OR ${BASE_TITLE_COMPATIBLE})
    AND NOT EXISTS (SELECT 1 FROM ${STAGE} other WHERE other.pcid<>s.pcid
      AND ((s.setbase IS NOT NULL AND other.setbase=s.setbase)
        OR (s.upc IS NOT NULL AND s.upc<>'' AND other.upc=s.upc)))`;
  const VERIFIED_JOIN = `${STAGE} s JOIN pricing_source_map pm
    ON pm.source='pricecharting' AND pm.source_item_id=s.pcid
   AND pm.status IN ('verified','manual')
    JOIN lego_sets ls ON ls.set_num=pm.set_num
   AND ${OBSERVATION_IDENTITY_COMPATIBLE}`;

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
    WHERE pm.set_num=ls.set_num AND ${OBSERVATION_IDENTITY_COMPATIBLE}
      AND (s.newv IS NOT NULL OR s.cibv IS NOT NULL)
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
       OR pricing_signals.source_item_id IS NOT excluded.source_item_id
  `);
  // D1 batch is atomic: retire only a canonical synthetic key with a proven
  // replacement and no remaining signals pointing at the old identity.
  const retireSynthetic = env.DB.prepare(`
    UPDATE pricing_source_map AS old SET status='quarantined', updated_at=datetime('now')
    WHERE old.source='pricecharting' AND old.source_item_id='legacy:' || old.set_num
      AND old.status='verified'
      AND EXISTS (SELECT 1 FROM ${VERIFIED_JOIN} WHERE ls.set_num=old.set_num)
      AND EXISTS (SELECT 1 FROM pricing_signals ps JOIN ${STAGE} s ON s.pcid=ps.source_item_id
        WHERE ps.source='pricecharting' AND ps.set_num=old.set_num)
      AND NOT EXISTS (SELECT 1 FROM pricing_signals ps WHERE ps.source='pricecharting'
        AND ps.source_item_id=old.source_item_id)
  `);
  // Re-confirm, do not re-price. A row whose product is still published by this
  // sweep at the same figure was re-observed, so `checked_at` advances even
  // though the value (and therefore `source_observed_at`, the anchor the
  // time-forward benchmark freezes against) does not. Guarded by the same
  // identity join as every write above, and limited to rows whose specific
  // figure for that condition is still present in the feed.
  const reconfirmSeen = env.DB.prepare(`
    UPDATE pricing_signals SET checked_at=datetime('now'), updated_at=datetime('now')
    WHERE rowid IN (
      SELECT ps.rowid
      FROM ${STAGE} s
      JOIN pricing_source_map pm
        ON pm.source='pricecharting' AND pm.source_item_id=s.pcid
       AND pm.status IN ('verified','manual')
      JOIN lego_sets ls ON ls.set_num=pm.set_num AND ${OBSERVATION_IDENTITY_COMPATIBLE}
      JOIN pricing_signals ps
        ON ps.set_num=pm.set_num AND ps.source='pricecharting'
       AND ps.source_item_id=s.pcid AND ps.match_status IN ('verified','manual')
      WHERE ps.checked_at < datetime('now', '-${PC_RECONFIRM_DAYS} days')
        AND ((ps.condition='new_sealed' AND s.newv IS NOT NULL)
          OR (ps.condition='used_complete' AND s.cibv IS NOT NULL)
          OR (ps.condition='loose' AND s.loosev IS NOT NULL))
      ORDER BY ps.checked_at ASC
      LIMIT ${PC_RECONFIRM_BUDGET}
    )
  `);
  await env.DB.batch([
    signalInsert('new_sealed', 'newv'),
    signalInsert('used_complete', 'cibv'),
    signalInsert('loose', 'loosev'),
    retireSynthetic,
    reconfirmSeen,
  ]);

  const matched = (await env.DB.prepare(`SELECT count(*) AS n FROM ${VERIFIED_JOIN}`)
    .first<{ n: number }>())?.n ?? 0;
  const touchedSets = await env.DB.prepare(
    `SELECT DISTINCT ls.set_num FROM ${VERIFIED_JOIN}`,
  ).all<{ set_num: string }>();
  const touched = new Set(touchedSets.results.map((row) => row.set_num));

  // Recompute the persisted blend for OWNED + WISHLISTED sets only (user-facing
  // priority, bounded). Everything else surfaces live on read and catches up on
  // the next daily valuation pass. Conflicting staged observations are excluded
  // from touched sets by the same identity gate as every write above.
  try {
    const { results } = await env.DB.prepare(
      `SELECT set_num FROM user_collection WHERE deleted_at IS NULL UNION SELECT set_num FROM user_wishlist`,
    ).all<{ set_num: string }>();
    const priority = results.map((r) => r.set_num).filter((setNum) => touched.has(setNum));
    if (priority.length) await recomputeBlendedValues(env.DB, priority, { strict: true });
  } catch (e) {
    console.warn('[pc-bulk] priority recompute failed:', (e as Error).message);
    // Imported evidence is durable, but user-facing persisted totals are not
    // refreshed. Surface a failed run instead of recording a false success.
    throw e;
  }

  result = {
    rows: rows.length,
    matched,
    unmatched: rows.length - matched,
    updated: touched.size,
  };
  } catch (e) {
    importError = e;
  } finally {
    try {
      await env.DB.prepare(`DROP TABLE IF EXISTS ${STAGE}`).run();
    } catch (cleanupError) {
      // The import failure is the primary diagnostic. Cleanup failure is fatal
      // only when the import itself succeeded; otherwise preserve the original.
      if (importError === undefined) throw cleanupError;
      console.error('[pc-bulk] staging cleanup failed after import failure:', cleanupError);
    }
  }
  if (importError !== undefined) {
    // A mid-import failure (D1 error, CPU/subrequest limit) used to propagate
    // with no health record and no progress key, so the run simply vanished from
    // admin diagnostics — indistinguishable from the cron never firing. Record
    // both before surfacing the original error.
    const msg = (importError as Error)?.message || String(importError);
    try {
      await recordIntegrationAttempt(env, 'pricecharting', false, `bulk import failed: ${msg}`);
    } catch { /* health storage must not prevent progress recording */ }
    await persistBulk(env, {
      rows: rows.length, matched: 0, unmatched: rows.length, updated: 0,
      skipped: `import failed: ${msg}`,
    });
    throw importError;
  }
  return persistBulk(env, result!);
}
