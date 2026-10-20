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
function flagOff(value: unknown): boolean {
  return /^(0|false|no|off)$/i.test(String(value ?? ''));
}

// Runtime override wins; otherwise fall back to the env-derived default.
function resolve(name: FeatureFlag, envDefaultOn: boolean): boolean {
  const o = flagOverride(name);
  return typeof o === 'boolean' ? o : envDefaultOn;
}

// BrickInsights review ratings use a sanctioned, documented public API, so this
// source is ON by default; disable via a falsy BRICKINSIGHTS_ENABLED or override.
export function brickInsightsEnabled(env: Env): boolean {
  return resolve('brickinsights', !flagOff(env.BRICKINSIGHTS_ENABLED));
}

// Firecrawl web scraping. PREREQUISITE: FIRECRAWL_API_KEY or FIRECRAWL_API_KEYS.
// On by default once a key exists; pause via FIRECRAWL_ENABLED=0 or override.
export function firecrawlEnabled(env: Env): boolean {
  const hasKey =
    !!env.FIRECRAWL_API_KEY ||
    !!(env.FIRECRAWL_API_KEYS?.split(',').some((k) => k.trim()));
  return hasKey && resolve('firecrawl', !flagOff(env.FIRECRAWL_ENABLED));
}
