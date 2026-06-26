import type { Env } from '../types';
import { recomputeBlendedValues } from '../lib/market-sources';
import { isPlausibleMarketValue } from '../lib/valuation';

// ---------------------------------------------------------------------------
// PriceCharting bulk LEGO CSV import (Legendary tier).
//
// Two entry points share one core (processBulkCsv):
//   • runPriceChartingBulkFetch — downloads the LEGO-sets price guide directly
//     from PriceCharting (…/price-guide/download-custom?t=TOKEN&category=lego-sets).
//     One ~2 MB request covers the whole LEGO catalog (~13k sets) vs thousands of
//     per-set API calls. Driven by a weekly cron + an admin button.
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
  finished_at?: string;
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
  const token = env.PRICECHARTING_TOKEN;
  if (!token) return { rows: 0, matched: 0, unmatched: 0, updated: 0, skipped: 'PRICECHARTING_TOKEN not set' };
  let text: string;
  try {
    const resp = await fetch(`${LEGO_CSV_URL}?t=${token}&category=lego-sets`, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!resp.ok) {
      return { rows: 0, matched: 0, unmatched: 0, updated: 0, skipped: `download HTTP ${resp.status}` };
    }
    text = await resp.text();
    // Guard against an error/HTML body (e.g. tier not entitled) instead of a CSV.
    if (!/^id,console-name,product-name/i.test(text.slice(0, 200))) {
      return { rows: 0, matched: 0, unmatched: 0, updated: 0, skipped: 'unexpected (non-CSV) download body' };
    }
  } catch (e) {
    return { rows: 0, matched: 0, unmatched: 0, updated: 0, skipped: `download failed: ${(e as Error).message}` };
  }
  return processBulkCsv(env, text);
}

async function processBulkCsv(env: Env, csvText: string): Promise<BulkResult> {
  const rows = parsePriceChartingCsv(csvText);
  if (!rows.length) return { rows: 0, matched: 0, unmatched: 0, updated: 0, skipped: 'no rows parsed' };

  let matched = 0;
  let updated = 0;
  const touched: string[] = [];

  // Process in chunks: one resolve-read per chunk, then batched writes.
  for (let i = 0; i < rows.length; i += 150) {
    const chunk = rows.slice(i, i + 150);
    const upcs = [...new Set(chunk.map((r) => r.upc).filter(Boolean) as string[])];
    const pcIds = [...new Set(chunk.map((r) => r.pcId).filter(Boolean) as string[])];
    // Candidate set numbers: the common "-1" suffix variant of each parsed base.
    const setNums = [...new Set(chunk.map((r) => (r.setBase ? `${r.setBase}-1` : null)).filter(Boolean) as string[])];

    const upcToSet = new Map<string, string>();
    const pcIdToSet = new Map<string, string>();
    const knownSetNums = new Set<string>();
    const conds: string[] = [];
    const binds: string[] = [];
    if (upcs.length) { conds.push(`upc IN (${upcs.map(() => '?').join(',')})`); binds.push(...upcs); }
    if (pcIds.length) { conds.push(`pc_id IN (${pcIds.map(() => '?').join(',')})`); binds.push(...pcIds); }
    if (setNums.length) { conds.push(`set_num IN (${setNums.map(() => '?').join(',')})`); binds.push(...setNums); }
    if (!conds.length) continue;

    const { results } = await env.DB.prepare(
      `SELECT set_num, upc, pc_id FROM lego_sets WHERE ${conds.join(' OR ')}`,
    ).bind(...binds).all<{ set_num: string; upc: string | null; pc_id: string | null }>();
    for (const r of results) {
      if (r.upc) upcToSet.set(r.upc, r.set_num);
      if (r.pc_id) pcIdToSet.set(r.pc_id, r.set_num);
      knownSetNums.add(r.set_num);
    }

    const stmts: D1PreparedStatement[] = [];
    for (const row of chunk) {
      const setNum =
        (row.upc && upcToSet.get(row.upc)) ||
        (row.pcId && pcIdToSet.get(row.pcId)) ||
        (row.setBase && knownSetNums.has(`${row.setBase}-1`) ? `${row.setBase}-1` : null);
      if (!setNum) continue;
      matched++;

      const fields: string[] = [`pc_cached_at=datetime('now')`];
      const fb: unknown[] = [];
      if (row.pcId) { fields.push('pc_id=?'); fb.push(row.pcId); }
      if (row.newValue != null) { fields.push('pc_new_value=?'); fb.push(row.newValue); }
      if (row.completeValue != null) { fields.push('pc_complete_value=?'); fb.push(row.completeValue); }
      stmts.push(env.DB.prepare(`UPDATE lego_sets SET ${fields.join(', ')} WHERE set_num=?`).bind(...fb, setNum));

      if (row.looseValue != null || row.salesVolume != null) {
        stmts.push(env.DB.prepare(
          `INSERT INTO set_market_ext (set_num, pc_loose_value, pc_sales_volume) VALUES (?1, ?2, ?3)
           ON CONFLICT(set_num) DO UPDATE SET
             pc_loose_value = COALESCE(?2, pc_loose_value),
             pc_sales_volume = COALESCE(?3, pc_sales_volume)`,
        ).bind(setNum, row.looseValue, row.salesVolume));
      }
      if (row.newValue != null || row.completeValue != null || row.looseValue != null) {
        touched.push(setNum);
        updated++;
      }
    }
    // D1 caps bound params + batch size; flush per chunk (≤300 stmts).
    for (let j = 0; j < stmts.length; j += 90) {
      await env.DB.batch(stmts.slice(j, j + 90));
    }
  }

  // Recompute the persisted blend only for OWNED + WISHLISTED touched sets — the
  // user-facing priority — to keep this subrequest-lean at catalog scale (13k+
  // rows). Everything else surfaces live on read (enrichSetRecord) and its
  // persisted blend catches up on the next daily valuation pass.
  if (touched.length) {
    try {
      // Read the (small) owned+wishlisted universe once and intersect in memory —
      // a 13k-item IN(...) would blow SQLite's bind-variable limit.
      const { results } = await env.DB.prepare(
        `SELECT set_num FROM user_collection WHERE deleted_at IS NULL
         UNION SELECT set_num FROM user_wishlist`,
      ).all<{ set_num: string }>();
      const priorityUniverse = new Set(results.map((r) => r.set_num));
      const priority = [...new Set(touched)].filter((s) => priorityUniverse.has(s));
      if (priority.length) await recomputeBlendedValues(env.DB, priority);
    } catch (e) {
      console.warn('[pc-bulk] priority recompute failed:', (e as Error).message);
    }
  }

  const result: BulkResult = {
    rows: rows.length,
    matched,
    unmatched: rows.length - matched,
    updated,
    finished_at: new Date().toISOString(),
  };
  // Persist a summary for admin diagnostics (fail-open).
  try {
    await env.DB.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=?2, updated_at=datetime('now')`,
    ).bind(PROGRESS_KEY, JSON.stringify(result)).run();
  } catch { /* non-fatal */ }
  return result;
}
