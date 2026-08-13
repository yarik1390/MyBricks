import type { BrickEconomyScrape } from './brickeconomy-firecrawl';
import type { LegoStockResult } from './lego-stock';

export interface BricksetScrape {
  msrp_usd: number | null;
  launch_date: string | null;
  exit_date: string | null;
  theme_group: string | null;
  category: string | null;
  subtheme: string | null;
  age_min: number | null;
  age_max: number | null;
  packaging_type: string | null;
  instructions_count: number | null;
  additional_image_count: number | null;
  description: string | null;
  tags: string[] | null;
  rating: number | null;
  review_count: number | null;
  brickset_set_id: number | null;
  dimensions: string | null;
}

const decodeHtml = (value: string): string => value
  .replace(/&nbsp;/gi, ' ')
  .replace(/&pound;/gi, '£')
  .replace(/&euro;/gi, '€')
  .replace(/&amp;/gi, '&')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&quot;/gi, '"')
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

const text = (html: string): string => decodeHtml(html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')).trim();

const money = (value?: string | null): number | null => {
  if (!value) return null;
  const parsed = Number(value.replace(/[$£€,\s]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const finite = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function labelMoney(html: string, label: RegExp): number | null {
  const source = label.source;
  const patterns = [
    new RegExp(`(?:${source})[\\s\\S]{0,180}?\\$\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)`, 'i'),
    new RegExp(`(?:${source})[\\s\\S]{0,180}?([0-9][0-9,]*(?:\\.[0-9]{1,2})?)`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const value = money(match?.[1]);
    if (value != null) return value;
  }
  return null;
}

/** Parse stable BrickEconomy labels. Pricing-model sections are explicitly
 * scoped so the first New/Sealed model cannot be mistaken for the Used model. */
export function parseBrickEconomyHtml(html: string): BrickEconomyScrape | null {
  if (!html?.trim()) return null;
  const plain = text(html);
  if (/page (?:you requested )?could not be found|yikes[.!].*could not be found/i.test(plain)) return null;

  const modelsStart = plain.search(/Set Pricing Models/i);
  const models = modelsStart >= 0 ? plain.slice(modelsStart, modelsStart + 5000) : plain;
  const usedStart = models.search(/\bUsed\s+Machine Learning\/AI Model\b/i);
  const usedSection = usedStart >= 0 ? models.slice(usedStart, usedStart + 800) : '';
  const newSection = usedStart >= 0 ? models.slice(0, usedStart) : models;
  const result: BrickEconomyScrape = {
    retail_price_us: labelMoney(plain, /Retail price/i),
    current_value_new: labelMoney(plain, /Today(?:'|’)?s value|New\/Sealed[\s\S]{0,80}?Value\s*\(today\)|Current value/i),
    current_value_used: labelMoney(usedSection, /Value\s*\(today\)|Today(?:'|’)?s value/i),
    forecast_value_new_2_years: labelMoney(newSection, /Value\s*\(in 2 years\)|2 year forecast/i),
    forecast_value_new_5_years: labelMoney(plain, /5 year forecast|Value\s*\(in 5 years\)/i),
    rolling_growth_12months: null,
  };
  const growth = plain.match(/Rolling growth[\s\S]{0,100}?([+-]?\d+(?:\.\d+)?)\s*%/i);
  result.rolling_growth_12months = growth ? finite(growth[1]) : null;

  // JSON-LD Product offers is a deterministic fallback for current new value.
  if (result.current_value_new == null) {
    const offer = html.match(/"offers"\s*:\s*\{[\s\S]{0,500}?"price"\s*:\s*"?([0-9,.]+)"?/i);
    result.current_value_new = money(offer?.[1]);
  }
  return Object.values(result).some((value) => value != null) ? result : null;
}

function dtDdMap(html: string): Map<string, { html: string; value: string }> {
  const map = new Map<string, { html: string; value: string }>();
  const pattern = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
  for (const match of html.matchAll(pattern)) {
    map.set(text(match[1]).toLowerCase(), { html: match[2], value: text(match[2]) });
  }
  return map;
}

function dateIso(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2}|\d{4})$/);
  if (!match) return null;
  const months: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const month = months[match[2].toLowerCase()];
  if (month == null) return null;
  let year = Number(match[3]);
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  return `${year}-${String(month + 1).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

export function parseBricksetHtml(html: string): BricksetScrape | null {
  if (!html?.trim()) return null;
  const fields = dtDdMap(html);
  const get = (...labels: string[]) => labels.map((label) => fields.get(label)?.value).find(Boolean) ?? null;
  const getHtml = (...labels: string[]) => labels.map((label) => fields.get(label)?.html).find(Boolean) ?? '';
  const dates = (get('launch/exit') ?? '').split(/\s+-\s+/);
  const rrp = get('rrp') ?? '';
  const usd = rrp.match(/\$\s*([0-9][0-9,]*(?:\.\d{1,2})?)/);
  const age = get('age range') ?? '';
  const ageMatch = age.match(/(\d+)\s*(?:-|to)\s*(\d+)/i) ?? age.match(/(\d+)\s*\+/);
  const ratingText = get('rating') ?? '';
  const tagsHtml = getHtml('tags');
  const tags = [...tagsHtml.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => text(match[1])).filter((tag) => tag && !/^view tags/i.test(tag));
  const internalId = tagsHtml.match(/id=["']tags(\d+)["']/i)?.[1]
    ?? html.match(/id=["']tags(\d+)["']/i)?.[1];
  const description = get('description', 'notes');
  const result: BricksetScrape = {
    msrp_usd: money(usd?.[1]),
    launch_date: dateIso(dates[0] ?? ''),
    exit_date: dateIso(dates[1] ?? ''),
    theme_group: get('theme group'),
    category: get('category'),
    subtheme: get('subtheme'),
    age_min: ageMatch ? finite(ageMatch[1]) : null,
    age_max: ageMatch?.[2] ? finite(ageMatch[2]) : null,
    packaging_type: get('packaging'),
    instructions_count: finite((get('instructions') ?? '').match(/\d+/)?.[0]),
    additional_image_count: finite((get('additional images') ?? '').match(/\d+/)?.[0]),
    description,
    tags: tags.length ? tags : null,
    rating: finite(ratingText.match(/\d+(?:\.\d+)?/)?.[0]),
    review_count: finite(ratingText.match(/([0-9,]+)\s+(?:ratings|reviews)/i)?.[1]?.replace(/,/g, '')),
    brickset_set_id: finite(internalId),
    dimensions: get('dimensions', 'packaging size'),
  };
  return Object.values(result).some((value) => value != null) ? result : null;
}

function normalizeAvailability(raw: string): LegoStockResult {
  const status = raw.toUpperCase().replace(/[\s-]+/g, '_');
  if (/^(IN_STOCK|AVAILABLE|AVAILABLE_NOW)$/.test(status)) return { in_stock: true, retiring_soon: false, availability: 'in_stock', retail_price_usd: null };
  if (/PRE.?ORDER/.test(status)) return { in_stock: true, retiring_soon: false, availability: 'pre_order', retail_price_usd: null };
  if (/BACK.?ORDER/.test(status)) return { in_stock: true, retiring_soon: false, availability: 'back_order', retail_price_usd: null };
  if (/COMING.?SOON/.test(status)) return { in_stock: false, retiring_soon: false, availability: 'coming_soon', retail_price_usd: null };
  // Exact terminal states BEFORE the broad /RETIR/ match: a retired product is
  // sold out, not "retiring soon".
  if (/^(EOL|SOLD_OUT|DISCONTINUED|RETIRED)$/.test(status)) return { in_stock: false, retiring_soon: false, availability: 'sold_out', retail_price_usd: null };
  if (/RETIR/.test(status)) return { in_stock: false, retiring_soon: true, availability: 'retiring', retail_price_usd: null };
  if (/OUT.?OF.?STOCK|UNAVAILABLE/.test(status)) return { in_stock: false, retiring_soon: false, availability: 'out_of_stock', retail_price_usd: null };
  return { in_stock: null, retiring_soon: false, availability: null, retail_price_usd: null };
}

export function parseLegoStockHtml(html: string, hint?: string): LegoStockResult | null {
  if (!html?.trim()) return null;
  const target = hint?.replace(/-\d+$/, '');

  // 1) Structured product data first. LEGO pages embed JSON-LD Product blocks
  //    for the requested set AND (later in the document) recommendation /
  //    merchandising data for OTHER sets. Blindly taking the first global
  //    availabilityStatus or centAmount can persist another set's stock or
  //    price. Scope to the requested product when a hint is available; any
  //    ambiguity falls through to Firecrawl rather than guessing.
  const chosen = pickProductBlock(html, target);
  if (chosen) {
    const status = normalizeAvailability(availabilityOf(chosen));
    const price = priceOf(chosen);
    const result: LegoStockResult = {
      ...status,
      retiring_soon: status.retiring_soon || /retiring\s+soon|retirement\s+immin/i.test(html),
      retail_price_usd: price,
    };
    // A Product block that yielded nothing usable must NOT short-circuit the
    // fallback — the caller should go to Firecrawl rather than persist nulls.
    return result.in_stock != null || result.availability != null || result.retiring_soon || result.retail_price_usd != null
      ? result : null;
  }

  // 2) No (unambiguous) JSON-LD product data — fall back to the inline state
  //    JSON. LEGO pages still embed `"availabilityStatus"` and
  //    `{"centAmount":N,"currencyCode":"USD"}` for the target product; accept
  //    them ONLY when every occurrence agrees (duplicated state for the same
  //    product is common; two DIFFERENT values means another product's data is
  //    in the document and the result would be ambiguous).
  const statuses = [...html.matchAll(/"availabilityStatus"\s*:\s*"([^"]+)"/gi)].map((m) => m[1]);
  const schemaStatus = html.match(/schema\.org\/(InStock|OutOfStock|PreOrder|BackOrder|SoldOut|Discontinued)/i)?.[1];
  let raw: string | null = null;
  if (statuses.length) {
    const distinct = new Set(statuses.map((s) => s.toUpperCase()));
    if (distinct.size > 1) return null;
    raw = statuses[0];
  } else if (schemaStatus) {
    raw = schemaStatus;
  }
  const result = normalizeAvailability(raw ?? '');
  result.retiring_soon = result.retiring_soon || /retiring\s+soon|retirement\s+immin/i.test(html);
  if (result.retiring_soon && result.availability == null) result.availability = 'retiring';

  const cents = [...html.matchAll(/"centAmount"\s*:\s*(\d+)[\s\S]{0,80}?"currencyCode"\s*:\s*"USD"/gi)]
    .map((m) => Number(m[1]) / 100)
    .filter((value) => Number.isFinite(value) && value > 0);
  const reverseUsd = [...html.matchAll(/"currencyCode"\s*:\s*"USD"[\s\S]{0,80}?"centAmount"\s*:\s*(\d+)/gi)]
    .map((m) => Number(m[1]) / 100)
    .filter((value) => Number.isFinite(value) && value > 0);
  const usdPrices = [...new Set([...cents, ...reverseUsd])];
  if (usdPrices.length === 1) result.retail_price_usd = usdPrices[0];
  // Zero or several DIFFERENT USD prices → leave the price unset; the caller
  // falls through to Firecrawl rather than guessing.

  return result.in_stock != null || result.availability != null || result.retiring_soon || result.retail_price_usd != null
    ? result : null;
}

interface LdProduct {
  availability?: string;
  price?: string | number | null;
  currency?: string | null;
}

/** Parse JSON-LD blocks and pick the product for the requested set number.
 * Returns null when there is no structured data OR the page is ambiguous. */
function pickProductBlock(html: string, target?: string): LdProduct | null {
  const blocks: Array<{ text: string; product: LdProduct | null }> = [];
  for (const script of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed: unknown;
    try { parsed = JSON.parse(script[1]); } catch { continue; }
    const nodes = Array.isArray(parsed) ? parsed : [parsed];
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const graph = Array.isArray((node as any)['@graph']) ? (node as any)['@graph'] : [node];
      for (const item of graph) {
        if (!item || typeof item !== 'object') continue;
        const types = [((item as any)['@type'] ?? [])].flat().map(String);
        const isProduct = types.some((t) => /Product|^Offer$/i.test(t))
          || (item as any).sku || (item as any).gtin || (item as any).gtin13 || (item as any).offers;
        if (!isProduct) continue;
        const offers = (item as any).offers;
        const offer = Array.isArray(offers) ? offers[0] : offers;
        blocks.push({
          text: script[1],
          product: {
            availability: (offer?.availability ?? (item as any).availability ?? '').replace(/^https?:\/\/schema\.org\//i, '') || undefined,
            price: offer?.price ?? offer?.lowPrice ?? null,
            currency: offer?.priceCurrency ?? null,
          },
        });
      }
    }
  }
  if (!blocks.length) return null;
  if (target) {
    const scoped = blocks.filter((b) => new RegExp(
      `(?:/product/${escapeRe(target)}|"sku"\\s*:\\s*"${escapeRe(target)}"|"gtin1?3?"\\s*:\\s*"${escapeRe(target)}")`, 'i',
    ).test(b.text));
    if (scoped.length === 1) return scoped[0].product;
    if (scoped.length > 1) return null; // even the hint can't disambiguate
  }
  if (blocks.length === 1) return blocks[0].product;
  return null; // several products, none clearly the requested set
}

function availabilityOf(product: LdProduct): string {
  const raw = product.availability ?? '';
  const urlMatch = raw.match(/schema\.org\/(InStock|OutOfStock|PreOrder|BackOrder|SoldOut|Discontinued)/i);
  return urlMatch?.[1] ?? raw;
}

function priceOf(product: LdProduct): number | null {
  if (product.currency && !/USD/i.test(product.currency)) return null;
  const parsed = product.price == null ? null : Number(String(product.price).replace(/[$£€,\s]/g, ''));
  return Number.isFinite(parsed ?? NaN) && (parsed ?? 0) > 0 ? parsed : null;
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
