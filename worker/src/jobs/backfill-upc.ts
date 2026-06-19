import type { Env } from '../types';
import { fetchBarcodesPage, BARCODE_PAGE_SIZE, getLastBarcodeFetchDiag } from '../lib/brickset';
import { fetchBrickOwlBarcode } from '../lib/brickowl-barcode';
import { brickOwlEnabled } from '../lib/pricing-flags';

export interface BackfillResult {
  processed: number;
  filled: number;
  enriched?: number;
  catalogSize: number;
  method: 'bulk' | 'brickowl' | 'none';
  complete: boolean;
  nextPage?: number;
  error?: string;
  note?: string;
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

// Durable barcode page cursor. The previous resume logic parsed the latest
// import_run error string, but populate-everything overwrites that with a final
// summary (losing next_page) and uses a different prefix — so paging restarted
// at page 1 every run. We persist the next page in a dedicated integration_health
// row instead (ok_count = next page). It's not rendered in the admin panel (that
// only enumerates known integrations) and needs no schema change.
const BARCODE_CURSOR_SERVICE = 'barcode_cursor';

export async function getBarcodeCursor(env: Env): Promise<number> {
  try {
    const row = await env.DB.prepare(
      'SELECT ok_count FROM integration_health WHERE service=?'
    ).bind(BARCODE_CURSOR_SERVICE).first<{ ok_count: number }>();
    const n = Number(row?.ok_count);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export async function setBarcodeCursor(env: Env, page: number): Promise<void> {
  const p = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  try {
    await env.DB.prepare(
      `INSERT INTO integration_health (service, ok_count, fail_count, last_error, updated_at)
       VALUES (?1, ?2, 0, ?3, datetime('now'))
       ON CONFLICT(service) DO UPDATE SET ok_count=?2, last_error=?3, updated_at=datetime('now')`
    ).bind(BARCODE_CURSOR_SERVICE, p, `next barcode page: ${p}`).run();
  } catch {
    /* cursor is best-effort */
  }
}

export async function nextBackfillPage(env: Env): Promise<number> {
  const cursor = await getBarcodeCursor(env);
  if (cursor > 0) return cursor;
  // Legacy fallback until the durable cursor is initialized by the first pass.
  const row = await env.DB.prepare(
    `SELECT error FROM import_runs
     WHERE error LIKE 'method:bulk%'
     ORDER BY started_at DESC
     LIMIT 1`
  ).first<{ error: string | null }>();
  return parseNextBackfillPage(row?.error);
}

// Persist the barcode backfill outcome ONCE per run (not per page) to a
// dedicated integration_health row the admin coverage panel reads. The row is
// not rendered as an integration (getIntegrationDiagnostics only enumerates
// known services). Best-effort.
export async function recordBarcodeHealth(env: Env, ok: boolean, detail: string): Promise<void> {
  const okFlag = ok ? 1 : 0;
  try {
    await env.DB.prepare(
      `INSERT INTO integration_health (service, last_ok_at, last_fail_at, last_error, ok_count, fail_count, updated_at)
       VALUES ('brickset_barcode', ?1, ?2, ?3, ?4, ?5, datetime('now'))
       ON CONFLICT(service) DO UPDATE SET
         last_error = ?3,
         last_ok_at = CASE WHEN ?6 = 1 THEN datetime('now') ELSE integration_health.last_ok_at END,
         last_fail_at = CASE WHEN ?6 = 1 THEN integration_health.last_fail_at ELSE datetime('now') END,
         ok_count = integration_health.ok_count + ?4,
         fail_count = integration_health.fail_count + ?5,
         updated_at = datetime('now')`,
    ).bind(
      ok ? new Date().toISOString() : null,
      ok ? null : new Date().toISOString(),
      detail.slice(0, 300),
      okFlag,
      ok ? 0 : 1,
      okFlag,
    ).run();
  } catch { /* best-effort */ }
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
      // Advance the durable cursor so the next run pages forward (or wraps to 1
      // once the catalog has been fully walked).
      const startPage = Math.max(1, options.startPage || 1);
      await setBarcodeCursor(env, bulkResult.complete ? 1 : (bulkResult.nextPage ?? startPage + 1));
      return { ...bulkResult, catalogSize, method: 'bulk' };
    }
    // Brickset bulk returned no data (e.g. a timed-out page). Don't fail silently
    // with zero fills — fall back to BrickOwl per-set lookups when available so
    // barcode coverage still advances.
    if (env.BRICKOWL_API_KEY && brickOwlEnabled(env)) {
      console.warn('[backfill-upc] Brickset bulk returned no data; falling back to BrickOwl');
      const perSetResult = await tryBrickOwlBackfill(env);
      return {
        ...perSetResult,
        catalogSize,
        method: 'brickowl',
        note: 'Brickset bulk unavailable; used BrickOwl per-set fallback',
      };
    }
    console.warn('[backfill-upc] Brickset bulk failed and no BrickOwl key configured');
    return {
      processed: 0,
      filled: 0,
      catalogSize,
      method: 'bulk',
      complete: false,
      nextPage: Math.max(1, options.startPage || 1),
      note: 'Brickset barcode backfill returned no data; retrying on the next run',
    };
  }

  const perSetResult = await tryBrickOwlBackfill(env);
  return { ...perSetResult, catalogSize, method: 'brickowl' };
}

async function tryBulkBackfill(
  env: Env,
  options: BackfillOptions,
): Promise<{ processed: number; filled: number; enriched: number; complete: boolean; nextPage?: number } | null> {
  let processed = 0;
  let filled = 0;
  let enriched = 0;
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
    const enrichStmts: D1PreparedStatement[] = [];
    for (const { setNum, upc, enrichment } of result.sets) {
      if (!setNum) continue;
      if (upc) {
        stmts.push(
          env.DB.prepare("UPDATE lego_sets SET upc=? WHERE set_num=? AND NULLIF(TRIM(COALESCE(upc, '')), '') IS NULL").bind(upc, setNum),
        );
      }
      // Backfill the rich Brickset fields for EVERY set in the page (not just
      // barcode hits), riding the getSets call we already made. Gap-fill only
      // (COALESCE) so existing data is never clobbered; retail_price is
      // gap-filled from official MSRP but never overwritten (avoids shifting
      // formula values catalog-wide). brickset_enriched_at marks the set done
      // so it's enriched exactly once and later sweeps skip it.
      const e = enrichment;
      enrichStmts.push(
        env.DB.prepare(
          `UPDATE lego_sets SET
             brickset_msrp = COALESCE(brickset_msrp, ?),
             launch_date = COALESCE(launch_date, ?),
             exit_date = COALESCE(exit_date, ?),
             age_min = COALESCE(age_min, ?),
             age_max = COALESCE(age_max, ?),
             brickset_rating = COALESCE(brickset_rating, ?),
             brickset_review_count = COALESCE(brickset_review_count, ?),
             subtheme = COALESCE(subtheme, ?),
             retired_year = COALESCE(retired_year, ?),
             theme_group = COALESCE(theme_group, ?),
             category = COALESCE(category, ?),
             brickset_tags = COALESCE(brickset_tags, ?),
             retail_price = COALESCE(retail_price, ?),
             brickset_enriched_at = datetime('now')
           WHERE set_num = ? AND brickset_enriched_at IS NULL`,
        ).bind(e.msrp, e.launchDate, e.exitDate, e.ageMin, e.ageMax, e.rating, e.reviewCount, e.subtheme, e.retiredYear, e.themeGroup, e.category, e.tags, e.msrp, setNum),
      );
    }
    for (let i = 0; i < stmts.length; i += 100) {
      const res = await env.DB.batch(stmts.slice(i, i + 100));
      filled += res.reduce((sum, r) => sum + (r.meta.changes ?? 0), 0);
    }
    for (let i = 0; i < enrichStmts.length; i += 100) {
      const res = await env.DB.batch(enrichStmts.slice(i, i + 100));
      enriched += res.reduce((sum, r) => sum + (r.meta.changes ?? 0), 0);
    }

    processed += result.sets.length;
    pagesRead++;
    complete = page * BARCODE_PAGE_SIZE >= result.total;
    const nextPage = complete ? undefined : page + 1;
    if (options.onProgress) {
      await options.onProgress({ processed, filled, nextPage, complete });
    }
    if (complete || pagesRead >= maxPages) break;
    page++;
  }

  const diag = getLastBarcodeFetchDiag();
  if (!anyPageSucceeded) {
    // Nothing fetched this run — record why (e.g. an API error) for the panel.
    await recordBarcodeHealth(env, false, `no data at page ${page}: ${diag.detail}`);
    return null;
  }
  const next = complete ? undefined : page + 1;
  await recordBarcodeHealth(
    env,
    true,
    `pages ${Math.max(1, options.startPage || 1)}-${page} · filled ${filled}/${processed} · enriched ${enriched} · withCode ${diag.withCode}/page · complete:${complete} · next:${complete ? 1 : (next ?? page + 1)}`,
  );
  return { processed, filled, enriched, complete, nextPage: next };
}

async function tryBrickOwlBackfill(env: Env): Promise<{ processed: number; filled: number; complete: boolean }> {
  const { results } = await env.DB.prepare(
    'SELECT set_num FROM lego_sets WHERE upc IS NULL ORDER BY year DESC LIMIT 2'
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
  return { processed: results.length, filled, complete: results.length < 2 };
}
