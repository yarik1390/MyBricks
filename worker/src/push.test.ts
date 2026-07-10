/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { pushRoute } from './routes/push';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;
const secret = 'push-test-secret-at-least-32-characters-long';

async function createToken(userId: string): Promise<string> {
  const encode = (value: unknown) => btoa(JSON.stringify(value))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({ sub: userId, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 });
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(unsigned));
  const signature = btoa(String.fromCharCode(...new Uint8Array(signed)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${unsigned}.${signature}`;
}

describe('native push subscription routes', () => {
  let auth: Record<string, string>;

  beforeEach(async () => {
    (env as any).SUPABASE_JWT_SECRET = secret;
    (env as any).SUPABASE_URL = 'https://supabase.test';
    await applyTestTables(db, ['push_subscriptions', 'native_push_tokens']);
    auth = {
      Authorization: `Bearer ${await createToken('push-user')}`,
      'Content-Type': 'application/json',
    };
  });

  it('requires a signed-in member', async () => {
    const response = await pushRoute.request('/status', {}, env as any);
    expect(response.status).toBe(401);
  });

  it('validates, stores, reports, and removes a device token', async () => {
    const invalid = await pushRoute.request('/native', {
      method: 'POST', headers: auth, body: JSON.stringify({ token: 'short' }),
    }, env as any);
    expect(invalid.status).toBe(400);

    const token = 'fcm-device-token-with-more-than-twenty-characters';
    const registered = await pushRoute.request('/native', {
      method: 'POST', headers: auth, body: JSON.stringify({ token, platform: 'android' }),
    }, env as any);
    expect(registered.status).toBe(200);

    const status = await pushRoute.request('/status', { headers: auth }, env as any);
    expect(await status.json()).toEqual({ web: false, native: true });

    const removed = await pushRoute.request('/native', {
      method: 'DELETE', headers: auth, body: JSON.stringify({ token }),
    }, env as any);
    expect(removed.status).toBe(200);
    const row = await db.prepare('SELECT token FROM native_push_tokens').first();
    expect(row).toBeNull();
  });
});
