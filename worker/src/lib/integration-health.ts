import type { Env } from '../types';
import { hasPricesApiKey } from './pricesapi-keys';

// Services whose configuration and recent outcomes are visible in the admin
// diagnostics panel. The stored table is intentionally aggregate-only.
export type IntegrationName =
  | 'd1'
  | 'supabase'
  | 'google'
  | 'ebay'
  | 'bricklink'
  | 'brickeconomy'
  | 'brickset'
  | 'brickowl'
  | 'gemini'
  | 'email'
  | 'push'
  | 'firebase'
  | 'openai'
  | 'openrouter'
  | 'omniroute'
  | 'merge'
  | 'pateway'
  | 'rebrickable'
  | 'brickinsights'
  | 'upcitemdb'
  | 'firecrawl'
  | 'scrapingant'
  | 'brightdata'
  | 'pricecharting'
  | 'pricesapi'
  | 'amazon'
  | 'stockx';

export type IntegrationStatus = 'ok' | 'degraded' | 'down' | 'unknown' | 'unconfigured';

export interface IntegrationTally {
  ok: number;
  fail: number;
  lastError?: string | null;
}

export interface IntegrationHealthRow {
  service: string;
  last_ok_at: string | null;
  last_fail_at: string | null;
  last_error: string | null;
  ok_count: number;
  fail_count: number;
  updated_at: string | null;
  status?: 'ok' | 'degraded' | 'down';
}

export interface IntegrationDiagnostic {
  service: IntegrationName;
  label: string;
  configured: boolean;
  reachable: boolean | null;
  degraded: boolean;
  status: IntegrationStatus;
  used_by: string[];
  required_secrets: string[];
  missing_secrets: string[];
  notes: string;
  recommended_action: string;
  last_checked_at: string | null;
  last_ok_at: string | null;
  last_fail_at: string | null;
  last_error: string | null;
  ok_count: number;
  fail_count: number;
  updated_at: string | null;
}

type IntegrationDefinition = {
  label: string;
  configured: (env: Env) => boolean;
  required_secrets: string[];
  used_by: string[];
  notes: string;
  recommended_action?: string;
};

const hasRealGoogleConfig = (env: Env) => !!(
  env.GOOGLE_CLIENT_ID &&
  env.GOOGLE_CLIENT_SECRET &&
  !env.GOOGLE_CLIENT_ID.includes('dummy') &&
  !env.GOOGLE_CLIENT_SECRET.includes('dummy')
);

const hasFirebaseConfig = (env: Env) => {
  try {
    const value = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
    return !!(value.project_id && value.client_email && value.private_key);
  } catch { return false; }
};

