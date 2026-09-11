import { describe, expect, it } from 'vitest';
import { getIntegrationDiagnostics } from './lib/integration-health';
import type { Env } from './types';

function fixture(lastOk: string | null, lastFail: string | null = null): Env {
  return {
    MERGE_GATEWAY_API_KEY: 'test-only',
    SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON_KEY: 'test', SUPABASE_JWT_SECRET: 'test',
    DB: { prepare: () => ({ all: async () => ({ results: [{ service: 'merge', last_ok_at: lastOk, last_fail_at: lastFail, last_error: 'HTTP 403', ok_count: 1, fail_count: 1, updated_at: lastFail || lastOk }] }) }) },
  } as unknown as Env;
}

describe('admin health evidence freshness', () => {
  it('does not certify configured core services without observations', async () => {
    const rows = await getIntegrationDiagnostics(fixture(null));
    for (const service of ['d1', 'supabase']) {
      expect(rows.find(r => r.service === service)).toMatchObject({ status: 'unknown', reachable: null });
    }
  });
  it('marks stale success and failure as unknown, retaining history', async () => {
    const old = new Date(Date.now() - 72 * 3600000).toISOString();
    const rows = await getIntegrationDiagnostics(fixture(old, old));
    expect(rows.find(r => r.service === 'merge')).toMatchObject({ status: 'unknown', reachable: null, last_fail_at: old });
  });
  it('reports recent success as observed healthy', async () => {
    const rows = await getIntegrationDiagnostics(fixture(new Date().toISOString()));
    expect(rows.find(r => r.service === 'merge')).toMatchObject({ status: 'ok', reachable: true });
  });
});
