/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rebrickableSyncRoute } from './routes/rebrickable-sync';
import { applyTestTables } from './test-schema';

const secret = 'rebrickable-sync-test-secret-at-least-32-chars';
const user = 'rb-owner';
const db = (env as { DB: D1Database }).DB;
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

async function jwt(subject: string): Promise<string> {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: subject, role: 'authenticated', aud: 'authenticated',
    iss: 'https://supabase.mock.io/auth/v1', exp: Math.floor(Date.now() / 1000) + 3600,
  })}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}`;
}

async function call(method: string, path: string, body?: unknown) {
  const res = await rebrickableSyncRoute.fetch(new Request(`http://local${path}`, {
    method, headers: { Authorization: `Bearer ${await jwt(user)}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }), env as any, ctx);
  return { status: res.status, body: await res.json() as any };
}

// Rebrickable lists: 21318-1 twice (two set lists), 75192-1 (owned already), 99999-1 (not in our catalog).
const listPage = {
  next: null,
  results: [
    { list_id: 1, quantity: 1, set: { set_num: '21318-1' } },
    { list_id: 2, quantity: 1, set: { set_num: '21318-1' } },
    { list_id: 1, quantity: 1, set: { set_num: '75192-1' } },
    { list_id: 1, quantity: 1, set: { set_num: '99999-1' } },
    { list_id: 1, quantity: 1, set: { set_num: '10497-1' } },
  ],
};

describe('Rebrickable sync', () => {
  const posted: string[] = [];
  beforeEach(async () => {
    posted.length = 0;
    (env as any).SUPABASE_JWT_SECRET = secret;
    (env as any).SUPABASE_URL = 'https://supabase.mock.io';
    (env as any).REBRICKABLE_API_KEY = 'rb-key';
    await applyTestTables(db, ['lego_sets', 'user_collection', 'user_prefs', 'realized_sales', 'holding_copies']);
    await db.batch([
      db.prepare("INSERT INTO lego_sets (set_num, name) VALUES ('10497-1', 'Galaxy Explorer'), ('21318-1', 'Tree House'), ('75192-1', 'Falcon'), ('60000-1', 'Fire Truck')"),
      db.prepare("INSERT INTO user_collection (user_id, set_num) VALUES (?, '75192-1'), (?, '60000-1')").bind(user, user),
      // Sold before the ledger existed: re-importing it must not lose the sale.
      db.prepare("INSERT INTO user_collection (user_id, set_num, quantity, purchase_price, sold_price, sold_at, deleted_at) VALUES (?, '10497-1', 1, 50, 90, '2026-01-02', '2026-01-02')").bind(user),
    ]);
    vi.stubGlobal('fetch', async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      expect(new Headers(init?.headers).get('Authorization')).toBe('key rb-key');
      if (url.endsWith('/users/_token/')) {
        return String(init?.body).includes('password=right')
          ? Response.json({ user_token: 'tok123' })
          : Response.json({ detail: 'Invalid' }, { status: 400 });
      }
      if (url.includes('/users/tok123/sets/') && (init?.method || 'GET') === 'GET') return Response.json(listPage);
      if (url.endsWith('/users/tok123/sets/') && init?.method === 'POST') {
        posted.push(String(init.body));
        return Response.json({}, { status: 201 });
      }
      return new Response('not found', { status: 404 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('connects with a username and password and stores only the token', async () => {
    expect((await call('POST', '/login', { username: 'me', password: 'wrong' })).status).toBe(401);
    expect((await call('POST', '/login', { username: 'me', password: 'right' })).body.ok).toBe(true);
    expect(await db.prepare('SELECT rebrickable_user_token AS t FROM user_prefs WHERE user_id = ?').bind(user).first()).toEqual({ t: 'tok123' });
    await call('DELETE', '/connect');
    expect(await db.prepare('SELECT rebrickable_user_token AS t FROM user_prefs WHERE user_id = ?').bind(user).first()).toEqual({ t: null });
  });

  it('imports new sets with their quantity, keeps an old sale in the ledger, and sends missing sets back', async () => {
    expect((await call('POST', '/import')).status).toBe(400);
    await db.prepare("INSERT INTO user_prefs (user_id, rebrickable_user_token) VALUES (?, 'tok123')").bind(user).run();
    const imp = await call('POST', '/import');
    expect(imp.body).toMatchObject({ added: 2, already: 1, unknown: 1, total: 4 });
    const rows = await db.prepare('SELECT set_num, quantity, sold_at, deleted_at FROM user_collection WHERE user_id = ? ORDER BY set_num').bind(user).all();
    expect(rows.results).toEqual([
      { set_num: '10497-1', quantity: 1, sold_at: null, deleted_at: null },
      { set_num: '21318-1', quantity: 2, sold_at: null, deleted_at: null },
      { set_num: '60000-1', quantity: 1, sold_at: null, deleted_at: null },
      { set_num: '75192-1', quantity: 1, sold_at: null, deleted_at: null },
    ]);
    expect(await db.prepare('SELECT set_num, sold_price, cost_basis FROM realized_sales WHERE user_id = ?').bind(user).all())
      .toMatchObject({ results: [{ set_num: '10497-1', sold_price: 90, cost_basis: 50 }] });

    const exp = await call('POST', '/export');
    expect(exp.body).toMatchObject({ sent: 1, remaining: 0, total_missing: 1 });
    expect(posted).toEqual(['set_num=60000-1&quantity=1']);
  });
});
