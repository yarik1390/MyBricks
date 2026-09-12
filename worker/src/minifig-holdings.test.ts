/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { minifigsRoute } from './routes/minifigs';
import { applyTestTables } from './test-schema';

declare module 'cloudflare:test' {
  interface ProvidedEnv { DB: D1Database }
}

const secret = 'minifig-holdings-test-secret-at-least-32-chars';
const user = 'minifig-owner';
let db: D1Database;
let token: string;
let otherToken: string;

const ctx = {
  waitUntil: (_promise: Promise<unknown>) => {},
  passThroughOnException: () => {},
} as ExecutionContext;

async function jwt(subject: string): Promise<string> {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: subject,
    role: 'authenticated',
    aud: 'authenticated',
    iss: 'https://supabase.mock.io/auth/v1',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}`;
}

function request(path: string, init: RequestInit = {}, authToken = token) {
  const headers = new Headers(init.headers);
  if (authToken) headers.set('Authorization', `Bearer ${authToken}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  return minifigsRoute.fetch(new Request(`http://local${path}`, { ...init, headers }), env as any, ctx);
}

describe('loose minifigure holdings', () => {
  beforeEach(async () => {
    (env as any).SUPABASE_JWT_SECRET = secret;
    (env as any).SUPABASE_URL = 'https://supabase.mock.io';
    (env as any).ANALYTICS = undefined;
    db = (env as any).DB;
    token = await jwt(user);
    otherToken = await jwt('other-owner');
    await applyTestTables(db, ['minifigs', 'user_minifigs']);
    await db.batch([
      db.prepare("INSERT INTO minifigs (fig_num,name,series) VALUES ('fig-a','Alpha Fig','Series A')"),
      db.prepare("INSERT INTO minifigs (fig_num,name,series) VALUES ('fig-b','Beta Fig','Series B')"),
    ]);
  });

  it('creates defaults, partially updates atomically, and preserves rich fields for old callers', async () => {
    const created = await request('/fig-a', { method: 'PUT', body: '{}' });
    expect(await created.json()).toEqual({
      ok: true,
      fig_num: 'fig-a',
      quantity: 1,
      holding: { quantity: 1, condition: 'unknown', purchase_price: null, purchased_at: null, notes: null },
    });

    const rich = await request('/fig-a', { method: 'PUT', body: JSON.stringify({
      condition: 'used_good', purchase_price: 0, purchased_at: '2026-09-12', notes: 'Display copy',
    }) });
    expect((await rich.json<any>()).holding).toEqual({
      quantity: 1, condition: 'used_good', purchase_price: 0, purchased_at: '2026-09-12', notes: 'Display copy',
    });

    const oldCaller = await request('/fig-a', { method: 'PUT', body: JSON.stringify({ quantity: 3 }) });
    expect((await oldCaller.json<any>()).holding).toEqual({
      quantity: 3, condition: 'used_good', purchase_price: 0, purchased_at: '2026-09-12', notes: 'Display copy',
    });
    const empty = await request('/fig-a', { method: 'PUT' });
    expect((await empty.json<any>()).holding.quantity).toBe(3);
    expect(await db.prepare("SELECT quantity,condition,purchase_price,purchased_at,notes FROM user_minifigs WHERE user_id=? AND fig_num='fig-a'").bind(user).first()).toEqual({
      quantity: 3, condition: 'used_good', purchase_price: 0, purchased_at: '2026-09-12', notes: 'Display copy',
    });
  });

  it('rejects malformed bodies and every invalid supplied field without mutation', async () => {
    await request('/fig-a', { method: 'PUT', body: JSON.stringify({ quantity: 2, notes: 'safe' }) });
    const invalid = [
      '[1]', 'null', '{', JSON.stringify({ quantity: '2' }), JSON.stringify({ quantity: 1.5 }),
      JSON.stringify({ quantity: 0 }), JSON.stringify({ quantity: 10000 }), JSON.stringify({ condition: 'sealed' }),
      '{"purchase_price":1e400}', JSON.stringify({ purchase_price: -1 }),
      JSON.stringify({ purchased_at: '2026-02-30' }), JSON.stringify({ notes: 'x'.repeat(2001) }),
      JSON.stringify({ extra: true }),
    ];
    for (const body of invalid) expect((await request('/fig-a', { method: 'PUT', body })).status).toBe(400);
    expect(await db.prepare("SELECT quantity,notes FROM user_minifigs WHERE user_id=? AND fig_num='fig-a'").bind(user).first()).toEqual({ quantity: 2, notes: 'safe' });
  });

  it('keeps holding details owner-private and requires membership for writes and exports', async () => {
    await request('/fig-a', { method: 'PUT', body: JSON.stringify({ quantity: 2, purchase_price: 4.5, notes: 'private note' }) });
    const mine = await request('/fig-a');
    expect(mine.headers.get('Cache-Control')).toBe('private, no-store');
    const detail = await mine.json<any>();
    expect(detail.holding).toMatchObject({ quantity: 2, purchase_price: 4.5, notes: 'private note' });
    for (const field of ['holding', 'purchase_price', 'purchased_at', 'condition', 'notes']) expect(detail.minifig).not.toHaveProperty(field);
    const foreign = await request('/fig-a', {}, otherToken);
    expect((await foreign.json<any>()).holding).toBeNull();
    const guest = await request('/fig-a', {}, '');
    expect((await guest.json<any>()).holding).toBeNull();
    expect((await request('/fig-b', { method: 'PUT', body: '{}' }, '')).status).toBe(401);
    expect((await request('/export', {}, '')).status).toBe(401);
    expect((await request('/fig-a', { method: 'DELETE' }, otherToken)).status).toBe(204);
    expect(await db.prepare("SELECT 1 FROM user_minifigs WHERE user_id=? AND fig_num='fig-a'").bind(user).first()).toBeTruthy();
  });

  it('exports stable owner-only CSV with safe formulas, quoting, and distinct null and zero costs', async () => {
    await request('/fig-a', { method: 'PUT', body: JSON.stringify({
      quantity: 2, condition: 'new', purchase_price: 0, purchased_at: '2026-01-02', notes: '\t=SUM(1,1)\n"quoted"',
    }) });
    await request('/fig-b', { method: 'PUT', body: JSON.stringify({ quantity: 1, condition: 'unknown' }) });
    await db.prepare("INSERT INTO user_minifigs (user_id,fig_num,quantity,notes) VALUES ('other-owner','fig-b',9,'foreign')").run();

    const exported = await request('/export');
    const csv = await exported.text();
    expect(exported.status).toBe(200);
    expect(exported.headers.get('Cache-Control')).toBe('private, no-store');
    expect(csv.split('\r\n')[0]).toBe('fig_num,name,series,quantity,condition,purchase_price_usd,purchased_at,notes');
    expect(csv).toContain("fig-a,Alpha Fig,Series A,2,new,0,2026-01-02,\"'\t=SUM(1,1)");
    expect(csv).toContain('""quoted""');
    expect(csv).toContain('fig-b,Beta Fig,Series B,1,unknown,,,');
    expect(csv).not.toContain('foreign');
  });

  it('returns 404 for unknown catalog ids without creating a holding', async () => {
    expect((await request('/missing', { method: 'PUT', body: '{}' })).status).toBe(404);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM user_minifigs').first<{ n: number }>())?.n).toBe(0);
  });
});