export const INTEGRATION_DEFINITIONS: Record<IntegrationName, IntegrationDefinition> = {
  d1: {
    label: 'Cloudflare D1',
    configured: (env) => !!env.DB,
    required_secrets: ['DB'],
    used_by: ['catalog', 'portfolio', 'wishlist', 'admin'],
    notes: 'Primary database binding.',
    recommended_action: 'Bind the Cloudflare D1 database as DB before deploying.',
  },
  supabase: {
    label: 'Supabase Auth',
    configured: (env) => !!(env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.SUPABASE_JWT_SECRET),
    required_secrets: ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_JWT_SECRET'],
    used_by: ['sign in', 'member sync', 'admin access'],
    notes: 'Authentication and member identity.',
    recommended_action: 'Add Supabase URL, anon key, and JWT secret as Worker secrets.',
  },
  google: {
    label: 'Google Sheets',
    configured: hasRealGoogleConfig,
    required_secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    used_by: ['collection sync', 'wishlist sync'],
    notes: 'Optional spreadsheet sync. Requires OAuth credentials.',
    recommended_action: 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET as GitHub Actions secrets; the deploy workflow uploads them to Worker secrets.',
  },
  ebay: {
    label: 'eBay',
    configured: (env) => !!(
      env.EBAY_APP_ID &&
      env.EBAY_CLIENT_SECRET &&
      !env.EBAY_APP_ID.includes('dummy') &&
      !env.EBAY_CLIENT_SECRET.includes('dummy')
    ),
    required_secrets: ['EBAY_APP_ID', 'EBAY_CLIENT_SECRET'],
    used_by: ['sold-price checks', 'deal score', 'listing draft'],
    notes: 'Uses eBay Browse active-listing ASK prices (basic OAuth scope, works on any keyset). Sold comps (Marketplace Insights) are disabled pending Buy-API approval.',
    recommended_action: 'Add EBAY_APP_ID and EBAY_CLIENT_SECRET for ask-price enrichment. Sold comps stay off until Marketplace Insights (Buy) approval is granted and EBAY_SOLD_COMPS_ENABLED is set.',
  },
  bricklink: {
    label: 'BrickLink',
    configured: (env) => !!(
      env.BRICKLINK_CONSUMER_KEY &&
      env.BRICKLINK_CONSUMER_SECRET &&
      env.BRICKLINK_TOKEN &&
      env.BRICKLINK_TOKEN_SECRET
    ),
    required_secrets: ['BRICKLINK_CONSUMER_KEY', 'BRICKLINK_CONSUMER_SECRET', 'BRICKLINK_TOKEN', 'BRICKLINK_TOKEN_SECRET'],
    used_by: ['new/used market prices', 'minifig values'],
    notes: 'Requires OAuth credentials and enough sold lots for confident values.',
    recommended_action: 'Add the full BrickLink OAuth credential set and rerun valuation batches.',
  },
  brickeconomy: {
    label: 'BrickEconomy',
    // Now sourced by scraping the public BrickEconomy pages via Firecrawl (the
    // be_* columns), not the paid API — so it's "configured" whenever Firecrawl
    // (or the legacy API key) is present.
    configured: (env) => !!env.FIRECRAWL_API_KEY || !!env.BRICKECONOMY_API_KEY,
    required_secrets: ['FIRECRAWL_API_KEY'],
    used_by: ['set valuation (sealed/used)', 'forecasts (2y/5y)', 'retail price enrichment'],
    notes: 'Valuation + forecast source. Now scraped from public BrickEconomy pages via Firecrawl (be_* columns) under the isPlausibleMarketValue gate — the paid BRICKECONOMY_API_KEY is no longer required. Status reflects BrickEconomy data flowing into valuations.',
    recommended_action: 'No key required — BrickEconomy data comes via the Firecrawl brickeconomy-enrich cron. The legacy BRICKECONOMY_API_KEY can be retired.',
  },
  brickset: {
    label: 'Brickset',
    configured: (env) => !!env.BRICKSET_API_KEY,
    required_secrets: ['BRICKSET_API_KEY'],
    used_by: ['catalog details', 'UPC/barcode backfill'],
    notes: 'Adds metadata, community data, and barcode coverage.',
    recommended_action: 'Add BRICKSET_API_KEY and rerun barcode backfill.',
  },
  brickowl: {
    label: 'BrickOwl',
    configured: (env) => !!env.BRICKOWL_API_KEY,
    required_secrets: ['BRICKOWL_API_KEY'],
    used_by: ['barcode fallback'],
    notes: 'Disabled pending a valid API key (current key returns HTTP 403). Provides barcode + pricing fallback when enabled.',
    recommended_action: 'BrickOwl is disabled. Add a valid BRICKOWL_API_KEY and set BRICKOWL_ENABLED to re-enable.',
  },
  gemini: {
    label: 'Gemini',
    configured: (env) => hasConfiguredSecret(env, 'GEMINI_API_KEY'),
    required_secrets: ['GEMINI_API_KEY'],
    used_by: ['server valuation fallback', 'BYOK photo scan', 'BYOK advisor'],
    notes: 'Server key is optional; user-supplied BYOK Gemini keys still work from the browser.',
    recommended_action: 'Add GEMINI_API_KEY as a GitHub Actions secret to enable server-side Gemini fallback.',
  },
  email: {
    label: 'Email Alerts',
    configured: (env) => hasConfiguredSecret(env, 'RESEND_API_KEY'),
    required_secrets: ['RESEND_API_KEY'],
    used_by: ['wishlist alerts', 'price drop notifications'],
    notes: 'Optional transactional email for alerts.',
    recommended_action: 'Add RESEND_API_KEY as a GitHub Actions secret to enable email wishlist alerts.',
  },
  push: {
    label: 'Browser Push',
    configured: (env) => ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']
      .every(name => hasConfiguredSecret(env, name)),
    required_secrets: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'],
    used_by: ['wishlist alerts', 'browser notifications'],
    notes: 'Optional Web Push notifications. Requires a VAPID keypair and subject.',
    recommended_action: 'Add VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT as GitHub Actions secrets to enable browser push alerts.',
  },
  firebase: {
    label: 'Native Push',
    configured: hasFirebaseConfig,
    required_secrets: ['FIREBASE_SERVICE_ACCOUNT_JSON'],
    used_by: ['Android wishlist alerts', 'native price notifications'],
    notes: 'Firebase Cloud Messaging delivery for installed Android devices.',
    recommended_action: 'Add FIREBASE_SERVICE_ACCOUNT_JSON as a Worker secret and google-services.json to the Android build.',
  },
  openai: {
    label: 'OpenAI',
    configured: (env) => !!env.OPENAI_API_KEY,
    required_secrets: ['OPENAI_API_KEY'],
    used_by: ['photo scan', 'advisor', 'listing draft', 'valuation fallback'],
    notes: 'Server key is rate-limited; users can bring their own key for scans, advisor, and listing drafts.',
    recommended_action: 'Add OPENAI_API_KEY for shared scan, advisor, listing, and fallback valuation features.',
  },
  openrouter: {
    label: 'OpenRouter',
    configured: (env) => !!env.OPENROUTER_API_KEY,
    required_secrets: ['OPENROUTER_API_KEY'],
    used_by: ['valuation fallback'],
    notes: 'Cheap valuation fallback routed through the AI Gateway: a free model first, then cheap paid (DeepSeek), then gpt-4o-mini. Valuation only — public set metadata, no user data.',
    recommended_action: 'Add OPENROUTER_API_KEY (and the AI Gateway) to enable the free-first, low-cost valuation fallback.',
  },
  omniroute: {
    label: 'OmniRoute',
    configured: (env) => !!(env.OMNIROUTE_API_KEY ?? '').trim(),
    required_secrets: ['OMNIROUTE_API_KEY'],
    used_by: ['scan primary'],
    notes: 'Subscription-backed OpenAI-compatible gateway. Scans pin the benchmarked Antigravity Gemini route, bypass response caching, and reject silent provider/model changes.',
    recommended_action: 'Add OMNIROUTE_API_KEY as a Worker secret and monitor Google subscription quotas and cooldowns.',
  },
  merge: {
    label: 'Merge Gateway',
    configured: (env) => !!(env.MERGE_GATEWAY_API_KEY ?? '').trim(),
    required_secrets: ['MERGE_GATEWAY_API_KEY'],
    used_by: ['scan', 'advisor', 'valuation', 'listing'],
    notes: 'Second multi-provider LLM gateway alongside OpenRouter, OpenAI-compatible at /v1/openai. Billed against a fixed monthly allowance and reports real per-call cost (usage.cost), so its spend in the ai_usage ledger is measured rather than estimated. Where each workload tries it is admin-tunable under LLM routing.',
    recommended_action: 'Add MERGE_GATEWAY_API_KEY (mg_...) from gateway.merge.dev, then set a HARD budget there so an exhausted allowance answers 402 instead of overspending.',
  },
  pateway: {
    label: 'Pateway Economy',
    configured: (env) => !!(env.PATEWAY_ECONOMY_API_KEY ?? '').trim(),
    required_secrets: ['PATEWAY_ECONOMY_API_KEY'],
    used_by: ['background single-set scan verification'],
    notes: 'Economy-key-bound GPT-5.6 Luna verification runs after the scan response. It records agreement telemetry only and never changes the synchronous result.',
    recommended_action: 'Add a rotated Economy-mode PATEWAY_ECONOMY_API_KEY Worker secret. Do not use a Default-mode key or add Pateway to the synchronous cascade.',
  },
  rebrickable: {
    label: 'Rebrickable',
    configured: (env) => !!env.REBRICKABLE_API_KEY,
    required_secrets: ['REBRICKABLE_API_KEY'],
    used_by: ['catalog import', 'search fallback', 'CSV import fallback'],
    notes: 'Catalog source for sets, themes, minifigs, and images.',
    recommended_action: 'Add REBRICKABLE_API_KEY and rerun the catalog import.',
  },
  brickinsights: {
    label: 'BrickInsights',
    configured: () => true,
    required_secrets: [],
    used_by: ['set review ratings'],
    notes: 'Aggregated LEGO set review score (0-100) from the BrickInsights public API. No key required.',
    recommended_action: 'No action required; set BRICKINSIGHTS_ENABLED=0 to disable.',
  },
  stockx: {
    label: 'StockX (lowest ask)',
    configured: (env) => !!env.FIRECRAWL_API_KEY?.trim() || !!env.FIRECRAWL_API_KEYS?.split(',').some((k) => k.trim()),
    required_secrets: ['FIRECRAWL_API_KEY'],
    used_by: ['StockX lowest-ask (scraped, corroborating new-condition signal)'],
    notes: 'Rendered Firecrawl (enhanced proxy) scrape of StockX search for a set\'s lowest ask — a corroborating ceiling, never a sold comp. OFF by default (STOCKX_ENABLED=1 or the admin stockx flag); a slow ~30-45s call, so it runs only from the background cron.',
    recommended_action: 'Validate via the admin StockX probe, then set STOCKX_ENABLED=1 (or flip the stockx flag) to start the enrichment cron.',
  },
  upcitemdb: {
    label: 'UPCitemdb (barcodes)',
    configured: (env) => !/^(0|false|no|off)$/i.test(String(env.UPCITEMDB_ENABLED ?? '1')),
    required_secrets: [],
    used_by: ['Barcode/UPC backfill (2nd source after Brickset)'],
    notes: 'Keyword search -> validated LEGO barcode (GS1 prefix + set number in title). A small cron trickles missing modern retail sets. Trial is rate-limited (~100/day + per-window throttle).',
    recommended_action: 'Trial active (no key needed). Add UPCITEMDB_USER_KEY for the higher-limit v1 endpoint.',
  },
  firecrawl: {
    label: 'Firecrawl',
    configured: (env) => !!env.FIRECRAWL_API_KEY,
    required_secrets: ['FIRECRAWL_API_KEY'],
    used_by: ['BrickEconomy valuation + forecasts', 'lego.com stock/retirement checks', 'eBay sold comps (structured extraction)', 'Brickset page enrichment'],
    notes: 'Web-scraping engine (handles JS rendering + bot-protection). Now the BrickEconomy data source (replaces the paid API), plus lego.com stock, eBay sold comps, and Brickset enrichment. Metered in CREDITS: 1 per basic/product scrape, 5 per JSON LLM extract. Daily ceiling is env-tunable via FIRECRAWL_DAILY_CREDITS (default 2000/day).',
    recommended_action: 'Add FIRECRAWL_API_KEY as a Worker/Actions secret. Raise FIRECRAWL_DAILY_CREDITS temporarily for the one-time catalog bootstrap, then reset.',
  },
  scrapingant: {
    label: 'ScrapingAnt',
    configured: (env) => !!env.SCRAPINGANT_API_KEY?.trim(),
    required_secrets: ['SCRAPINGANT_API_KEY'],
    used_by: ['BrickEconomy valuation + forecasts', 'Brickset page enrichment', 'lego.com stock/retirement checks'],
    notes: 'First-choice raw-HTML lane for plain pages only. The client enforces browser=false, datacenter proxying, bounded timeouts, and a fail-closed 250-credit daily cap. It is never used for eBay.',
    recommended_action: 'Add SCRAPINGANT_API_KEY as a Cloudflare Worker secret. Keep the source daily cap at or below 250 for the free 10k-credit monthly plan.',
  },
  brightdata: {
    label: 'Bright Data Web Unlocker',
    configured: (env) => !!env.BRIGHTDATA_API_TOKEN?.trim()
      || !!env.BRIGHTDATA_API_TOKENS?.split(',').some((token) => token.trim()),
    required_secrets: ['BRIGHTDATA_API_TOKENS'],
    used_by: ['BrickEconomy valuation + forecasts', 'Brickset page enrichment', 'lego.com stock/retirement checks'],
    notes: 'Primary raw-HTML lane with deterministic parsers. Tokens rotate by least monthly usage; D1 stores hashes only and caps each token at 4,900 calls/month. Firecrawl remains the rich fallback.',
    recommended_action: 'Configure BRIGHTDATA_API_TOKENS as comma-separated Worker secrets and optionally BRIGHTDATA_ZONE.',
  },
  pricecharting: {
    label: 'PriceCharting',
    configured: (env) => !!env.PRICECHARTING_TOKEN,
    required_secrets: ['PRICECHARTING_TOKEN'],
    used_by: ['set valuation (sealed/complete/loose sold comps)', 'liquidity (sales-volume)'],
    notes: 'Aggregated eBay closed-auction comps (sealed/complete/loose + yearly sales volume) — the sold-comp replacement for eBay\'s retired Marketplace Insights API. VERIFIED-ONLY: signals flow solely from pricing_source_map rows proven by unique UPC (weekly bulk CSV) or cross-source price agreement (daily pricecharting-verify); unverified mappings stay quarantined. Collapses into the ebay_market family. The bulk CSV needs the Legendary tier (PRICECHARTING_PRO).',
    recommended_action: 'Add PRICECHARTING_TOKEN as a Worker secret; set PRICECHARTING_PRO=1 on the Legendary tier so the weekly bulk CSV refreshes the whole catalog in one download.',
  },
  pricesapi: {
    label: 'pricesAPI.io',
    configured: (env) => hasPricesApiKey(env) && /^(1|true|yes|on)$/i.test(String(env.PRICESAPI_ENABLED ?? '')),
    required_secrets: ['PRICESAPI_API_KEYS'],
    used_by: ['deal signal (cheapest channel)', 'in-stock truth', 'wishlist price-drop alerts'],
    notes: 'Live retail + marketplace offers across major retailers (47 markets). NOT a value anchor — feeds the deal/buy signal and stock truth. Synchronous cold calls take 30–90s so it runs cron-only. Free tier = 1000 calls/month, 6/min PER KEY; comma-separated keys are pooled with per-key monthly budgets (pricesapi_keys table).',
    recommended_action: 'Add one or more keys to PRICESAPI_API_KEYS (comma-separated) and set PRICESAPI_ENABLED=1. Add more keys to grow the pooled monthly budget.',
  },
  amazon: {
    label: 'Amazon Creators API',
    configured: (env) => !!(env.AMAZON_CREATORS_PUBLIC_KEY && env.AMAZON_CREATORS_PRIVATE_KEY
      && /^(1|true|yes|on)$/i.test(String(env.AMAZON_CREATORS_ENABLED ?? ''))),
    required_secrets: ['AMAZON_CREATORS_PUBLIC_KEY', 'AMAZON_CREATORS_PRIVATE_KEY'],
    used_by: ['live acquisition price (buy slot)', 'affiliate links'],
    notes: 'Live Amazon offers for current sets. COMPLIANCE: offers are KV-cached <= 24h and never persisted or used as a valuation input (Associates terms). Access needs an approved Associates account with >= 10 qualifying sales in the trailing 30 days; below that Amazon suspends credentials and calls 403.',
    recommended_action: 'Once the Associates account qualifies (10 sales/30 days), create Creators API credentials in Associates Central, add them as AMAZON_CREATORS_PUBLIC_KEY / AMAZON_CREATORS_PRIVATE_KEY, and set AMAZON_CREATORS_ENABLED=1.',
  },
};

