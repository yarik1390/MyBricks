import type { Env } from '../types';

export interface BricksetBarcodes {
  upc: string | null;
  ean: string | null;
}

export async function fetchBarcodes(setNum: string, env: Env): Promise<BricksetBarcodes | null> {
  if (!env.BRICKSET_API_KEY) return null;
  try {
    const params = new URLSearchParams({
      apiKey: env.BRICKSET_API_KEY,
      params: JSON.stringify({ setNumber: setNum }),
    });
    const url = `https://brickset.com/api/v3.asmx/getSets?${params}`;
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) return null;
    const data = await resp.json() as Record<string, unknown>;
    const sets = (data.sets as Array<Record<string, unknown>>) ?? [];
    if (!sets.length) return null;
    const barcodes = sets[0].barcodes as { EAN?: string; UPC?: string } | undefined;
    if (!barcodes) return null;
    return {
      upc: barcodes.UPC || null,
      ean: barcodes.EAN || null,
    };
  } catch {
    return null;
  }
}
