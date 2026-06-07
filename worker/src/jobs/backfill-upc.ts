import type { Env } from '../types';
import { fetchBarcodesPage } from '../lib/brickset';
import { fetchBrickOwlBarcode } from '../lib/brickowl-barcode';

export interface BackfillResult {
  processed: number;
  filled: number;
  catalogSize: number;
  method: 'bulk' | 'brickowl' | 'none';
  complete: boolean;
  nextPage?: number;
  error?: string;
}

export interface BackfillOptions {
  startPage?: number;
  maxPages?: number;
  onProgress?: (progress: { processed: number; filled: number; nextPage?: number; complete: boolean }) => Promise<void>;
}

export function parseNextBackfillPage(error?: string | null): number {
  if (!error || /complete:true/.test(error)) return 1;
  const match = error.match(/next_page:(\d+)/);
  const n = match ? Number(match[1]) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export async function nextBackfillPage(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT error FROM import_runs
     WHERE error LIKE 'method:bulk%'
     ORDER BY started_at DESC
     LIMIT 1`
  ).first<{ error: string | null }>();
  return parseNextBackfillPage(row?.error);
}

export async function runBackfillUpc(env: Env, options: BackfillOptions = {}): Promise<BackfillResult> {
  if (!env.BRICKSET_API_KEY && !env.BRICKOWL_API_KEY) {
    return {
      processed: 0,
      filled: 0,
      catalogSize: 0,
      method: 'none',
      complete: true,
      error: 'No barcode API key configured (BRICKSET_API_KEY or BRICKOWL_API_KEY)',
    };
  }

  const catalogRow = await env.DB.prepare('SELECT COUNT(*) as n FROM lego_sets').first<{ n: number }>();
  const catalogSize = catalogRow?.n ?? 0;
  if (catalogSize === 0) {
    return {
      processed: 0,
      filled: 0,
      catalogSize: 0,
      method: 'none',
      complete: true,
      error: 'Catalog is empty - run Import sets first',
    };
  }

  if (env.BRICKSET_API_KEY) {
    const bulkResult = await tryBulkBackfill(env, options);
    if (bulkResult !== null) {
      return { ...bulkResult, catalogSize, method: 'bulk' };
    }
    console.warn('[backfill-upc] Brickset bulk failed, falling back to BrickOwl per-set');
  }

  const perSetResult = await tryBrickOwlBackfill(env);
  return { ...perSetResult, catalogSize, method: 'brickowl' };
}

async function tryBulkBackfill(
  env: Env,
  options: BackfillOptions,
): Promise<{ processed: number; filled: number; complete: boolean; nextPage?: number } | null> {
  let processed = 0;
  let filled = 0;
  let page = Math.max(1, options.startPage || 1);
  const maxPages = Math.max(1, Math.min(options.maxPages || 4, 10));
  let pagesRead = 0;
  let anyPageSucceeded = false;
  let complete = false;

  while (true) {
    const result = await fetchBarcodesPage(page, env);
    if (!result) break;
    if (!result.sets.length) {
      complete = true;
      break;
    }

    anyPageSucceeded = true;
    const stmts: D1PreparedStatement[] = [];
    for (const { setNum, upc } of result.sets) {
      if (!upc || !setNum) continue;
      stmts.push(
        env.DB.prepare("UPDATE lego_sets SET upc=? WHERE set_num=? AND NULLIF(TRIM(COALESCE(upc, '')), '') IS NULL").bind(upc, setNum),
      );
    }
    for (let i = 0; i < stmts.length; i += 100) {
      const res = await env.DB.batch(stmts.slice(i, i + 100));
      filled += res.reduce((sum, r) => sum + (r.meta.changes ?? 0), 0);
    }

    processed += result.sets.length;
    pagesRead++;
    complete = page * 500 >= result.total;
    const nextPage = complete ? undefined : page + 1;
    if (options.onProgress) {
      await options.onProgress({ processed, filled, nextPage, complete });
    }
    if (complete || pagesRead >= maxPages) break;
    page++;
  }

  if (!anyPageSucceeded) return null;
  return { processed, filled, complete, nextPage: complete ? undefined : page + 1 };
}

async function tryBrickOwlBackfill(env: Env): Promise<{ processed: number; filled: number; complete: boolean }> {
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
  return { processed: results.length, filled, complete: results.length < 200 };
}
