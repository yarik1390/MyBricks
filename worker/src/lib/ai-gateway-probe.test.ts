import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../types';
import { runServiceTest } from './service-tests';

const base = { GEMINI_API_KEY: 'g', AI_GATEWAY_ACCOUNT_ID: 'acct', AI_GATEWAY_ID: 'brickvault' } as unknown as Env;

describe('aigateway probe', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('calls Gemini through the gateway with the gateway token', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await runServiceTest({ ...base, AI_GATEWAY_TOKEN: 'tok' } as Env, 'aigateway');
    expect(r?.ok).toBe(true);
    expect(r?.detail).toContain('accepted the token');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/gateway\.ai\.cloudflare\.com\/v1\/acct\/brickvault\/google-ai-studio\//);
    expect((init.headers as Record<string, string>)['cf-aig-authorization']).toBe('Bearer tok');
  });

  it('names a refused token instead of falling back', async () => {
    const fetchMock = vi.fn(async () => new Response('[{"code":2009,"message":"Unauthorized"}]', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await runServiceTest({ ...base, AI_GATEWAY_TOKEN: 'old' } as Env, 'aigateway');
    expect(r?.ok).toBe(false);
    expect(r?.detail).toContain('refused AI_GATEWAY_TOKEN');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('says the token is missing when the gateway requires one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[{"code":2009}]', { status: 401 })));
    const r = await runServiceTest(base, 'aigateway');
    expect(r?.detail).toContain('AI_GATEWAY_TOKEN is not set');
  });

  it('is unconfigured without the gateway account', async () => {
    const r = await runServiceTest({ GEMINI_API_KEY: 'g' } as unknown as Env, 'aigateway');
    expect(r?.status).toBe('unconfigured');
  });
});