function hasConfiguredSecret(env: Env, name: string): boolean {
  const value = env[name as keyof Env];
  if (typeof value === 'string') return value.trim() !== '' && !value.includes('dummy');
  return !!value;
}

function missingSecrets(env: Env, names: string[]): string[] {
  return names.filter(name => !hasConfiguredSecret(env, name));
}

function isCredentialOrAccessIssue(error?: string | null): boolean {
  return !!error && /(HTTP 401|HTTP 403|invalid[_ -]?client|invalid[_ -]?scope|access denied|insufficient permissions|not authorized|unauthorized|marketplace insights access)/i.test(error);
}

function isWorkerCapacityIssue(error?: string | null): boolean {
  return !!error && /(Too many subrequests|operation was aborted|AbortError|timed out|timeout)/i.test(error);
}

// A quota / rate-limit refusal, as opposed to a credential problem. Worth
// distinguishing because the generic "refresh credentials" advice is actively
// harmful here: rotating a throttled-but-healthy key throws away whatever
// balance is left on it. Firecrawl (HTTP 429 per-minute ceiling), Gemini (free
// tier 429) and UPCitemdb (EXCEED_LIMIT) all land in this bucket.
function isQuotaIssue(error?: string | null): boolean {
  return !!error && /(HTTP 429|EXCEED_LIMIT|rate limit|quota|too many requests|daily cap)/i.test(error);
}

