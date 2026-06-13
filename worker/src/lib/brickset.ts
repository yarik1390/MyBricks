import type { Env } from '../types';
import { fetchTracked } from './http';

export interface BricksetBarcodes {
  upc: string | null;
  ean: string | null;
}

function cleanBarcode(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/\D/g, '');
  return digits.length >= 8 ? digits : null;
}

function readBarcodes(s: Record<string, unknown>): BricksetBarcodes {
  // Brickset's Sets object exposes a SINGULAR `barcode` member of class
  // `barcodes` ({ EAN, UPC }). We previously read `s.barcodes` (plural), which
  // never matched, so every parsed set yielded no UPC. Prefer the correct
  // singular field; tolerate plural/flat shapes as fallbacks.
  const bc = (s.barcode ?? s.barcodes) as Record<string, unknown> | undefined;
  return {
    upc: cleanBarcode(bc?.UPC ?? bc?.upc ?? s.UPC ?? s.upc),
    ean: cleanBarcode(bc?.EAN ?? bc?.ean ?? s.EAN ?? s.ean),
  };
}

// Validate the API key. Returns null on success, or an error string.
export async function checkBricksetKey(env: Env): Promise<string | null> {
  if (!env.BRICKSET_API_KEY) return 'BRICKSET_API_KEY not set';
  try {
    const resp = await fetchTracked(
      env,
      'brickset',
      `https://brickset.com/api/v3.asmx/checkKey?apiKey=${encodeURIComponent(env.BRICKSET_API_KEY)}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!resp.ok) return `HTTP ${resp.status}`;
    const data = await resp.json() as { status?: string; message?: string };
    const status = String(data.status ?? '').trim().toLowerCase();
    if (status === 'ok' || status === 'success') return null;
    return `Brickset says: ${data.message || data.status || 'unknown status'}`;
  } catch (e) {
    return (e as Error).message;
  }
}

// Single-set lookup — used for targeted per-set fetches.
export async function fetchBarcodes(setNum: string, env: Env): Promise<BricksetBarcodes | null> {
  if (!env.BRICKSET_API_KEY) return null;
  try {
    // Rebrickable format is "75192-1"; Brickset setNumber is just "75192".
    // Extract the variant so we can match the right set when multiple variants exist.
    const variantMatch = setNum.match(/^(.+)-(\d+)$/);
    const bricksetNum = variantMatch ? variantMatch[1] : setNum;
    const variant = variantMatch ? parseInt(variantMatch[2]) : 1;

    const params = new URLSearchParams({
      apiKey: env.BRICKSET_API_KEY,
      userHash: '',
      params: JSON.stringify({ setNumber: `${bricksetNum}-${variant}`, extendedData: 1 }),
    });
    const resp = await fetchTracked(env, 'brickset', `https://brickset.com/api/v3.asmx/getSets?${params}`, {
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) return null;
    const data = await resp.json() as Record<string, unknown>;
    const sets = (data.sets as Array<Record<string, unknown>>) ?? [];
    if (!sets.length) return null;
    // Prefer the matching variant; fall back to the first result.
    const s = sets.find(x => (x.numberVariant as number) === variant) ?? sets[0];
    const barcodes = readBarcodes(s);
    if (!barcodes.upc && !barcodes.ean) return null;
    return barcodes;
  } catch {
    return null;
  }
}

export interface BricksetPageResult {
  sets: Array<{ setNum: string; upc: string | null }>;
  total: number;
}

// Brickset bulk barcode page size. Kept well under Brickset's 500 max so the
// extendedData response returns within the request timeout — a 500-set page was
// exceeding the 8s default and aborting ("The operation was aborted"), which
// silently filled zero UPCs.
export const BARCODE_PAGE_SIZE = 250;

// TEMP DIAGNOSTIC: record the bulk barcode fetch outcome to a dedicated
// integration_health row ('brickset_barcode') so it survives the frequent
// successful per-set 'brickset' calls and is readable via D1 without worker
// logs. Remove once barcode coverage is confirmed flowing. No-throw.
async function recordBarcodeProbe(env: Env, message: string, ok = false): Promise<void> {
  try {
    const okFlag = ok ? 1 : 0;
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
      message.slice(0, 400),
      okFlag,
      ok ? 0 : 1,
      okFlag,
    ).run();
  } catch { /* diagnostic only */ }
}

