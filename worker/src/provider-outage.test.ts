/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env as testEnv } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from './types';
import { applyTestTables } from './test-schema';
import { EDGE_REFUSAL_ERROR, OUTAGE_HEADER, fetchTracked, isEdgeRefusal } from './lib/http';
import { gatewayDirectUrl, gatewayFallbackFetch } from './lib/ai-gateway';
import { classifyHealth, isIntegrationBlocked } from './lib/integration-health';

const env = testEnv as unknown as Env;
const GATEWAY = 'https://gateway.ai.cloudflare.com/v1/acct123/brickvault';
const health = (service: string) => env.DB.prepare(
  'SELECT last_error, ok_count, fail_count, last_ok_at, last_fail_at, blocked_until FROM integration_health WHERE service=?',
).bind(service).first<any>();

beforeEach(async () => {
  await applyTestTables(env.DB, ['integration_health']);
  await env.DB.prepare('DELETE FROM integration_health').run();
});
afterEach(() => vi.unstubAllGlobals());

describe('provider edge refusal (BrickLink offline)', () => {
  it('tells an edge 403 from an API answer by its content type', () => {
    const html = new Response('<html>blocked</html>', { status: 403, headers: { 'content-type': 'text/html' } });
    const json = new Response('{"meta":{"code":403}}', { status: 403, headers: { 'content-type': 'application/json' } });
    expect(isEdgeRefusal(html)).toBe(true);
    expect(isEdgeRefusal(json)).toBe(false);
    expect(isEdgeRefusal(new Response('', { status: 500 }))).toBe(false);
  });

  it('records an outage, not an access problem, and pauses the service', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Forbidden</html>', {
      status: 403, headers: { 'content-type': 'text/html' },
    })));
    const resp = await fetchTracked(env, 'bricklink', 'https://api.bricklink.com/x', {}, { edgeRefusalIsOutage: true, retries: 0 });
    expect(resp.status).toBe(503);
    expect(resp.headers.get(OUTAGE_HEADER)).toBe(EDGE_REFUSAL_ERROR);
    const row = await health('bricklink');
    expect(row.last_error).toBe(EDGE_REFUSAL_ERROR);
    // Not a credential problem: "down" (provider side), never "degraded: needs access".
    expect(EDGE_REFUSAL_ERROR).not.toMatch(/401|403|unauthori|forbidden|credential|permission/i);
    expect(classifyHealth(row)).toBe('down');
    expect(await isIntegrationBlocked(env, 'bricklink')).toBe(true);
  });

  it('keeps a plain 403 as a 403 for services that did not opt in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })));
    const resp = await fetchTracked(env, 'exa', 'https://api.exa.ai/x', {}, { retries: 0 });
    expect(resp.status).toBe(403);
    expect((await health('exa')).last_error).toBe('HTTP 403');
  });
});

describe('AI Gateway refusal falls back to the provider', () => {
  it('maps gateway URLs back to the provider', () => {
    expect(gatewayDirectUrl(`${GATEWAY}/google-ai-studio/v1beta/models/m:generateContent?alt=sse`))
      .toBe('https://generativelanguage.googleapis.com/v1beta/models/m:generateContent?alt=sse');
    expect(gatewayDirectUrl(`${GATEWAY}/openai/chat/completions`)).toBe('https://api.openai.com/v1/chat/completions');
    expect(gatewayDirectUrl(`${GATEWAY}/openrouter/chat/completions`)).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(gatewayDirectUrl('https://api.openai.com/v1/chat/completions')).toBeNull();
    expect(gatewayDirectUrl(`${GATEWAY}/unknown-provider/x`)).toBeNull();
  });

  it('a gateway 401 is retried directly and Gemini stays healthy and unblocked', async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), headers: new Headers(init.headers as HeadersInit) });
      if (String(url).startsWith(GATEWAY)) {
        return new Response('{"success":false,"error":[{"code":2009,"message":"Unauthorized"}]}', { status: 401 });
      }
      return new Response('{"candidates":[]}', { status: 200 });
    }));
    const resp = await fetchTracked(env, 'gemini', `${GATEWAY}/google-ai-studio/v1beta/models/m:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': 'k', 'cf-aig-authorization': 'Bearer stale', 'cf-aig-metadata': '{}' },
      body: '{}',
    }, { retries: 0 });
    expect(resp.status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual([
      `${GATEWAY}/google-ai-studio/v1beta/models/m:generateContent`,
      'https://generativelanguage.googleapis.com/v1beta/models/m:generateContent',
    ]);
    // Gateway-only headers never reach the provider; the provider key does.
    expect(calls[1].headers.get('cf-aig-authorization')).toBeNull();
    expect(calls[1].headers.get('cf-aig-metadata')).toBeNull();
    expect(calls[1].headers.get('x-goog-api-key')).toBe('k');
    const row = await health('gemini');
    expect(row).toMatchObject({ ok_count: 1, fail_count: 0 });
    expect(await isIntegrationBlocked(env, 'gemini')).toBe(false);
  });

  it('a 401 from the provider itself is still a real key failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"code":401,"status":"UNAUTHENTICATED"}}', { status: 401 })));
    const resp = await fetchTracked(env, 'gemini', `${GATEWAY}/google-ai-studio/v1beta/models/m:generateContent`, {}, { retries: 0 });
    expect(resp.status).toBe(401);
    expect((await health('gemini')).last_error).toBe('HTTP 401');
    expect(await isIntegrationBlocked(env, 'gemini')).toBe(true);
  });

  it('gatewayFallbackFetch does the same for SDK clients', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seen.push(String(url));
      return String(url).startsWith(GATEWAY)
        ? new Response('[{"code":2009,"message":"Unauthorized"}]', { status: 401 })
        : new Response('{}', { status: 200 });
    }));
    const resp = await gatewayFallbackFetch(`${GATEWAY}/openai/chat/completions`, { method: 'POST', body: '{}' });
    expect(resp.status).toBe(200);
    expect(seen[1]).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('a call recorded with record:false (a user\'s own key) leaves server health alone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad key', { status: 401 })));
    await fetchTracked(env, 'gemini', 'https://generativelanguage.googleapis.com/v1beta/models/m:generateContent', {}, { retries: 0, record: false });
    expect(await health('gemini')).toBeNull();
    expect(await isIntegrationBlocked(env, 'gemini')).toBe(false);
  });
});
