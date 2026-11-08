import type { Env } from '../types';
import { brightDataUnlock } from './brightdata';
import { backupScrape, backupScrapersAvailable } from './backup-scrapers';
import { brightDataEnabled } from './brightdata-keys';
import { sourceEnabled } from './source-config';
import { resolveRoute } from './llm-routing';
import { openAiCompatibleStep } from './llm-clients';
import { recordAiUsage } from './ai-usage';
import { recordIntegrationAttempt } from './integration-health';

// Bright Data fallback for the pages Firecrawl reads with structured
// extraction (store search results, LEGO.com coming-soon and offers pages).
// Firecrawl stays first (Iaroslav, 2026-10-27); when it can't serve a page we
// fetch the raw HTML through Bright Data and get the same JSON two ways:
//   1. harvestProducts: product objects already embedded in the page
//      (JSON-LD, Next.js/Apollo state, other inline JSON). Free and exact.
//   2. llmExtractJson: a small text model over the page text, for pages whose
//      data is plain prose (promotions) or not embedded as JSON.

export interface HarvestedProduct {
  title: string;
  price: number | null;
  in_stock: boolean | null;
  availability: string | null;
  url: string | null;
  code: string | null;
}

async function brightDataOn(env: Env): Promise<boolean> {
  return brightDataEnabled(env) && (await sourceEnabled(env, 'brightdata'));
}

/** True when a raw-HTML lane (Bright Data, Decodo or ZenRows) can fetch pages. */
export async function rawPageAvailable(env: Env): Promise<boolean> {
  return (await brightDataOn(env)) || (await backupScrapersAvailable(env));
}

/** Raw page HTML through Bright Data, then Decodo, then ZenRows, or null. */
export async function fetchRawPage(env: Env, url: string, timeoutMs = 30_000): Promise<string | null> {
  const html = (await brightDataOn(env)) ? await brightDataUnlock(url, env, { timeoutMs }) : null;
  return html ?? backupScrape(url, env, { timeoutMs });
}

const decode = (value: string): string => value
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&quot;/gi, '"')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

