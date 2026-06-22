import { fetchWithRetry } from './http';

export interface LegoStockResult {
  in_stock: boolean | null;
  retiring_soon: boolean;
  // Normalized fine-grained status from the same page (already fetched, free):
  // in_stock | out_of_stock | pre_order | back_order | coming_soon | sold_out | retiring | null.
  availability: string | null;
}

// Fetch LEGO.com product page and extract stock/retirement status.
// Returns null on fetch failure or if bot-protection blocks the request.
export async function checkLegoStock(setNum: string): Promise<LegoStockResult | null> {
  const num = setNum.replace(/-\d+$/, '');
  const url = `https://www.lego.com/en-us/product/${num}`;
  try {
    // fetchWithRetry adds the hard timeout this previously lacked. retries:0 keeps
    // it a single polite attempt (LEGO.com bot-protection shouldn't be hammered).
    const resp = await fetchWithRetry(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Brickvault/1.0)',
        Accept: 'text/html',
      },
      // Cloudflare may redirect/block — treat non-200 as unknown
      redirect: 'follow',
    }, { retries: 0, timeoutMs: 8000 });
    if (!resp.ok) return null;

    const html = await resp.text();

    // "Retiring soon" banner text
    const retiringSoon = /retiring\s+soon/i.test(html)
      || /retirement\s+immin/i.test(html)
      || /"availabilityStatus"\s*:\s*"(?:RETIRING|RETIRING_SOON)"/i.test(html);

    // Availability — LEGO.com embeds availability in JSON-LD or inline JSON
    let inStock: boolean | null = null;
    const availMatch = html.match(/"availability"\s*:\s*"([^"]+)"/);
    if (availMatch) {
      const val = availMatch[1].toLowerCase();
      if (val.includes('instock') || val.includes('in_stock')) inStock = true;
      else if (val.includes('outofstock') || val.includes('out_of_stock') || val.includes('discontinued')) inStock = false;
    }
    // Fallback: add-to-cart button presence is a strong in-stock signal
    if (inStock === null && /add-to-cart|AddToCart/i.test(html)) inStock = true;

    // Fine-grained status (free — same HTML). LEGO exposes richer states than a
    // bare in/out boolean; surface them so buyers can time pre-orders/back-orders.
    const statusMatch = html.match(/"availabilityStatus"\s*:\s*"([^"]+)"/i);
    const rawStatus = (statusMatch?.[1] || availMatch?.[1] || '').toUpperCase();
    let availability: string | null = null;
    if (/PRE.?ORDER/.test(rawStatus)) availability = 'pre_order';
    else if (/BACK.?ORDER/.test(rawStatus)) availability = 'back_order';
    else if (/COMING.?SOON/.test(rawStatus)) availability = 'coming_soon';
    else if (retiringSoon) availability = 'retiring';
    else if (/SOLD.?OUT/.test(rawStatus)) availability = 'sold_out';
    else if (/OUT.?OF.?STOCK|DISCONTINUED/.test(rawStatus)) availability = 'out_of_stock';
    else if (/IN.?STOCK/.test(rawStatus)) availability = 'in_stock';
    else if (inStock === true) availability = 'in_stock';
    else if (inStock === false) availability = 'out_of_stock';

    return { in_stock: inStock, retiring_soon: retiringSoon, availability };
  } catch {
    return null;
  }
}
