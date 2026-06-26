import type { Env } from '../types';
import { recomputeBlendedValues } from '../lib/market-sources';
import { isPlausibleMarketValue } from '../lib/valuation';

// ---------------------------------------------------------------------------
// Optional PriceCharting bulk CSV import (Legendary tier only).
//
// The bulk price-guide CSV is a manual download from the PriceCharting
// Subscriptions page (there is no documented programmatic URL), so this job
// takes the uploaded CSV TEXT from an admin route rather than fetching it. It is
// gated by PRICECHARTING_PRO. The per-set /api/product path
// (jobs/pricecharting-enrich.ts) remains the primary, always-on mechanism; this
// is a fast bulk top-up when a Legendary user has the file.
//
// CSV column names match the API key names exactly: id, upc, product-name,
// new-price, cib-price, loose-price, sales-volume. Prices are integer pennies.
// Sets are matched by upc → pc_id → set number parsed from product-name.
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

const cents = (v: string | undefined): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n / 100 : null;
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
    const setMatch = name.match(/\b(\d{4,6})\b/);
    const vol = Number(iVol >= 0 ? v[iVol] : undefined);
    rows.push({
      pcId: iId >= 0 && v[iId] ? v[iId] : null,
      upc: iUpc >= 0 && v[iUpc] ? v[iUpc] : null,
      setBase: setMatch ? setMatch[1] : null,
      newValue: gate(cents(iNew >= 0 ? v[iNew] : undefined)),
      completeValue: gate(cents(iCib >= 0 ? v[iCib] : undefined)),
      looseValue: gate(cents(iLoose >= 0 ? v[iLoose] : undefined)),
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

  if (touched.length) await recomputeBlendedValues(env.DB, touched);

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