// A failure on the PROVIDER's side — 5xx, an unavailable upstream, or a page
// that came back empty. There is nothing to fix locally, so the credential
// advice is just as misleading here as it is for a quota refusal: Bright Data
// (HTTP 502), pricesAPI (scraper unavailable HTTP 503) and StockX (empty/short
// body) were all telling the admin to go rotate working keys.
function isProviderOutage(error?: string | null): boolean {
  return !!error && /(HTTP 5\d\d|unavailable|bad gateway|service unavailable|gateway timeout|empty\/short body|empty body)/i.test(error);
}

export function classifyHealth(row: IntegrationHealthRow): 'ok' | 'degraded' | 'down' {
  const okAt = row.last_ok_at ? Date.parse(row.last_ok_at) : 0;
  const failAt = row.last_fail_at ? Date.parse(row.last_fail_at) : 0;
  if (failAt && failAt >= okAt) {
    // Credential/access problems always need a human → keep flagged as degraded.
    if (isCredentialOrAccessIssue(row.last_error)) return 'degraded';
    // Transient worker-capacity blips (timeouts, aborts, "too many subrequests")
    // are common for scrapers under load. If the provider ALSO succeeded within a
    // day of this failure, it's flapping — not down — so it shouldn't stick on
    // "degraded". Without any nearby success, treat it as degraded.
    if (isWorkerCapacityIssue(row.last_error)) {
      const recentSuccess = !!okAt && failAt - okAt < 24 * 60 * 60 * 1000;
      return recentSuccess ? 'ok' : 'degraded';
    }
    return 'down';
  }
  if (okAt && okAt > failAt) return 'ok';
  const total = (row.ok_count || 0) + (row.fail_count || 0);
  if (total > 0 && row.fail_count / total >= 0.25) return 'degraded';
  return 'ok';
}

