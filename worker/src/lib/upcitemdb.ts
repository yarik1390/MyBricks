import type { Env } from '../types';

// UPCitemdb barcode lookup. Maps a LEGO set (number + name) to its retail UPC/EAN
// via keyword search, then filters to the GENUINE LEGO product — the search also
// returns third-party accessories (LED kits, display cases), so a match requires
// LEGO branding OR a LEGO GS1 prefix (UPC 673419… / EAN 5702016-7…) AND the set
// number in the title. That guarantees we never store an accessory's barcode.
//
// The trial endpoint needs no key but is heavily rate-limited (per-window
// EXCEED_LIMIT + ~100/day). A paid UPCITEMDB_USER_KEY switches to the v1 endpoint.

const LEGO_PFX = /^(673419|570201\d)/;

function digits(s: unknown): string {
  return String(s ?? '').replace(/\D/g, '');
}

// Choose the canonical LEGO barcode from a result row. Prefer a 12-digit 673419
// UPC-A (matches the scanner's UPC↔EAN normalisation), else a 5702016/7 EAN-13.
export function pickLegoBarcode(item: Record<string, unknown>): string | null {
  const upc = digits(item.upc);
  const ean = digits(item.ean);
  if (upc.startsWith('673419') && upc.length === 12) return upc;
  if (ean.startsWith('570201') && ean.length === 13) return ean;
  if (ean.startsWith('0673419') && ean.length === 13) return ean.slice(1); // UPC-A carried as EAN-13
  if (upc.startsWith('570201') && upc.length === 13) return upc;
  return null;
}

function matchLego(items: Array<Record<string, unknown>>, base: string): string | null {
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const numRe = new RegExp(`(^|\\D)${esc}(\\D|$)`);
  for (const it of items) {
    const brand = String(it.brand ?? '').trim();
    const title = String(it.title ?? '');
    const upc = digits(it.upc);
    const ean = digits(it.ean);
    const isLego = /^(the )?lego( group| system.*)?$/i.test(brand) || upc.startsWith('673419') || LEGO_PFX.test(ean);
    if (isLego && numRe.test(title)) {
      const bc = pickLegoBarcode(it);
      if (bc && LEGO_PFX.test(bc)) return bc;
    }
  }
  return null;
}

export interface UpcSearchResult {
  barcode: string | null;
  code: string;
}

// Codes that mean "stop calling for now" (rate/quota windows).
export const UPC_THROTTLE_CODES = new Set(['EXCEED_LIMIT', 'EXCEEDED', 'TOO_MANY', 'TOO_FAST']);

export async function searchUpcItemDb(env: Env, setNum: string, name: string): Promise<UpcSearchResult> {
  const base = setNum.replace(/-\d+$/, '');
  const q = encodeURIComponent(`LEGO ${base} ${name}`.trim());
  const key = env.UPCITEMDB_USER_KEY;
  const url = key
    ? `https://api.upcitemdb.com/prod/v1/search?s=${q}`
    : `https://api.upcitemdb.com/prod/trial/search?s=${q}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (key) {
    headers.user_key = key;
    headers.key_type = '3scale';
  }
  let resp: Response;
  try {
    resp = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  } catch {
    return { barcode: null, code: 'FETCH_ERR' };
  }
  if (!resp.ok) return { barcode: null, code: `HTTP_${resp.status}` };
  let data: { code?: string; items?: Array<Record<string, unknown>> };
  try {
    data = await resp.json();
  } catch {
    return { barcode: null, code: 'PARSE_ERR' };
  }
  const code = String(data.code ?? 'UNKNOWN');
  if (code !== 'OK') return { barcode: null, code };
  return { barcode: matchLego(data.items ?? [], base), code: 'OK' };
}
