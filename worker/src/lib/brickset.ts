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

// Barcode-fetch health signal. fetchBarcodesPage records its last outcome here
// (module-scoped, no per-page DB write); the backfill job persists it ONCE per
// run (recordBarcodeHealth in jobs/backfill-upc.ts) and the admin coverage panel
// surfaces it. Backfills are gated to one at a time, so this never interleaves.
export interface BarcodeFetchDiag {
  ok: boolean;
  page: number;
  sets: number;
  withCode: number;
  detail: string;
}
let lastBarcodeFetchDiag: BarcodeFetchDiag = { ok: false, page: 0, sets: 0, withCode: 0, detail: 'no run yet' };
export function getLastBarcodeFetchDiag(): BarcodeFetchDiag {
  return lastBarcodeFetchDiag;
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
      lastBarcodeFetchDiag = { ok: false, page, sets: 0, withCode: 0, detail: `HTTP ${resp.status}` };
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
      lastBarcodeFetchDiag = { ok: false, page, sets: 0, withCode: 0, detail: `status=${data.status ?? 'none'} msg=${data.message ?? ''}`.slice(0, 120) };
      return null;
    }
    if (!data.sets?.length) {
      // Page beyond the last result — a normal end-of-catalog signal, not a failure.
      lastBarcodeFetchDiag = { ok: true, page, sets: 0, withCode: 0, detail: `end of catalog (matches=${data.matches ?? 0})` };
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
    lastBarcodeFetchDiag = { ok: true, page, sets: data.sets.length, withCode, detail: `matches=${data.matches ?? 0}` };
    return { sets, total: data.matches ?? 0 };
  } catch (e) {
    const detail = (e as Error).message || String(e);
    console.warn(`[brickset] page ${page} error:`, detail);
    lastBarcodeFetchDiag = { ok: false, page, sets: 0, withCode: 0, detail: detail.slice(0, 120) };
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
  msrp: number | null;
  launchDate: string | null;
  exitDate: string | null;
  minifigs: number | null;
}

export async function fetchBricksetDetails(setNum: string, env: Env): Promise<BricksetDetails | null> {
  const apiKey = env.BRICKSET_API_KEY;
  if (!apiKey) return null;
  try {
    const variantMatch = setNum.match(/^(.+)-(\d+)$/);
    const bricksetNum = variantMatch ? variantMatch[1] : setNum;
    const variant = variantMatch ? parseInt(variantMatch[2]) : 1;

    // Brickset getSets matches on the FULL set number incl. variant
    // ("10276-1"), NOT the bare design number ("10276") — a bare number returns
    // zero matches (HTTP 200, sets:[]), which is why this fetch silently yielded
    // nothing. fetchBarcodes already uses the variant form; mirror it here.
    const params = new URLSearchParams({
      apiKey: apiKey,
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
    const s = sets.find(x => (x.numberVariant as number) === variant) ?? sets[0];

    // Brickset v3 nests these; older code read flat names and got null. Read the
    // real nested paths with a flat fallback (defensive, like readBarcodes).
    const numN = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null; };
    const strN = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const lc = (s.LEGOCom ?? {}) as Record<string, unknown>;
    const us = (lc.US ?? {}) as Record<string, unknown>;
    const ar = (s.ageRange ?? {}) as Record<string, unknown>;
    const msrp = numN(us.retailPrice) ?? numN((s as Record<string, unknown>).US_retailPrice);
    const ageMin = numN(ar.min) ?? numN((s as Record<string, unknown>).ageMin);
    const ageMax = numN(ar.max) ?? numN((s as Record<string, unknown>).ageMax);
    const launchDate = strN(s.launchDate) ?? strN(us.dateFirstAvailable);
    const exitDate = strN(s.exitDate) ?? strN(us.dateLastAvailable);
    const exitYear = exitDate ? new Date(exitDate).getUTCFullYear() : null;
    const retired = exitDate ? Date.parse(exitDate) < Date.now()
      : (typeof s.retired === 'boolean' ? s.retired : null);

    return {
      rating: typeof s.rating === 'number' ? s.rating : null,
      reviewCount: typeof s.reviewCount === 'number' ? s.reviewCount : null,
      subtheme: strN(s.subtheme),
      ageMin,
      ageMax,
      retired,
      retiredYear: (exitYear && Number.isFinite(exitYear)) ? exitYear : numN((s as Record<string, unknown>).retiredYear),
      msrp,
      launchDate,
      exitDate,
      minifigs: typeof s.minifigs === 'number' ? s.minifigs : null,
    };
  } catch (err) {
    console.error('[brickset-details] Error fetching Brickset details:', err);
    return null;
  }
}

