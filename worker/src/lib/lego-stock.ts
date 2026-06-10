export interface LegoStockResult {
  in_stock: boolean | null;
  retiring_soon: boolean;
}

// Fetch LEGO.com product page and extract stock/retirement status.
// Returns null on fetch failure or if bot-protection blocks the request.
export async function checkLegoStock(setNum: string): Promise<LegoStockResult | null> {
  const num = setNum.replace(/-\d+$/, '');
  const url = `https://www.lego.com/en-us/product/${num}`;
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Brickvault/1.0)',
        Accept: 'text/html',
      },
      // Cloudflare may redirect/block — treat non-200 as unknown
      redirect: 'follow',
    });
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

    return { in_stock: inStock, retiring_soon: retiringSoon };
  } catch {
    return null;
  }
}
