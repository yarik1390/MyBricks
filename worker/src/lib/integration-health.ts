import type { Env } from '../types';

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
  | 'openai'
  | 'rebrickable';

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
    notes: 'Uses eBay Marketplace Insights sold comps only, split into new/sealed and used US/USD values. Marketplace Insights is limited-release and must be enabled for the keyset.',
    recommended_action: 'Add EBAY_APP_ID and EBAY_CLIENT_SECRET to enable eBay sold-comps enrichment.',
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
    configured: (env) => !!env.BRICKECONOMY_API_KEY,
    required_secrets: ['BRICKECONOMY_API_KEY'],
    used_by: ['primary set valuation', 'forecasts', 'retail price enrichment'],
    notes: 'Primary valuation source when available.',
    recommended_action: 'Add BRICKECONOMY_API_KEY and rerun valuation batches.',
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
    notes: 'Optional slower per-set barcode fallback. Brickset is preferred when available.',
    recommended_action: 'Add BRICKOWL_API_KEY only if Brickset barcode coverage is unavailable.',
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
  openai: {
    label: 'OpenAI',
    configured: (env) => !!env.OPENAI_API_KEY,
    required_secrets: ['OPENAI_API_KEY'],
    used_by: ['photo scan', 'advisor', 'listing draft', 'valuation fallback'],
    notes: 'Server key is rate-limited; users can bring their own key for scans, advisor, and listing drafts.',
    recommended_action: 'Add OPENAI_API_KEY for shared scan, advisor, listing, and fallback valuation features.',
  },
  rebrickable: {
    label: 'Rebrickable',
    configured: (env) => !!env.REBRICKABLE_API_KEY,
    required_secrets: ['REBRICKABLE_API_KEY'],
    used_by: ['catalog import', 'search fallback', 'CSV import fallback'],
    notes: 'Catalog source for sets, themes, minifigs, and images.',
    recommended_action: 'Add REBRICKABLE_API_KEY and rerun the catalog import.',
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

export function classifyHealth(row: IntegrationHealthRow): 'ok' | 'degraded' | 'down' {
  const okAt = row.last_ok_at ? Date.parse(row.last_ok_at) : 0;
  const failAt = row.last_fail_at ? Date.parse(row.last_fail_at) : 0;
  if (failAt && failAt >= okAt) {
    return (isCredentialOrAccessIssue(row.last_error) || isWorkerCapacityIssue(row.last_error))
      ? 'degraded'
      : 'down';
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
