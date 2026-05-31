import type { Env } from '../types';

export interface BricksetBarcodes {
  upc: string | null;
  ean: string | null;
}

// Single-set lookup — used for targeted per-set fetches.
export async function fetchBarcodes(setNum: string, env: Env): Promise<BricksetBarcodes | null> {
  if (!env.BRICKSET_API_KEY) return null;
  try {
    const params = new URLSearchParams({
      apiKey: env.BRICKSET_API_KEY,
      userHash: '',
      params: JSON.stringify({ setNumber: setNum }),
    });
    const resp = await fetch(`https://brickset.com/api/v3.asmx/getSets?${params}`, {
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) return null;
    const data = await resp.json() as Record<string, unknown>;
    const sets = (data.sets as Array<Record<string, unknown>>) ?? [];
    if (!sets.length) return null;
    const barcodes = sets[0].barcodes as { EAN?: string; UPC?: string } | undefined;
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
