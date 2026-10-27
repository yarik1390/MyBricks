import type { Env } from '../types';
import { openCodexConfigured } from './opencodex';

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
  | 'gemini'
  | 'email'
  | 'push'
  | 'firebase'
  | 'openai'
  | 'openrouter'
  | 'opencodex'
  | 'merge'
  | 'rebrickable'
  | 'brickinsights'
  | 'firecrawl'
  | 'brightdata'
  | 'decodo'
  | 'zenrows'
  | 'pricecharting'
  | 'amazon';

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
  /** How old the last observation may be before it no longer proves health. */
  stale_after_hours: number;
}

type IntegrationDefinition = {
  label: string;
  configured: (env: Env) => boolean;
  required_secrets: string[];
  used_by: string[];
  notes: string;
  recommended_action?: string;
  /** Called only when a user or an alert needs it, so quiet days are normal. */
  on_demand?: boolean;
};

const STALE_AFTER_HOURS = 48;
// On-demand services can sit unused for days (no alert to push, no scan that
// reaches a fallback provider). Their last result stays valid evidence for two
// weeks, and the daily health probes (jobs/health-probes.ts) refresh it anyway.
const ON_DEMAND_STALE_AFTER_HOURS = 14 * 24;

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
    on_demand: true,
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
    used_by: ['asking prices', 'deal score', 'listing draft'],
    notes: 'Uses eBay Browse active-listing ASK prices (basic OAuth scope, works on any keyset).',
    recommended_action: 'Add EBAY_APP_ID and EBAY_CLIENT_SECRET for ask-price enrichment.',
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
    // Stored be_* values only; nothing fetches BrickEconomy any more.
    configured: () => true,
    required_secrets: [],
    used_by: ['set valuation (sealed/used)', 'forecasts (2y/5y)'],
    notes: 'Historical BrickEconomy values stored in the be_* columns, read under the isPlausibleMarketValue gate. The scraper is retired, so these values are no longer refreshed.',
    recommended_action: 'No action required.',
  },
  brickset: {
    label: 'Brickset',
    configured: (env) => !!env.BRICKSET_API_KEY,
    required_secrets: ['BRICKSET_API_KEY'],
    used_by: ['catalog details', 'UPC/barcode backfill'],
    notes: 'Adds metadata, community data, and barcode coverage.',
    recommended_action: 'Add BRICKSET_API_KEY and rerun barcode backfill.',
  },
  gemini: {
    on_demand: true,
    label: 'Gemini',
    configured: (env) => hasConfiguredSecret(env, 'GEMINI_API_KEY'),
    required_secrets: ['GEMINI_API_KEY'],
    used_by: ['BYOK photo scan', 'BYOK advisor', 'translations'],
    notes: 'Server key is optional; user-supplied BYOK Gemini keys still work from the browser.',
    recommended_action: 'Add GEMINI_API_KEY as a GitHub Actions secret to enable server-side Gemini features.',
  },
  email: {
    on_demand: true,
    label: 'Email Alerts',
    configured: (env) => hasConfiguredSecret(env, 'RESEND_API_KEY'),
    required_secrets: ['RESEND_API_KEY'],
    used_by: ['wishlist alerts', 'price drop notifications'],
    notes: 'Optional transactional email for alerts.',
    recommended_action: 'Add RESEND_API_KEY as a GitHub Actions secret to enable email wishlist alerts.',
  },
  push: {
    on_demand: true,
    label: 'Browser Push',
    configured: (env) => ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']
      .every(name => hasConfiguredSecret(env, name)),
    required_secrets: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'],
    used_by: ['wishlist alerts', 'browser notifications'],
    notes: 'Optional Web Push notifications. Requires a VAPID keypair and subject.',
    recommended_action: 'Add VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT as GitHub Actions secrets to enable browser push alerts.',
  },
  firebase: {
    on_demand: true,
    label: 'Native Push',
    configured: hasFirebaseConfig,
    required_secrets: ['FIREBASE_SERVICE_ACCOUNT_JSON'],
    used_by: ['Android wishlist alerts', 'native price notifications'],
    notes: 'Firebase Cloud Messaging delivery for installed Android devices.',
    recommended_action: 'Add FIREBASE_SERVICE_ACCOUNT_JSON as a Worker secret and google-services.json to the Android build.',
  },
  openai: {
    on_demand: true,
    label: 'OpenAI',
    configured: (env) => !!env.OPENAI_API_KEY,
    required_secrets: ['OPENAI_API_KEY'],
    used_by: ['photo scan', 'advisor', 'listing draft'],
    notes: 'Server key is rate-limited; users can bring their own key for scans, advisor, and listing drafts.',
    recommended_action: 'Add OPENAI_API_KEY for shared scan, advisor, and listing features.',
  },
  openrouter: {
    on_demand: true,
    label: 'OpenRouter',
    configured: (env) => !!env.OPENROUTER_API_KEY,
    required_secrets: ['OPENROUTER_API_KEY'],
    used_by: ['scan', 'advisor', 'listing'],
    notes: 'Free-first LLM provider routed through the AI Gateway: free models first, then cheap paid. Where each workload tries it is admin-tunable under LLM routing.',
    recommended_action: 'Add OPENROUTER_API_KEY (and the AI Gateway) to enable the free-first, low-cost LLM route.',
  },
  opencodex: {
    on_demand: true,
    label: 'OpenCodex',
    configured: (env) => openCodexConfigured(env),
    required_secrets: ['OPENCODEX_API_KEY'],
    used_by: ['scan', 'advisor', 'valuation', 'listing'],
    notes: 'Subscription-backed OpenAI-compatible gateway on Core01. High-speed vision scanning via dedicated combos with Cloudflare Access protection.',
    recommended_action: 'Configure OPENCODEX_API_KEY as a Worker secret and check OpenCodex status on Core01.',
  },
  merge: {
    on_demand: true,
    label: 'Merge Gateway',
    configured: (env) => !!(env.MERGE_GATEWAY_API_KEY ?? '').trim(),
    required_secrets: ['MERGE_GATEWAY_API_KEY'],
    used_by: ['scan', 'advisor', 'valuation', 'listing'],
    notes: 'Second multi-provider LLM gateway alongside OpenRouter, OpenAI-compatible at /v1/openai. Billed against a fixed monthly allowance and reports real per-call cost (usage.cost), so its spend in the ai_usage ledger is measured rather than estimated. Where each workload tries it is admin-tunable under LLM routing.',
    recommended_action: 'Add MERGE_GATEWAY_API_KEY (mg_...) from gateway.merge.dev, then set a HARD budget there so an exhausted allowance answers 402 instead of overspending.',
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
  firecrawl: {
    label: 'Firecrawl',
    configured: (env) => !!env.FIRECRAWL_API_KEY,
    required_secrets: ['FIRECRAWL_API_KEY'],
    used_by: ['lego.com stock/retirement checks', 'Brickset page enrichment', 'store offers'],
    notes: 'Web-scraping engine (handles JS rendering + bot-protection) for lego.com stock, Brickset enrichment, and store offers. Metered in CREDITS: 1 per basic/product scrape, 5 per JSON LLM extract. Daily ceiling is env-tunable via FIRECRAWL_DAILY_CREDITS (default 2000/day).',
    recommended_action: 'Add FIRECRAWL_API_KEY as a Worker/Actions secret. Raise FIRECRAWL_DAILY_CREDITS temporarily for the one-time catalog bootstrap, then reset.',
  },
  brightdata: {
    label: 'Bright Data Web Unlocker',
    configured: (env) => !!env.BRIGHTDATA_API_TOKEN?.trim()
      || !!env.BRIGHTDATA_API_TOKENS?.split(',').some((token) => token.trim()),
    required_secrets: ['BRIGHTDATA_API_TOKENS'],
    used_by: ['Brickset page enrichment', 'lego.com stock/retirement checks', 'store offers', 'coming soon', 'promotions'],
    notes: 'First lane for LEGO.com stock and Walmart/Target offers (its monthly allowance expires), fallback for Coming soon and promotions, last lane for Brickset (brickset.com answers its unlocker with HTTP 520). Every configured token is used: each call goes to the token with the least use this month; D1 stores hashes only and caps each token at 4,900 calls/month. The daily cap under Pricing sources is shared by the whole pool.',
    recommended_action: 'Configure BRIGHTDATA_API_TOKENS as comma-separated Worker secrets and optionally BRIGHTDATA_ZONE.',
  },
  decodo: {
    label: 'Decodo Web Scraping API',
    configured: (env) => !!env.DECODO_AUTH_TOKEN?.trim(),
    required_secrets: ['DECODO_AUTH_TOKEN'],
    used_by: ['lego.com stock/retirement checks', 'store offers', 'Brickset page enrichment', 'coming soon', 'promotions'],
    notes: 'Second raw-HTML lane for LEGO.com stock and stores (after Bright Data) and the first paid lane for Brickset after a free direct read; Bright Data gets HTTP 520 there (free plan, about $5 of requests a month, 300/day). Same parsers as Bright Data. Daily cap under Pricing sources.',
    recommended_action: 'Add DECODO_AUTH_TOKEN as a GitHub secret, then run Deploy Brickvault with push_secrets. Check the plan at dashboard.decodo.com if calls fail with 401/402.',
  },
  zenrows: {
    label: 'ZenRows Universal Scraper',
    configured: (env) => !!env.ZENROWS_API_KEY?.trim(),
    required_secrets: ['ZENROWS_API_KEY'],
    used_by: ['lego.com stock/retirement checks', 'store offers', 'Brickset page enrichment', 'coming soon', 'promotions'],
    notes: 'Raw-HTML lane after Decodo (free plan, 5,000 credits a month, 1 per plain request). Same parsers as Bright Data. Daily cap under Pricing sources.',
    recommended_action: 'Add ZENROWS_API_KEY as a GitHub secret, then run Deploy Brickvault with push_secrets. Check credits at app.zenrows.com if calls fail with 401/402.',
  },
  pricecharting: {
    label: 'PriceCharting',
    configured: (env) => !!env.PRICECHARTING_TOKEN,
    required_secrets: ['PRICECHARTING_TOKEN'],
    used_by: ['set valuation (sealed/complete/loose sold comps)', 'liquidity (sales-volume)'],
    notes: 'Aggregated eBay closed-auction comps (sealed/complete/loose + yearly sales volume) — the sold-comp replacement for eBay\'s retired Marketplace Insights API. VERIFIED-ONLY: signals flow solely from pricing_source_map rows proven by unique UPC (weekly bulk CSV) or cross-source price agreement (daily pricecharting-verify); unverified mappings stay quarantined. Collapses into the ebay_market family. The bulk CSV needs the Legendary tier (PRICECHARTING_PRO).',
    recommended_action: 'Add PRICECHARTING_TOKEN as a Worker secret; set PRICECHARTING_PRO=1 on the Legendary tier so the weekly bulk CSV refreshes the whole catalog in one download.',
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
// balance is left on it. Firecrawl (HTTP 429 per-minute ceiling) and Gemini
// (free tier 429) land in this bucket.
function isQuotaIssue(error?: string | null): boolean {
  return !!error && /(HTTP 429|EXCEED_LIMIT|rate limit|quota|too many requests|daily cap|credit ceiling)/i.test(error);
}

// A failure on the PROVIDER's side — 5xx, an unavailable upstream, or a page
// that came back empty. There is nothing to fix locally, so the credential
// advice is just as misleading here as it is for a quota refusal (e.g. Bright
// Data HTTP 502 or an empty/short body).
function isProviderOutage(error?: string | null): boolean {
  return !!error && /(HTTP 5\d\d|unavailable|bad gateway|service unavailable|gateway timeout|empty\/short body|empty body)/i.test(error);
}

// Every key is out of paid credits (Firecrawl answers 402 and the pool latches).
// Not a transient quota: it stays this way until someone tops up or turns the
// source off, so it gets its own advice instead of "wait for the window".
export function isCreditExhaustionIssue(error?: string | null): boolean {
  return !!error && /(credits left|out of credits|insufficient credits|HTTP 402|payment required)/i.test(error);
}

// A rejection of ONE request (an item number the provider doesn't know, a
// malformed query), not of the service. BrickLink answers 400 for some catalog
// numbers; that fired "BrickLink is unavailable" whenever the last call of a
// batch happened to be one of them, between thousands of good calls.
function isPerItemIssue(error?: string | null): boolean {
  return !!error && /(HTTP 400|HTTP 404|API code 40[04]|not found|no such (?:item|product)|target page failed)/i.test(error);
}

/** Bright Data reached the provider but could not unblock one target page. */
export function isTargetPageIssue(error?: string | null): boolean {
  return !!error && /target page failed/i.test(error);
}

// The provider answered, but a model's reply could not be parsed. That is a
// model-quality miss on one call, not an outage of the gateway that served it.
function isModelOutputIssue(error?: string | null): boolean {
  return !!error && /(malformed|unparseable|invalid json)/i.test(error);
}

export function classifyHealth(row: IntegrationHealthRow): 'ok' | 'degraded' | 'down' {
  const okAt = row.last_ok_at ? Date.parse(row.last_ok_at) : 0;
  const failAt = row.last_fail_at ? Date.parse(row.last_fail_at) : 0;
  if (failAt && failAt >= okAt) {
    // Credential/access problems always need a human → keep flagged as degraded.
    if (isCredentialOrAccessIssue(row.last_error)) return 'degraded';
    // A 429 or spent quota means the provider is up and refusing for budget
    // reasons. It recovers on its own, so it is never "down" (BrickInsights 429s
    // and exhausted daily caps were showing as "unavailable").
    if (isQuotaIssue(row.last_error) || isCreditExhaustionIssue(row.last_error)) return 'degraded';
    const recentSuccess = !!okAt && failAt - okAt < 24 * 60 * 60 * 1000;
    if (isPerItemIssue(row.last_error) && recentSuccess) return 'ok';
    if (isModelOutputIssue(row.last_error)) return recentSuccess ? 'ok' : 'degraded';
    // Transient worker-capacity blips (timeouts, aborts, "too many subrequests")
    // are common for scrapers under load. If the provider ALSO succeeded within a
    // day of this failure, it's flapping — not down — so it shouldn't stick on
    // "degraded". Without any nearby success, treat it as degraded.
    if (isWorkerCapacityIssue(row.last_error)) {
      return recentSuccess ? 'ok' : 'degraded';
    }
    // Successes and failures stamped in the same batch: partially working.
    if (okAt && failAt === okAt) return 'degraded';
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
  // A rejected server key fails every call until a human replaces it. Pause the
  // provider in LLM routing so scans and the advisor go straight to the next
  // step instead of spending a timeout on it; the daily probe lifts the pause
  // as soon as the key works again (and it lapses on its own after 24h).
  if (fail > 0 && ok === 0 && AI_ROUTED_SERVICES.has(service) && isCredentialOrAccessIssue(err)) {
    await setIntegrationBlock(env, service, 24);
  }
}

const AI_ROUTED_SERVICES = new Set<IntegrationName>(['gemini', 'openai', 'openrouter', 'opencodex', 'merge']);

/** AI providers currently paused by a credential failure (see above). */
export async function blockedIntegrations(env: Env): Promise<Set<string>> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT service FROM integration_health WHERE blocked_until > datetime('now')`,
    ).all<{ service: string }>();
    return new Set((results ?? []).map((r) => r.service));
  } catch {
    return new Set();
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
    const observedAt = row ? Math.max(Date.parse(row.last_ok_at || '') || 0, Date.parse(row.last_fail_at || '') || 0) : 0;
    const staleAfterHours = def.on_demand ? ON_DEMAND_STALE_AFTER_HOURS : STALE_AFTER_HOURS;
    const fresh = observedAt > 0 && Date.now() - observedAt <= staleAfterHours * 60 * 60 * 1000;
    if (configured) {
      // Configuration presence is not a connectivity check. Old observations
      // remain visible as history, but cannot certify current health.
      status = row && fresh ? classifyHealth(row) : 'unknown';
    }
    const degraded = status === 'degraded';
    const reachable = status === 'ok' ? true : status === 'down' ? false : null;
    const latestAccessIssue = !!(configured && fresh && row && status !== 'ok' && isCredentialOrAccessIssue(row.last_error));
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
      : (configured && row && status !== 'ok' && isCreditExhaustionIssue(row.last_error))
        ? 'Every key is out of paid credits. Top up the account (the daily health probe re-enables a topped-up key by itself) or turn this source off under Pricing sources. Other sources keep running meanwhile.'
      : (configured && row && status !== 'ok' && isCredentialOrAccessIssue(row.last_error) && AI_ROUTED_SERVICES.has(service))
        ? 'The provider rejected the server key. Replace the key (GitHub Actions secret, then redeploy) or remove this provider from LLM routing. Routing skips it until a probe or call succeeds.'
      : (configured && row && isQuotaIssue(row.last_error))
        ? 'Provider is refusing calls on quota or rate limit, not credentials — leave the keys alone. Wait for the window to reset, lower the daily cap, or add capacity.'
      : (configured && row && isTargetPageIssue(row.last_error))
        ? (status === 'ok'
          ? 'Working: the last failure was one site refusing one page (see Latest failure); other pages load.'
          : 'Every recent page failed on the target site (see Latest failure for the site and reason). If it is one site, it is blocking the unlocker; Firecrawl covers it.')
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
      stale_after_hours: staleAfterHours,
    });
  }

  return diagnostics;
}
