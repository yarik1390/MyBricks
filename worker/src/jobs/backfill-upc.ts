import type { Env } from '../types';
import { fetchBarcodesPage } from '../lib/brickset';
import { fetchBrickOwlBarcode } from '../lib/brickowl-barcode';

export interface BackfillResult {
  processed: number;
  filled: number;
  catalogSize: number;
  method: 'bulk' | 'brickowl' | 'none';
  error?: string;
}

export async function runBackfillUpc(env: Env): Promise<BackfillResult> {
  if (!env.BRICKSET_API_KEY && !env.BRICKOWL_API_KEY) {
    return { processed: 0, filled: 0, catalogSize: 0, method: 'none', error: 'No barcode API key configured (BRICKSET_API_KEY or BRICKOWL_API_KEY)' };
  }

  const catalogRow = await env.DB.prepare('SELECT COUNT(*) as n FROM lego_sets').first<{ n: number }>();
  const catalogSize = catalogRow?.n ?? 0;
  if (catalogSize === 0) {
    return { processed: 0, filled: 0, catalogSize: 0, method: 'none', error: 'Catalog is empty — run Import sets first' };
  }

  // Try Brickset bulk pagination first (efficient: ~44 calls for 22k sets)
  if (env.BRICKSET_API_KEY) {
    const bulkResult = await tryBulkBackfill(env);
    if (bulkResult !== null) {
      return { ...bulkResult, catalogSize, method: 'bulk' };
    }
    console.warn('[backfill-upc] Brickset bulk failed, falling back to BrickOwl per-set');
  }

  // Fall back to BrickOwl per-set lookup (200 newest sets per run).
  const perSetResult = await tryBrickOwlBackfill(env);
  return { ...perSetResult, catalogSize, method: 'brickowl' };
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

async function tryBrickOwlBackfill(env: Env): Promise<{ processed: number; filled: number }> {
  // Newest sets first — modern sets are more likely to have barcode data.
  const { results } = await env.DB.prepare(
    'SELECT set_num FROM lego_sets WHERE upc IS NULL ORDER BY year DESC LIMIT 200'
  ).all<{ set_num: string }>();

  let filled = 0;
  const stmts: D1PreparedStatement[] = [];
  for (const { set_num } of results) {
    const ean = await fetchBrickOwlBarcode(set_num, env);
    if (ean) {
      stmts.push(env.DB.prepare('UPDATE lego_sets SET upc=? WHERE set_num=?').bind(ean, set_num));
      filled++;
    }
  }
  for (let i = 0; i < stmts.length; i += 100) {
    await env.DB.batch(stmts.slice(i, i + 100));
  }
  return { processed: results.length, filled };
}

