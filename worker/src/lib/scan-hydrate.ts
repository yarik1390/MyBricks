// Scan results must show the same price as the set page and the Vault.
// Every scan path (barcode, on-device OCR, Brickognize, AI vision) used to
// enrich its catalog row without the persisted v3 valuation state, so a scan
// card could show a recomputed or legacy value that disagreed with the set
// page. This loads the catalog-card projection (CATALOG_COLS + the
// set_market_ext / set_valuation_state joins), attaches the stored v3 state
// and runs enrichSetRecord, exactly as /api/sets/search and the offline seed do.
import { CATALOG_COLS, MARKET_EXT_JOIN, attachCatalogValuationState } from '../routes/sets-sql';
import { enrichSetRecord } from './market-sources';

// D1 allows 100 bound parameters per statement; stay well under it.
const CHUNK = 80;

/**
 * Catalog-card rows for these set numbers, keyed by set_num, priced the same
 * way as the set page. Set numbers missing from the catalog are absent from
 * the map. Returns null when the full pricing tables are not there (a minimal
 * test schema), so callers keep their own rows instead of failing the scan.
 */
export async function hydrateScanSets(
  db: D1Database,
  setNums: string[],
): Promise<Map<string, Record<string, unknown>> | null> {
  const wanted = [...new Set(setNums.map(String).filter(Boolean))];
  const out = new Map<string, Record<string, unknown>>();
  if (!wanted.length) return out;
  try {
    for (let i = 0; i < wanted.length; i += CHUNK) {
      const chunk = wanted.slice(i, i + CHUNK);
      const { results } = await db.prepare(
        `SELECT ${CATALOG_COLS} FROM lego_sets s ${MARKET_EXT_JOIN} WHERE s.set_num IN (${chunk.map(() => '?').join(',')})`,
      ).bind(...chunk).all<Record<string, unknown>>();
      for (const row of results || []) {
        out.set(String(row.set_num), enrichSetRecord(attachCatalogValuationState({ ...row, retired: !!row.retired })));
      }
    }
    return out;
  } catch (e) {
    console.warn('[scan-hydrate] catalog projection failed:', (e as Error).message);
    return null;
  }
}

/** One set, priced like the set page, or null when it is not in the catalog. */
export async function hydrateScanSet(db: D1Database, setNum: string): Promise<Record<string, unknown> | null> {
  const map = await hydrateScanSets(db, [setNum]);
  return map?.get(String(setNum)) ?? null;
}
