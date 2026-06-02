import type { Env } from '../types';

export interface BricksetBarcodes {
  upc: string | null;
  ean: string | null;
}

// Validate the API key. Returns null on success, or an error string.
export async function checkBricksetKey(env: Env): Promise<string | null> {
  if (!env.BRICKSET_API_KEY) return 'BRICKSET_API_KEY not set';
  try {
    const resp = await fetch(
      `https://brickset.com/api/v3.asmx/checkKey?apiKey=${encodeURIComponent(env.BRICKSET_API_KEY)}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!resp.ok) return `HTTP ${resp.status}`;
    const data = await resp.json() as { status?: string };
    if (data.status === 'OK' || data.status === 'success') return null;
    return `Brickset says: ${data.status}`;
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
      params: JSON.stringify({ setNumber: bricksetNum }),
    });
    const resp = await fetch(`https://brickset.com/api/v3.asmx/getSets?${params}`, {
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) return null;
    const data = await resp.json() as Record<string, unknown>;
    const sets = (data.sets as Array<Record<string, unknown>>) ?? [];
    if (!sets.length) return null;
    // Prefer the matching variant; fall back to the first result.
    const s = sets.find(x => (x.numberVariant as number) === variant) ?? sets[0];
    const barcodes = s.barcodes as { EAN?: string; UPC?: string } | undefined;
    if (!barcodes) return null;
    return { upc: barcodes.UPC || null, ean: barcodes.EAN || null };
  } catch {
    return null;
  }
}

export interface BricksetPageResult {
  sets: Array<{ setNum: string; upc: string | null }>;
  total: number;
}

// Paginated bulk fetch — 500 sets per page with barcode data.
export async function fetchBarcodesPage(page: number, env: Env): Promise<BricksetPageResult | null> {
  if (!env.BRICKSET_API_KEY) return null;
  try {
    const params = new URLSearchParams({
      apiKey: env.BRICKSET_API_KEY,
      userHash: '',
      params: JSON.stringify({ pageSize: 500, pageNumber: page }),
    });
    const resp = await fetch(`https://brickset.com/api/v3.asmx/getSets?${params}`, {
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) {
      console.warn(`[brickset] page ${page} HTTP ${resp.status}`);
      return null;
    }
    const data = await resp.json() as {
      status?: string;
      message?: string;
      matches?: number;
      sets?: Array<{
        number?: string;
        numberVariant?: number;
        barcodes?: { EAN?: string; UPC?: string };
      }>;
    };
    if (data.status !== 'success') {
      console.warn(`[brickset] page ${page} status=${data.status} message=${data.message}`);
      return null;
    }
    if (!data.sets?.length) return null;

    const sets = data.sets
      .filter(s => s.number)
      .map(s => ({
        setNum: `${s.number}-${s.numberVariant ?? 1}`,
        upc: s.barcodes?.UPC || s.barcodes?.EAN || null,
      }));
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
  const apiKey = env.BRICKSET_API_KEY || '3-R8Fj-5jn5-Ox8oN';
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
    const resp = await fetch(`https://brickset.com/api/v3.asmx/getSets?${params}`, {
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

