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
  status: IntegrationStatus;
  used_by: string[];
  notes: string;
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
  used_by: string[];
  notes: string;
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
    used_by: ['catalog', 'portfolio', 'wishlist', 'admin'],
    notes: 'Primary database binding.',
  },
  supabase: {
    label: 'Supabase Auth',
    configured: (env) => !!(env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.SUPABASE_JWT_SECRET),
    used_by: ['sign in', 'member sync', 'admin access'],
    notes: 'Authentication and member identity.',
  },
  google: {
    label: 'Google Sheets',
    configured: hasRealGoogleConfig,
    used_by: ['collection sync', 'wishlist sync'],
    notes: 'Optional spreadsheet sync. Requires OAuth credentials.',
  },
  ebay: {
    label: 'eBay',
    configured: (env) => !!env.EBAY_APP_ID,
    used_by: ['sold-price checks', 'deal score', 'listing draft'],
    notes: 'Uses Marketplace Insights sold data when OAuth access is available, then legacy Finding API as fallback.',
  },
  bricklink: {
    label: 'BrickLink',
    configured: (env) => !!(
      env.BRICKLINK_CONSUMER_KEY &&
      env.BRICKLINK_CONSUMER_SECRET &&
      env.BRICKLINK_TOKEN &&
      env.BRICKLINK_TOKEN_SECRET
    ),
    used_by: ['new/used market prices', 'minifig values'],
    notes: 'Requires OAuth credentials and enough sold lots for confident values.',
  },
  brickeconomy: {
    label: 'BrickEconomy',
    configured: (env) => !!env.BRICKECONOMY_API_KEY,
    used_by: ['primary set valuation', 'forecasts', 'retail price enrichment'],
    notes: 'Primary valuation source when available.',
  },
  brickset: {
    label: 'Brickset',
    configured: (env) => !!env.BRICKSET_API_KEY,
    used_by: ['catalog details', 'UPC/barcode backfill'],
    notes: 'Adds metadata, community data, and barcode coverage.',
  },
  brickowl: {
    label: 'BrickOwl',
    configured: (env) => !!env.BRICKOWL_API_KEY,
    used_by: ['barcode fallback'],
    notes: 'Used as a slower per-set barcode fallback.',
  },
  gemini: {
    label: 'Gemini',
    configured: () => true,
    used_by: ['BYOK photo scan', 'BYOK advisor', 'BYOK valuation fallback'],
    notes: 'User-supplied keys are stored locally in the browser, not on the server.',
  },
  openai: {
    label: 'OpenAI',
    configured: (env) => !!env.OPENAI_API_KEY,
    used_by: ['photo scan', 'advisor', 'listing draft', 'valuation fallback'],
    notes: 'Server key is rate-limited; users can bring their own key for scans, advisor, and listing drafts.',
  },
  rebrickable: {
    label: 'Rebrickable',
    configured: (env) => !!env.REBRICKABLE_API_KEY,
    used_by: ['catalog import', 'search fallback', 'CSV import fallback'],
    notes: 'Catalog source for sets, themes, minifigs, and images.',
  },
};

function isCredentialOrAccessIssue(error?: string | null): boolean {
  return !!error && /(HTTP 401|HTTP 403|access denied|insufficient permissions|invalid[_ -]?scope|not authorized)/i.test(error);
}

export function classifyHealth(row: IntegrationHealthRow): 'ok' | 'degraded' | 'down' {
  const okAt = row.last_ok_at ? Date.parse(row.last_ok_at) : 0;
  const failAt = row.last_fail_at ? Date.parse(row.last_fail_at) : 0;
  if (failAt && failAt >= okAt) return isCredentialOrAccessIssue(row.last_error) ? 'degraded' : 'down';
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
    let status: IntegrationStatus = 'unconfigured';
    if (configured && (service === 'd1' || service === 'supabase')) {
      status = 'ok';
    } else if (configured) {
      status = row ? classifyHealth(row) : 'unknown';
    }

    diagnostics.push({
      service,
      label: def.label,
      configured,
      reachable: !configured ? false : (service === 'd1' || service === 'supabase') ? true : row ? status !== 'down' : null,
      status,
      used_by: def.used_by,
      notes: def.notes,
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
