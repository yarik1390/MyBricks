import type { Env } from '../types';
import { fetchBarcodesPage, fetchBarcodes } from '../lib/brickset';

export interface BackfillResult {
  processed: number;
  filled: number;
  catalogSize: number;
  method: 'bulk' | 'per-set' | 'none';
  error?: string;
}

export async function runBackfillUpc(env: Env): Promise<BackfillResult> {
  if (!env.BRICKSET_API_KEY) {
    return { processed: 0, filled: 0, catalogSize: 0, method: 'none', error: 'BRICKSET_API_KEY not set' };
  }

  const catalogRow = await env.DB.prepare('SELECT COUNT(*) as n FROM lego_sets').first<{ n: number }>();
  const catalogSize = catalogRow?.n ?? 0;
  if (catalogSize === 0) {
    return { processed: 0, filled: 0, catalogSize: 0, method: 'none', error: 'Catalog is empty — run Import sets first' };
  }

  // Try bulk pagination first (efficient: ~44 calls for 22k sets)
  const bulkResult = await tryBulkBackfill(env);
  if (bulkResult !== null) {
    return { ...bulkResult, catalogSize, method: 'bulk' };
  }

  // Brickset bulk pagination didn't return barcodes — fall back to per-set lookup.
  // Order by year DESC so we hit modern sets first (most likely to have barcode data).
  console.warn('[backfill-upc] bulk method failed, falling back to per-set (newest sets first)');
  const perSetResult = await tryPerSetBackfill(env);
  return { ...perSetResult, catalogSize, method: 'per-set' };
}

async function tryBulkBackfill(env: Env): Promise<{ processed: number; filled: number } | null> {
  let processed = 0, filled = 0, page = 1;
  let anyPageSucceeded = false;

  while (true) {
    const result = await fetchBarcodesPage(page, env);
    if (!result) break; // API error — stop
    if (!result.sets.length) break; // no more pages

    anyPageSucceeded = true;
    const stmts: D1PreparedStatement[] = [];
    for (const { setNum, upc } of result.sets) {
      if (!upc || !setNum) continue;
      stmts.push(
        env.DB.prepare('UPDATE lego_sets SET upc=? WHERE set_num=? AND upc IS NULL').bind(upc, setNum),
      );
    }
    for (let i = 0; i < stmts.length; i += 100) {
      const res = await env.DB.batch(stmts.slice(i, i + 100));
      filled += res.reduce((sum, r) => sum + (r.meta.changes ?? 0), 0);
    }
    processed += result.sets.length;
    if (processed >= result.total) break;
    page++;
  }

  if (!anyPageSucceeded) return null;
  return { processed, filled };
}

async function tryPerSetBackfill(env: Env): Promise<{ processed: number; filled: number }> {
  // Newest sets first — modern sets are far more likely to have barcode data in Brickset.
  const { results } = await env.DB.prepare(
    'SELECT set_num FROM lego_sets WHERE upc IS NULL ORDER BY year DESC LIMIT 200'
  ).all<{ set_num: string }>();

  let filled = 0;
  const stmts: D1PreparedStatement[] = [];
  for (const { set_num } of results) {
    const bc = await fetchBarcodes(set_num, env);
    // Accept UPC (US) or EAN (EU) — both work as barcodes; store whichever is available.
    const val = bc?.upc || bc?.ean;
    if (val) {
      stmts.push(env.DB.prepare('UPDATE lego_sets SET upc=? WHERE set_num=?').bind(val, set_num));
      filled++;
    }
  }
  for (let i = 0; i < stmts.length; i += 100) {
    await env.DB.batch(stmts.slice(i, i + 100));
  }
  return { processed: results.length, filled };
}