export async function recordIntegrationHealth(
  env: Env,
  service: IntegrationName,
  tally: IntegrationTally,
): Promise<void> {
  const ok = Math.max(0, tally.ok | 0);
  const fail = Math.max(0, tally.fail | 0);
  if (ok === 0 && fail === 0) return;
  const err = fail > 0 ? (tally.lastError ?? 'unknown error')?.slice(0, 300) : null;
  try {
    await env.DB.prepare(`
      INSERT INTO integration_health (service, last_ok_at, last_fail_at, last_error, ok_count, fail_count, updated_at)
      VALUES (
        ?1,
        CASE WHEN ?2 > 0 THEN datetime('now') END,
        CASE WHEN ?3 > 0 THEN datetime('now') END,
        ?4, ?2, ?3, datetime('now')
      )
      ON CONFLICT(service) DO UPDATE SET
        last_ok_at  = CASE WHEN ?2 > 0 THEN datetime('now') ELSE integration_health.last_ok_at END,
        last_fail_at = CASE WHEN ?3 > 0 THEN datetime('now') ELSE integration_health.last_fail_at END,
        last_error  = CASE WHEN ?3 > 0 THEN ?4 ELSE integration_health.last_error END,
        ok_count    = integration_health.ok_count + ?2,
        fail_count  = integration_health.fail_count + ?3,
        updated_at  = datetime('now')
    `).bind(service, ok, fail, err).run();
  } catch (e) {
    console.warn('[integration-health] record failed:', (e as Error).message);
  }
}

