import type { Env } from '../types';

// Central kill-switches for pricing sources that currently lack provider
// access. They are OFF unless the matching env var is truthy, so production
// is disabled by default and re-enabling is a wrangler [vars] entry (or
// secret) — no code change or redeploy of source needed:
//   EBAY_SOLD_COMPS_ENABLED = "1"   (after eBay Marketplace Insights approval)
//   BRICKOWL_ENABLED        = "1"   (after a valid BRICKOWL_API_KEY is set)
// The basic-scope eBay Browse *ask* path is independent and always on.
function flagOn(value: unknown): boolean {
  return /^(1|true|yes|on)$/i.test(String(value ?? ''));
}

export function ebaySoldCompsEnabled(env: Env): boolean {
  return flagOn(env.EBAY_SOLD_COMPS_ENABLED);
}

export function brickOwlEnabled(env: Env): boolean {
  return flagOn(env.BRICKOWL_ENABLED);
}

// BrickInsights review ratings use a sanctioned, documented public API, so
// this source is ON by default; set BRICKINSIGHTS_ENABLED to a falsy value
// (0/false/no/off) to disable it.
export function brickInsightsEnabled(env: Env): boolean {
  return !/^(0|false|no|off)$/i.test(String(env.BRICKINSIGHTS_ENABLED ?? ''));
}

// eBay SOLD comps via Bright Data Web Unlocker (scraping). Requires at least one
// token in BRIGHTDATA_API_TOKEN or the comma-separated BRIGHTDATA_API_TOKENS pool;
// on by default once set. Set BRIGHTDATA_SOLD_ENABLED to a falsy value to pause.
export function brightDataSoldEnabled(env: Env): boolean {
  const hasToken = !!env.BRIGHTDATA_API_TOKEN?.trim()
    || !!env.BRIGHTDATA_API_TOKENS?.split(',').some((k) => k.trim());
  return hasToken && !/^(0|false|no|off)$/i.test(String(env.BRIGHTDATA_SOLD_ENABLED ?? ''));
}

// Firecrawl web scraping (lego.com stock, eBay sold comps via structured extraction,
// Brickset enrichment backfill). Requires FIRECRAWL_API_KEY or FIRECRAWL_API_KEYS;
// on by default once at least one key is set. Set FIRECRAWL_ENABLED=0 to pause.
export function firecrawlEnabled(env: Env): boolean {
  const hasKey =
    !!env.FIRECRAWL_API_KEY ||
    !!(env.FIRECRAWL_API_KEYS?.split(',').some((k) => k.trim()));
  return hasKey && !/^(0|false|no|off)$/i.test(String(env.FIRECRAWL_ENABLED ?? ''));
}

// pricesAPI.io live retail/offers layer. Requires at least one key (PRICESAPI_API_KEY
// or a non-empty PRICESAPI_API_KEYS entry) AND an explicit PRICESAPI_ENABLED opt-in,
// because each call is a precious 30–90s cold request against a ~1000/month budget.
export function pricesapiEnabled(env: Env): boolean {
  const hasKey =
    !!env.PRICESAPI_API_KEY ||
    !!env.PRICESAPI_API_KEYS?.split(',').some((k) => k.trim());
  return hasKey && /^(1|true|yes|on)$/i.test(String(env.PRICESAPI_ENABLED ?? ''));
}
