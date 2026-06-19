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

// Numeric/string coercion shared by the barcode + detail parsers.
const numN = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const strN = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

// Rich Brickset fields present on a getSets `set` when extendedData:1 is set.
// Brickset v3 nests these (LEGOCom.US.retailPrice, ageRange.min/max, top-level
// launchDate/exitDate); read the real nested paths with a flat fallback,
// defensively (like readBarcodes). Shared by fetchBarcodesPage (bulk catalog
// enrichment) and fetchBricksetDetails (single-set view).
export interface BricksetEnrichment {
  msrp: number | null;
  launchDate: string | null;
  exitDate: string | null;
  ageMin: number | null;
  ageMax: number | null;
  rating: number | null;
  reviewCount: number | null;
  subtheme: string | null;
  retiredYear: number | null;
  themeGroup: string | null;
  category: string | null;
  tags: string | null;
  dimensions: string | null;
  packagingType: string | null;
  instructionsCount: number | null;
  additionalImageCount: number | null;
  description: string | null;
  setId: number | null;
}

export function parseEnrichment(s: Record<string, unknown>): BricksetEnrichment {
  const lc = (s.LEGOCom ?? {}) as Record<string, unknown>;
  const us = (lc.US ?? {}) as Record<string, unknown>;
  const ar = (s.ageRange ?? {}) as Record<string, unknown>;
  const ed = (s.extendedData ?? {}) as Record<string, unknown>;
  const launchDate = strN(s.launchDate) ?? strN(us.dateFirstAvailable);
  const exitDate = strN(s.exitDate) ?? strN(us.dateLastAvailable);
  const exitYear = exitDate ? new Date(exitDate).getUTCFullYear() : null;
  const tagList = Array.isArray(ed.tags)
    ? (ed.tags as unknown[]).map(t => (typeof t === 'string' ? t.trim() : '')).filter(Boolean)
    : [];
  const dim = (s.dimensions ?? {}) as Record<string, unknown>;
  const dimObj = { height: numN(dim.height), width: numN(dim.width), depth: numN(dim.depth), weight: numN(dim.weight) };
  const hasDim = Object.values(dimObj).some(v => v !== null);
  return {
    msrp: numN(us.retailPrice) ?? numN(s.US_retailPrice),
    launchDate,
    exitDate,
    ageMin: numN(ar.min) ?? numN(s.ageMin),
    ageMax: numN(ar.max) ?? numN(s.ageMax),
    rating: typeof s.rating === 'number' ? s.rating : null,
    reviewCount: typeof s.reviewCount === 'number' ? s.reviewCount : null,
    subtheme: strN(s.subtheme),
    retiredYear: (exitYear && Number.isFinite(exitYear)) ? exitYear : numN(s.retiredYear),
    themeGroup: strN(s.themeGroup),
    category: strN(s.category),
    tags: tagList.length ? JSON.stringify(tagList) : null,
    dimensions: hasDim ? JSON.stringify(dimObj) : null,
    packagingType: strN(s.packagingType),
    instructionsCount: numN(s.instructionsCount),
    additionalImageCount: numN(s.additionalImageCount),
    description: strN(ed.description),
    setId: numN(s.setID),
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
  sets: Array<{ setNum: string; upc: string | null; enrichment: BricksetEnrichment }>;
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
        const rec = s as Record<string, unknown>;
        const barcode = readBarcodes(rec);
        return {
          setNum: `${s.number}-${s.numberVariant ?? 1}`,
          upc: barcode.upc || barcode.ean,
          enrichment: parseEnrichment(rec),
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
  themeGroup: string | null;
  category: string | null;
  tags: string | null;
  dimensions: string | null;
  packagingType: string | null;
  instructionsCount: number | null;
  additionalImageCount: number | null;
  description: string | null;
  setId: number | null;
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

    // Shared parse of the rich extendedData fields. `retired` is detail-only
    // (derived from exitDate, else the boolean flag).
    const e = parseEnrichment(s);
    const retired = e.exitDate ? Date.parse(e.exitDate) < Date.now()
      : (typeof s.retired === 'boolean' ? s.retired : null);

    return {
      rating: e.rating,
      reviewCount: e.reviewCount,
      subtheme: e.subtheme,
      ageMin: e.ageMin,
      ageMax: e.ageMax,
      retired,
      retiredYear: e.retiredYear,
      msrp: e.msrp,
      launchDate: e.launchDate,
      exitDate: e.exitDate,
      themeGroup: e.themeGroup,
      category: e.category,
      tags: e.tags,
      dimensions: e.dimensions,
      packagingType: e.packagingType,
      instructionsCount: e.instructionsCount,
      additionalImageCount: e.additionalImageCount,
      description: e.description,
      setId: e.setId,
      minifigs: typeof s.minifigs === 'number' ? s.minifigs : null,
    };
  } catch (err) {
    console.error('[brickset-details] Error fetching Brickset details:', err);
    return null;
  }
}

// On-demand Brickset photo gallery. getAdditionalImages COSTS quota (one call
// per set), unlike the getSets enrichment which is free — callers must gate it
// (spendQuota) and cache the result. Takes Brickset's internal setID (captured
// as brickset_set_id during enrichment). Returns full-size image URLs.
export async function fetchAdditionalImages(setId: number, env: Env): Promise<string[] | null> {
  if (!env.BRICKSET_API_KEY || !setId) return null;
  try {
    const params = new URLSearchParams({ apiKey: env.BRICKSET_API_KEY, setID: String(setId) });
    const resp = await fetchTracked(env, 'brickset', `https://brickset.com/api/v3.asmx/getAdditionalImages?${params}`, {
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { status?: string; additionalImages?: Array<Record<string, unknown>> };
    if (String(data.status ?? '').trim().toLowerCase() !== 'success') return null;
    const imgs = Array.isArray(data.additionalImages) ? data.additionalImages : [];
    return imgs
      .map(i => (typeof i.imageURL === 'string' ? i.imageURL : (typeof i.thumbnailURL === 'string' ? i.thumbnailURL : null)))
      .filter((u): u is string => !!u);
  } catch {
    return null;
  }
}