export async function recordIntegrationAttempt(
  env: Env,
  service: IntegrationName,
  ok: boolean,
  error?: unknown,
): Promise<void> {
  await recordIntegrationHealth(env, service, {
    ok: ok ? 1 : 0,
    fail: ok ? 0 : 1,
    lastError: ok ? null : integrationErrorMessage(error),
  });
}

export function integrationErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error || 'unknown error');
}

// --- Circuit breaker -------------------------------------------------------
// Access-denied failures (e.g. eBay Marketplace Insights approval revoked)
// will fail every call until a human intervenes. Persisting a blocked-until
// timestamp lets every batch skip the service instead of re-probing it on
// each invocation, with an automatic re-probe once the window expires.

export async function setIntegrationBlock(
  env: Env,
  service: IntegrationName,
  hours = 6,
): Promise<void> {
  try {
    await env.DB.prepare(`
      INSERT INTO integration_health (service, blocked_until, updated_at)
      VALUES (?1, datetime('now', '+' || ?2 || ' hours'), datetime('now'))
      ON CONFLICT(service) DO UPDATE SET
        blocked_until = datetime('now', '+' || ?2 || ' hours'),
        updated_at = datetime('now')
    `).bind(service, Math.max(1, hours | 0)).run();
  } catch (e) {
    console.warn('[integration-health] set block failed:', (e as Error).message);
  }
}

