/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pushRoute } from './routes/push';
import { sendNativePushToUser } from './lib/firebase-push';
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

  it('remembers which Android devices draw their own notifications', async () => {
    const register = (body: Record<string, unknown>) => pushRoute.request('/native', {
      method: 'POST', headers: auth, body: JSON.stringify(body),
    }, env as any);
    const token = 'fcm-device-token-with-more-than-twenty-characters';
    const flag = async () => (await db.prepare('SELECT supports_actions FROM native_push_tokens WHERE token=?').bind(token).first<{ supports_actions: number }>())!.supports_actions;

    await register({ token, platform: 'android', actions: true });
    expect(await flag()).toBe(1);
    // An older build re-registering the same token has no buttons to draw.
    await register({ token, platform: 'android' });
    expect(await flag()).toBe(0);
    // iOS has no native renderer for them.
    await register({ token, platform: 'ios', actions: true });
    expect(await flag()).toBe(0);
  });
});

describe('native push delivery', () => {
  const sent: any[] = [];

  beforeEach(async () => {
    sent.length = 0;
    await applyTestTables(db, ['native_push_tokens', 'integration_health']);
    const keys = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true, ['sign', 'verify'],
    ) as CryptoKeyPair;
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey) as ArrayBuffer);
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8))}\n-----END PRIVATE KEY-----`;
    (env as any).FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      project_id: `bv-test-${crypto.randomUUID()}`, client_email: 'push@bv-test.iam.gserviceaccount.com', private_key: pem,
    });
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (String(url).startsWith('https://oauth2.googleapis.com/')) {
        return new Response(JSON.stringify({ access_token: 'test-access-token', expires_in: 3600 }), { headers: { 'Content-Type': 'application/json' } });
      }
      sent.push(JSON.parse(String(init.body)).message);
      return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    });
    await db.batch([
      db.prepare("INSERT INTO native_push_tokens (user_id, token, platform, supports_actions) VALUES ('u1', 'new-build-token-with-enough-characters', 'android', 1)"),
      db.prepare("INSERT INTO native_push_tokens (user_id, token, platform, supports_actions) VALUES ('u1', 'old-build-token-with-enough-characters', 'android', 0)"),
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (env as any).FIREBASE_SERVICE_ACCOUNT_JSON;
  });

  const payload = {
    title: 'Falcon is up 12%', body: 'Now $950', url: '#/set/75192-1', tag: 'spike-75192-1',
    actions: [
      { action: 'sell', title: 'Sell options', url: '#/set/75192-1/sell' },
      { action: 'target', title: 'Set sell target', url: '#/set/75192-1/target' },
      { action: 'extra', title: 'Third', url: '#/x' },
    ],
  };

  it('gives new builds a data message with the buttons and old builds the system notification', async () => {
    await sendNativePushToUser(env as any, 'u1', JSON.stringify(payload));
    const byToken = Object.fromEntries(sent.map(m => [m.token, m]));
    const fresh = byToken['new-build-token-with-enough-characters'];
    expect(fresh.notification).toBeUndefined();
    expect(fresh.data).toMatchObject({ title: 'Falcon is up 12%', body: 'Now $950', url: '#/set/75192-1', tag: 'spike-75192-1' });
    expect(JSON.parse(fresh.data.actions)).toEqual(payload.actions.slice(0, 2));
    const legacy = byToken['old-build-token-with-enough-characters'];
    expect(legacy.notification).toEqual({ title: 'Falcon is up 12%', body: 'Now $950' });
    expect(legacy.data).toEqual({ url: '#/set/75192-1' });
    expect(legacy.android.notification).toEqual({ tag: 'spike-75192-1' });
  });

  it('keeps the system notification when an alert has no buttons', async () => {
    await sendNativePushToUser(env as any, 'u1', JSON.stringify({ ...payload, actions: undefined }));
    expect(sent).toHaveLength(2);
    expect(sent.every(m => m.notification?.title === 'Falcon is up 12%')).toBe(true);
  });
});

