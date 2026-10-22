/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import app from './index';
import { applyTestTables } from './test-schema';
import { FEEDBACK_DAILY_LIMIT } from './routes/feedback';

const JWT_SECRET = 'test-secret-at-least-32-chars-long-and-super-secure';
const ctx = { waitUntil: (p: Promise<any>) => { p.catch(() => {}); }, passThroughOnException: () => {} } as any;

async function jwt(sub: string): Promise<string> {
  const b64url = (json: any) => btoa(JSON.stringify(json)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsigned = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub, email: `${sub}@example.com`, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}`;
}

const call = async (path: string, token: string | null, init: { method?: string; body?: unknown } = {}) => app.fetch(new Request(`http://localhost${path}`, {
  method: init.method || 'GET',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: init.body === undefined ? undefined : JSON.stringify(init.body),
}), env, ctx);

describe('in-app feedback', () => {
  const db = (env as any).DB as D1Database;
  beforeEach(async () => {
    (env as any).SUPABASE_JWT_SECRET = JWT_SECRET;
    (env as any).ADMIN_USER_ID = 'owner';
    await db.prepare('DROP TABLE IF EXISTS app_feedback').run();
    await applyTestTables(db, ['app_feedback']);
  });

  it('needs a signed-in user and a real message', async () => {
    expect((await call('/api/feedback', null, { method: 'POST', body: { message: 'hello' } })).status).toBe(401);
    expect((await call('/api/feedback', await jwt('u1'), { method: 'POST', body: { message: ' ' } })).status).toBe(400);
  });

  it('stores the note with its context and shows it only to the owner', async () => {
    const res = await call('/api/feedback', await jwt('u1'), { method: 'POST', body: { message: 'Price looks off', screen: '#/set/75313-1', app_version: '608 (100247)', platform: 'android', locale: 'uk' } });
    expect(res.status).toBe(200);
    expect((await call('/api/feedback/admin', await jwt('u1'))).status).toBe(403);
    const list = await (await call('/api/feedback/admin', await jwt('owner'))).json() as any;
    expect(list.open).toBe(1);
    expect(list.items[0]).toMatchObject({ email: 'u1@example.com', message: 'Price looks off', screen: '#/set/75313-1', platform: 'android', status: 'open' });
    expect((await call(`/api/feedback/admin/${list.items[0].id}`, await jwt('owner'), { method: 'PATCH', body: { status: 'done' } })).status).toBe(200);
    expect(((await (await call('/api/feedback/admin', await jwt('owner'))).json()) as any).open).toBe(0);
  });

  it('caps notes per user per day', async () => {
    const token = await jwt('u2');
    for (let i = 0; i < FEEDBACK_DAILY_LIMIT; i++) {
      expect((await call('/api/feedback', token, { method: 'POST', body: { message: `note ${i}` } })).status).toBe(200);
    }
    expect((await call('/api/feedback', token, { method: 'POST', body: { message: 'one more' } })).status).toBe(429);
  });
});