/** Visible page text (scripts, styles and tags removed), capped. */
export function pageText(html: string, max = 20_000): string {
  return decode(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
    .slice(0, max);
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[$,\s]/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** A USD price from the shapes stores and LEGO.com embed. */
function priceOf(node: Record<string, any>): number | null {
  const cents = (p: any): number | null => {
    if (!p || typeof p !== 'object') return null;
    if (p.currencyCode && p.currencyCode !== 'USD') return null;
    const c = num(p.centAmount);
    return c != null ? c / 100 : null;
  };
  const variant = node.variant ?? (Array.isArray(node.variants) ? node.variants[0] : null);
  const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers;
  const candidates: unknown[] = [
    cents(node.price),
    cents(variant?.price),
    node.priceInfo?.currentPrice?.price,
    node.priceInfo?.linePrice?.price,
    node.price?.current_retail,
    node.price?.currentRetail,
    node.current_retail,
    offer && (!offer.priceCurrency || offer.priceCurrency === 'USD') ? (offer.price ?? offer.lowPrice) : null,
    typeof node.price === 'object' && node.price ? (node.price.value ?? node.price.amount ?? node.price.price) : node.price,
    node.salePrice,
    node.currentPrice,
  ];
  for (const c of candidates) {
    const n = num(c);
    if (n != null && n < 100_000) return Math.round(n * 100) / 100;
  }
  return null;
}

function availabilityOf(node: Record<string, any>): string | null {
  const variant = node.variant ?? (Array.isArray(node.variants) ? node.variants[0] : null);
  const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers;
  const raw = node.availabilityStatus ?? node.availabilityStatusV2?.value ?? node.availabilityStatusV2?.display
    ?? node.availability ?? offer?.availability ?? variant?.attributes?.availabilityStatus
    ?? variant?.attributes?.availabilityText ?? node.availabilityText ?? node.fulfillment?.availability_status;
  return typeof raw === 'string' && raw.trim() ? raw.replace(/^https?:\/\/schema\.org\//i, '').trim().slice(0, 40) : null;
}

function inStockOf(availability: string | null): boolean | null {
  if (!availability) return null;
  const a = availability.toUpperCase().replace(/[\s_-]+/g, '');
  if (/OUTOFSTOCK|SOLDOUT|UNAVAILABLE|NOTAVAILABLE|DISCONTINUED|COMINGSOON|TEMPORARILY/.test(a)) return false;
  if (/INSTOCK|AVAILABLE|PREORDER|BACKORDER|LIMITED/.test(a)) return true;
  return null;
}

function absolute(url: unknown, base: string): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const u = new URL(url.trim(), base);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function* inlineJson(html: string): Generator<unknown> {
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const body = m[2].trim();
    if (!body) continue;
    if (body.startsWith('{') || body.startsWith('[')) {
      try { yield JSON.parse(body); continue; } catch { /* not JSON */ }
    }
    // window.__STATE__ = {...};
    const assign = body.match(/^[\w.$[\]'"]+\s*=\s*([[{][\s\S]*[\]}])\s*;?\s*$/);
    if (assign) {
      try { yield JSON.parse(assign[1]); } catch { /* not JSON */ }
    }
  }
}

/**
 * Product-like objects embedded in a page: anything with a name and either a
 * price or a product code. Callers apply their own identity checks (set
 * number, LEGO in the title, price plausibility), so loose recall is safe.
 */
export function harvestProducts(html: string, baseUrl: string): HarvestedProduct[] {
  const out = new Map<string, HarvestedProduct>();
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || depth > 40) return;
    if (Array.isArray(value)) { for (const v of value) visit(v, depth + 1); return; }
    const node = value as Record<string, any>;
    const titleRaw = node.name ?? node.title ?? node.productName ?? node.displayName;
    const title = typeof titleRaw === 'string' ? decode(titleRaw).replace(/\s+/g, ' ').trim() : '';
    if (title && title.length <= 300) {
      const price = priceOf(node);
      const codeRaw = node.productCode ?? node.sku ?? node.productNumber ?? node.mpn;
      const code = typeof codeRaw === 'string' || typeof codeRaw === 'number' ? String(codeRaw).trim() || null : null;
      if (price != null || code) {
        const availability = availabilityOf(node);
        const url = absolute(node.canonicalUrl ?? node.url ?? node.productUrl ?? node.slug, baseUrl);
        const product: HarvestedProduct = { title, price, in_stock: inStockOf(availability), availability, url, code };
        const key = `${title}|${price ?? ''}|${code ?? ''}`;
        const prev = out.get(key);
        // Keep the richer duplicate (state and JSON-LD often repeat a product).
        if (!prev || (!prev.url && url) || (!prev.availability && availability)) out.set(key, product);
      }
    }
    for (const v of Object.values(node)) visit(v, depth + 1);
  };
  for (const json of inlineJson(html)) visit(json, 0);
  return [...out.values()];
}

/**
 * Ask a text model to pull JSON out of page text. Uses the listing route's
 * OpenAI-compatible steps (Gemini has its own wire format and is skipped).
 * Returns the parsed object, or null when no step answered with JSON.
 */
export async function llmExtractJson<T = Record<string, unknown>>(
  env: Env,
  text: string,
  instruction: string,
  schema: unknown,
): Promise<T | null> {
  if (!text.trim()) return null;
  const steps = (await resolveRoute(env, 'listing')).filter((s) => s.provider !== 'gemini');
  for (const step of steps) {
    try {
      const { client, models } = await openAiCompatibleStep(env, step, {}, 'text');
      if (!client) continue;
      for (const model of models.slice(0, 2)) {
        const res = await client.chat.completions.create({
          model,
          max_tokens: 2000,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'You extract data from web page text. Reply with one JSON object only. Never invent values that are not in the text.' },
            { role: 'user', content: `${instruction}\n\nJSON schema:\n${JSON.stringify(schema)}\n\nPage text:\n${text}` },
          ],
        }, { timeout: 30_000 });
        await recordAiUsage(env, step.provider, model, res.usage ?? null, null);
        const content = res.choices[0]?.message?.content ?? '';
        try {
          const parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''));
          if (parsed && typeof parsed === 'object') {
            await recordIntegrationAttempt(env, step.provider, true);
            return parsed as T;
          }
        } catch { /* try the next model */ }
      }
    } catch (e) {
      await recordIntegrationAttempt(env, step.provider, false, e);
    }
  }
  return null;
}