export async function clearIntegrationBlock(env: Env, service: IntegrationName): Promise<void> {
  try {
    await env.DB.prepare(
      `UPDATE integration_health SET blocked_until=NULL, updated_at=datetime('now')
       WHERE service=? AND blocked_until IS NOT NULL`
    ).bind(service).run();
  } catch (e) {
    console.warn('[integration-health] clear block failed:', (e as Error).message);
  }
}

export async function isIntegrationBlocked(env: Env, service: IntegrationName): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      `SELECT 1 AS blocked FROM integration_health WHERE service=? AND blocked_until > datetime('now')`
    ).bind(service).first<{ blocked: number }>();
    return !!row;
  } catch {
    return false;
  }
}

// Provider circuit-breaker. `blocked_until` is a short, deliberate pause set by a
// caller that saw a 429/ban; this answers the different question "has this
// provider succeeded AT ALL lately?", so a job can route around an outage that
// nothing thought to block.
//
// Bright Data 502'd every eBay-sold call for six days while its key pool still
// reported budget, so `pickKey` kept handing out live keys and every run was
// killed mid-flight without writing a single price. Requires POSITIVE evidence of
// breakage — recent failures AND no recent success — so a provider that is merely
// idle (nothing scheduled yet, fresh deploy) is never declared down. FAILS OPEN.
export async function integrationRecentlyHealthy(
  env: Env,
  service: IntegrationName,
  windowHours = 24,
): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      `SELECT last_ok_at, last_fail_at FROM integration_health WHERE service=?`,
    ).bind(service).first<{ last_ok_at: string | null; last_fail_at: string | null }>();
    if (!row) return true;                              // never used -> let it try
    const cutoff = new Date(Date.now() - windowHours * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
    const okRecently = !!row.last_ok_at && row.last_ok_at >= cutoff;
    const failedRecently = !!row.last_fail_at && row.last_fail_at >= cutoff;
    return okRecently || !failedRecently;
  } catch (e) {
    console.warn('[integration-health] health probe failed open:', (e as Error).message);
    return true;
  }
}

