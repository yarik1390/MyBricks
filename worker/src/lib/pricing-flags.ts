import type { Env } from '../types';
import { flagOverride, type FeatureFlag } from './feature-flags';

// Central capability switches for pricing/scraping sources. Each resolves in two
// layers:
//   1. runtime override — a DB-backed feature flag the admin console sets (wins
//      when present), so a capability can be toggled with NO code change/redeploy;
//   2. env default — the historical wrangler [vars]/secret behavior, used when no
//      override is set (preserves exactly the prior semantics).
// A required token/key is a separate PREREQUISITE: an override can express intent
// but can never conjure a missing secret, so those checks stay outside resolve().
function flagOn(value: unknown): boolean {
  return /^(1|true|yes|on)$/i.test(String(value ?? ''));
}
function flagOff(value: unknown): boolean {
  return /^(0|false|no|off)$/i.test(String(value ?? ''));
}

// Runtime override wins; otherwise fall back to the env-derived default.
function resolve(name: FeatureFlag, envDefaultOn: boolean): boolean {
  const o = flagOverride(name);
  return typeof o === 'boolean' ? o : envDefaultOn;
}

export function ebaySoldCompsEnabled(env: Env): boolean {
  // OFF by default; on after eBay Marketplace Insights approval (env "1" or override).
  return resolve('ebay_sold_comps', flagOn(env.EBAY_SOLD_COMPS_ENABLED));
}

export function brickOwlEnabled(env: Env): boolean {
  // OFF by default; on after a valid BRICKOWL_API_KEY (env "1" or override).
  return resolve('brickowl', flagOn(env.BRICKOWL_ENABLED));
}

// BrickInsights review ratings use a sanctioned, documented public API, so this
// source is ON by default; disable via a falsy BRICKINSIGHTS_ENABLED or override.
export function brickInsightsEnabled(env: Env): boolean {
  return resolve('brickinsights', !flagOff(env.BRICKINSIGHTS_ENABLED));
}

// eBay SOLD comps via Bright Data Web Unlocker (scraping). PREREQUISITE: at least
// one token in BRIGHTDATA_API_TOKEN or the comma-separated BRIGHTDATA_API_TOKENS
// pool. On by default once a token exists; pause via BRIGHTDATA_SOLD_ENABLED=0 or override.
export function brightDataSoldEnabled(env: Env): boolean {
  const hasToken = !!env.BRIGHTDATA_API_TOKEN?.trim()
    || !!env.BRIGHTDATA_API_TOKENS?.split(',').some((k) => k.trim());
  return hasToken && resolve('brightdata_sold', !flagOff(env.BRIGHTDATA_SOLD_ENABLED));
}

// Firecrawl web scraping. PREREQUISITE: FIRECRAWL_API_KEY or FIRECRAWL_API_KEYS.
// On by default once a key exists; pause via FIRECRAWL_ENABLED=0 or override.
export function firecrawlEnabled(env: Env): boolean {
  const hasKey =
    !!env.FIRECRAWL_API_KEY ||
    !!(env.FIRECRAWL_API_KEYS?.split(',').some((k) => k.trim()));
  return hasKey && resolve('firecrawl', !flagOff(env.FIRECRAWL_ENABLED));
}

// pricesAPI.io live retail/offers layer. PREREQUISITE: PRICESAPI_API_KEY or a
// non-empty PRICESAPI_API_KEYS entry. OFF by default — needs an explicit opt-in
// (PRICESAPI_ENABLED=1 or override), as each call is a precious ~30-90s cold request.
export function pricesapiEnabled(env: Env): boolean {
  const hasKey =
    !!env.PRICESAPI_API_KEY ||
    !!env.PRICESAPI_API_KEYS?.split(',').some((k) => k.trim());
  return hasKey && resolve('pricesapi', flagOn(env.PRICESAPI_ENABLED));
}