// Paginated bulk fetch — barcode data, BARCODE_PAGE_SIZE sets per page.
export async function fetchBarcodesPage(page: number, env: Env): Promise<BricksetPageResult | null> {
  if (!env.BRICKSET_API_KEY) return null;
  try {
    const params = new URLSearchParams({
      apiKey: env.BRICKSET_API_KEY,
      userHash: '',
      // Brickset getSets rejects a query with no *selection* criterion with
      // "No valid parameters" — pageSize/pageNumber/extendedData don't count.
      // updatedSince far in the past selects the whole catalog. orderBy
      // YearFromDESC pages the barcode-rich modern sets first (vintage sets
      // mostly lack barcodes). String values match the documented contract;
      // descending sort is the field name + DESC with no space (e.g. PiecesDESC).
      params: JSON.stringify({ updatedSince: '1900-01-01', orderBy: 'YearFromDESC', pageSize: String(BARCODE_PAGE_SIZE), pageNumber: String(page), extendedData: '1' }),
    });
    // Bulk pages carry a large payload; give them a longer timeout than the 8s
    // default so they don't abort and fall through to a silent zero-fill.
    const resp = await fetchTracked(env, 'brickset', `https://brickset.com/api/v3.asmx/getSets?${params}`, {
      headers: { Accept: 'application/json' },
    }, { timeoutMs: 20000 });
    if (!resp.ok) {
      console.warn(`[brickset] page ${page} HTTP ${resp.status}`);
      await recordBarcodeProbe(env, `page ${page} HTTP ${resp.status}`);
      return null;
    }
    const data = await resp.json() as {
      status?: string;
      message?: string;
      matches?: number;
      sets?: Array<Record<string, unknown> & {
        number?: string;
        numberVariant?: number;
      }>;
    };
    if (String(data.status ?? '').trim().toLowerCase() !== 'success') {
      console.warn(`[brickset] page ${page} status=${data.status} message=${data.message}`);
      await recordBarcodeProbe(env, `page ${page} status=${data.status ?? 'none'} msg=${data.message ?? ''}`);
      return null;
    }
    if (!data.sets?.length) {
      await recordBarcodeProbe(env, `page ${page} status=success matches=${data.matches ?? 0} sets=0`);
      return null;
    }

    const sets = data.sets
      .filter(s => s.number)
      .map(s => {
        const barcode = readBarcodes(s as Record<string, unknown>);
        return {
          setNum: `${s.number}-${s.numberVariant ?? 1}`,
          upc: barcode.upc || barcode.ean,
        };
      });
    // Diagnostic: how many parsed to a barcode, plus the first set's keys and
    // raw barcode shape — confirms the field name end-to-end on real data.
    const withCode = sets.filter(s => s.upc).length;
    const sample = data.sets[0] as Record<string, unknown>;
    await recordBarcodeProbe(
      env,
      `OK page ${page} matches=${data.matches ?? 0} sets=${data.sets.length} withCode=${withCode} keys=${Object.keys(sample).slice(0, 16).join(',')} bc=${JSON.stringify(sample.barcode ?? sample.barcodes ?? null)}`,
      true,
    );
    return { sets, total: data.matches ?? 0 };
  } catch (e) {
    console.warn(`[brickset] page ${page} error:`, (e as Error).message);
    return null;
  }
}

export interface BricksetDetails {
  rating: number | null;
  reviewCount: number | null;
  subtheme: string | null;
  ageMin: number | null;
  ageMax: number | null;
  retired: boolean | null;
  retiredYear: number | null;
  usRetailPrice: number | null;
  minifigs: number | null;
}

export async function fetchBricksetDetails(setNum: string, env: Env): Promise<BricksetDetails | null> {
  const apiKey = env.BRICKSET_API_KEY;
  if (!apiKey) return null;
  try {
    const variantMatch = setNum.match(/^(.+)-(\d+)$/);
    const bricksetNum = variantMatch ? variantMatch[1] : setNum;
    const variant = variantMatch ? parseInt(variantMatch[2]) : 1;

    const params = new URLSearchParams({
      apiKey: apiKey,
      userHash: '',
      params: JSON.stringify({ setNumber: bricksetNum }),
    });
    const resp = await fetchTracked(env, 'brickset', `https://brickset.com/api/v3.asmx/getSets?${params}`, {
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) return null;
    const data = await resp.json() as Record<string, unknown>;
    const sets = (data.sets as Array<Record<string, unknown>>) ?? [];
    if (!sets.length) return null;
    const s = sets.find(x => (x.numberVariant as number) === variant) ?? sets[0];

    const ageMin = s.ageMin !== undefined ? Number(s.ageMin) : null;
    const ageMax = s.ageMax !== undefined ? Number(s.ageMax) : null;

    return {
      rating: typeof s.rating === 'number' ? s.rating : null,
      reviewCount: typeof s.reviewCount === 'number' ? s.reviewCount : null,
      subtheme: typeof s.subtheme === 'string' ? s.subtheme : null,
      ageMin: isNaN(ageMin as number) ? null : ageMin,
      ageMax: isNaN(ageMax as number) ? null : ageMax,
      retired: typeof s.released === 'boolean' && typeof s.retired === 'boolean' ? s.retired : null,
      retiredYear: typeof s.retiredYear === 'number' ? s.retiredYear : null,
      usRetailPrice: typeof s.US_retailPrice === 'number' ? s.US_retailPrice : null,
      minifigs: typeof s.minifigs === 'number' ? s.minifigs : null,
    };
  } catch (err) {
    console.error('[brickset-details] Error fetching Brickset details:', err);
    return null;
  }
}