export async function getIntegrationHealth(env: Env): Promise<IntegrationHealthRow[]> {
  try {
    const { results } = await env.DB
      .prepare('SELECT * FROM integration_health ORDER BY service')
      .all<IntegrationHealthRow>();
    return (results ?? []).map(r => ({ ...r, status: classifyHealth(r) }));
  } catch (e) {
    console.warn('[integration-health] read failed:', (e as Error).message);
    return [];
  }
}

export async function getIntegrationDiagnostics(env: Env): Promise<IntegrationDiagnostic[]> {
  const rows = await getIntegrationHealth(env);
  const byService = new Map(rows.map(row => [row.service, row]));
  const diagnostics: IntegrationDiagnostic[] = [];

  for (const [service, def] of Object.entries(INTEGRATION_DEFINITIONS) as Array<[IntegrationName, IntegrationDefinition]>) {
    const configured = def.configured(env);
    const row = byService.get(service);
    const missing = missingSecrets(env, def.required_secrets);
    let status: IntegrationStatus = 'unconfigured';
    if (configured && (service === 'd1' || service === 'supabase')) {
      status = 'ok';
    } else if (configured) {
      status = row ? classifyHealth(row) : 'unknown';
    }
    const degraded = status === 'degraded';
    const reachable = !configured ? false : (service === 'd1' || service === 'supabase') ? true : row ? status !== 'down' : null;
    const latestAccessIssue = !!(configured && row && isCredentialOrAccessIssue(row.last_error));
    const ebayKeyIssue = service === 'ebay' && latestAccessIssue && /OAuth|invalid[_ -]?client/i.test(row?.last_error || '');
    const ebayInsightsIssue = service === 'ebay' && latestAccessIssue && !ebayKeyIssue;
    const recommendedAction = ebayKeyIssue
      ? 'Verify EBAY_APP_ID is the production App ID / Client ID and EBAY_CLIENT_SECRET is the matching production Cert ID / Client Secret, then redeploy.'
      : ebayInsightsIssue
        ? 'The eBay keyset is configured but sold-comps access is denied. Marketplace Insights is limited-release; request Buy Marketplace Insights approval for this production keyset or leave eBay pricing disabled while BrickLink/BrickEconomy continue.'
        : !configured
      ? (def.recommended_action || (missing.length ? `Set ${missing.join(', ')}.` : 'Complete setup for this integration.'))
      // Check quota BEFORE the generic "down" advice: telling someone to refresh
      // credentials over a rate limit sends them to rotate a working key and
      // discard whatever balance is left on it.
      : (configured && row && isQuotaIssue(row.last_error))
        ? 'Provider is refusing calls on quota or rate limit, not credentials — leave the keys alone. Wait for the window to reset, lower the daily cap, or add capacity.'
      : (configured && row && isProviderOutage(row.last_error))
        ? 'The provider is erroring on its own side (5xx / empty response), so there is nothing to fix here. Jobs retry on their next scheduled run; if it persists for a day, check the provider status page or account standing.'
      : status === 'down'
        ? 'Check the latest provider error, refresh credentials, then rerun a small batch.'
        : degraded
          ? 'Retry with a smaller batch; if failures continue, check provider access and quotas.'
          : status === 'unknown'
            ? 'Ready; no provider calls have been recorded yet.'
            : 'No action required.';

    diagnostics.push({
      service,
      label: def.label,
      configured,
      reachable,
      degraded,
      status,
      used_by: def.used_by,
      required_secrets: def.required_secrets,
      missing_secrets: missing,
      notes: def.notes,
      recommended_action: recommendedAction,
      last_checked_at: row?.updated_at ?? null,
      last_ok_at: row?.last_ok_at ?? null,
      last_fail_at: row?.last_fail_at ?? null,
      last_error: row?.last_error ?? null,
      ok_count: row?.ok_count ?? 0,
      fail_count: row?.fail_count ?? 0,
      updated_at: row?.updated_at ?? null,
    });
  }

  return diagnostics;
}
