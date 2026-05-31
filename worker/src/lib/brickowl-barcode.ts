import type { Env } from '../types';

// Returns the EAN-13 barcode for a LEGO set via BrickOwl catalog/lookup.
// EAN-13 is compatible with the UPC column — the scan route already handles
// the EAN↔UPC conversion (strip/add leading 0).
export async function fetchBrickOwlBarcode(setNum: string, env: Env): Promise<string | null> {
  if (!env.BRICKOWL_API_KEY) return null;
  try {
    // Rebrickable format is "75192-1"; BrickOwl expects just "75192".
    const id = setNum.replace(/-\d+$/, '');
    const params = new URLSearchParams({
      key: env.BRICKOWL_API_KEY,
      id,
      type: 'set',
      id_type: 'brickset',
    });
    const resp = await fetch(`https://api.brickowl.com/v1/catalog/lookup?${params}`, {
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) return null;
    const data = await resp.json() as Array<{ our_ean?: string }> | { our_ean?: string };
    const item = Array.isArray(data) ? data[0] : data;
    return item?.our_ean || null;
  } catch {
    return null;
  }
}
