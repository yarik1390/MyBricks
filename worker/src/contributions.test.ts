/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import app from './index';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

// Mock ExecutionContext so background waitUntil calls don't throw under the pool.
const originalAppFetch = app.fetch;
app.fetch = (request: any, e?: any, executionCtx?: any) => {
  const mockCtx = executionCtx || {
    waitUntil: (p: Promise<any>) => { p.catch(() => {}); },
    passThroughOnException: () => {},
  };
  return originalAppFetch(request, e, mockCtx);
};

async function createMockJWT(userId: string, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { sub: userId, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 };
  const b64url = (json: any) => btoa(JSON.stringify(json)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsigned = `${b64url(header)}.${b64url(payload)}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(unsigned));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${unsigned}.${sigB64}`;
}

describe('User contributions: submit / read / moderate', () => {
  const JWT_SECRET = 'test-secret-at-least-32-chars-long-and-super-secure';
  const userId = 'contrib-user-1';
  const adminUserId = 'admin-user';
  let token: string;
  let adminToken: string;
  let db: D1Database;

  const auth = (t = token) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

  beforeEach(async () => {
    (env as any).SUPABASE_JWT_SECRET = JWT_SECRET;
    (env as any).SUPABASE_URL = 'https://supabase.mock.io';
    (env as any).SUPABASE_ANON_KEY = 'supabase-anon-key-mock';
    (env as any).ADMIN_USER_ID = adminUserId;

    token = await createMockJWT(userId, JWT_SECRET);
    adminToken = await createMockJWT(adminUserId, JWT_SECRET);
    db = (env as any).DB;

    const sqls = [
      'DROP TABLE IF EXISTS lego_sets',
      'DROP TABLE IF EXISTS user_prefs',
      'DROP TABLE IF EXISTS rate_limits',
      'DROP TABLE IF EXISTS set_reviews',
      'DROP TABLE IF EXISTS set_photos',
      'DROP TABLE IF EXISTS set_contributions',
      `CREATE TABLE lego_sets (set_num TEXT PRIMARY KEY, name TEXT NOT NULL, upc TEXT)`,
      `CREATE TABLE user_prefs (user_id TEXT PRIMARY KEY, is_supporter INTEGER DEFAULT 0, is_public INTEGER DEFAULT 0, display_name TEXT)`,
      `CREATE TABLE rate_limits (user_id TEXT NOT NULL, endpoint TEXT NOT NULL, window_start DATETIME NOT NULL, hit_count INTEGER DEFAULT 0, PRIMARY KEY (user_id, endpoint, window_start))`,
      `CREATE TABLE set_reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, set_num TEXT NOT NULL, rating INTEGER NOT NULL, title TEXT, body TEXT, status TEXT NOT NULL DEFAULT 'pending', reviewer_id TEXT, review_note TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, reviewed_at DATETIME, deleted_at DATETIME)`,
      `CREATE TABLE set_photos (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, set_num TEXT NOT NULL, r2_key TEXT NOT NULL, caption TEXT, status TEXT NOT NULL DEFAULT 'pending', reviewer_id TEXT, review_note TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, reviewed_at DATETIME, deleted_at DATETIME)`,
      `CREATE TABLE set_contributions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, set_num TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'pending', reviewer_id TEXT, review_note TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, reviewed_at DATETIME, deleted_at DATETIME)`,
    ];
    for (const s of sqls) await db.prepare(s).run();
    await db.prepare(`INSERT INTO lego_sets (set_num, name, upc) VALUES ('111-1', 'Test Set', NULL)`).run();
  });

  it('submits a review as pending and validates rating bounds', async () => {
    const bad = await app.fetch(new Request('https://x/api/contributions/reviews', {
      method: 'POST', headers: auth(), body: JSON.stringify({ set_num: '111-1', rating: 9 }),
    }), env);
    expect(bad.status).toBe(400);

    const res = await app.fetch(new Request('https://x/api/contributions/reviews', {
      method: 'POST', headers: auth(), body: JSON.stringify({ set_num: '111-1', rating: 4, title: 'Great' }),
    }), env);
    expect(res.status).toBe(200);
    const row = await db.prepare("SELECT status, rating FROM set_reviews WHERE set_num='111-1'").first<any>();
    expect(row.status).toBe('pending');
    expect(row.rating).toBe(4);
  });

  it('rejects an unknown set', async () => {
    const res = await app.fetch(new Request('https://x/api/contributions/data', {
      method: 'POST', headers: auth(), body: JSON.stringify({ set_num: 'nope-9', kind: 'barcode', payload: { upc: '0123456789' } }),
    }), env);
    expect(res.status).toBe(404);
  });

  it('validates barcode digits on data submission', async () => {
    const res = await app.fetch(new Request('https://x/api/contributions/data', {
      method: 'POST', headers: auth(), body: JSON.stringify({ set_num: '111-1', kind: 'barcode', payload: { upc: 'abc' } }),
    }), env);
    expect(res.status).toBe(400);
  });

  it('approving a barcode fix applies the UPC to lego_sets', async () => {
    await app.fetch(new Request('https://x/api/contributions/data', {
      method: 'POST', headers: auth(), body: JSON.stringify({ set_num: '111-1', kind: 'barcode', payload: { upc: '0123456789012' } }),
    }), env);
    const sub = await db.prepare("SELECT id FROM set_contributions WHERE set_num='111-1'").first<any>();

    const res = await app.fetch(new Request(`https://x/api/admin/contributions/data/${sub.id}`, {
      method: 'PATCH', headers: auth(adminToken), body: JSON.stringify({ action: 'approve' }),
    }), env);
    expect(res.status).toBe(200);
    const set = await db.prepare("SELECT upc FROM lego_sets WHERE set_num='111-1'").first<any>();
    expect(set.upc).toBe('0123456789012');
  });

  it('non-admin cannot reach the moderation queue', async () => {
    const res = await app.fetch(new Request('https://x/api/admin/contributions?status=pending', {
      headers: auth(),
    }), env);
    expect(res.status).toBe(403);
  });

  it('aggregate rating only counts approved reviews', async () => {
    await app.fetch(new Request('https://x/api/contributions/reviews', {
      method: 'POST', headers: auth(), body: JSON.stringify({ set_num: '111-1', rating: 5 }),
    }), env);
    let bundle = await (await app.fetch(new Request('https://x/api/contributions/sets/111-1', { headers: auth() }), env)).json<any>();
    expect(bundle.rating.count).toBe(0); // still pending

    const r = await db.prepare("SELECT id FROM set_reviews WHERE set_num='111-1'").first<any>();
    await app.fetch(new Request(`https://x/api/admin/contributions/review/${r.id}`, {
      method: 'PATCH', headers: auth(adminToken), body: JSON.stringify({ action: 'approve' }),
    }), env);
    bundle = await (await app.fetch(new Request('https://x/api/contributions/sets/111-1', { headers: auth() }), env)).json<any>();
    expect(bundle.rating.count).toBe(1);
    expect(bundle.rating.avg).toBe(5);
  });

  it('serves approved community content to guests while keeping mutations private', async () => {
    await db.prepare(
      "INSERT INTO set_reviews (user_id, set_num, rating, title, status) VALUES (?, '111-1', 5, 'Public review', 'approved')"
    ).bind(userId).run();

    const publicRes = await app.fetch(new Request('https://x/api/contributions/sets/111-1'), env);
    expect(publicRes.status).toBe(200);
    const bundle = await publicRes.json<any>();
    expect(bundle.rating.count).toBe(1);
    expect(bundle.reviews[0].title).toBe('Public review');
    expect(bundle.mine).toEqual([]);

    const privateRes = await app.fetch(new Request('https://x/api/contributions/mine'), env);
    expect(privateRes.status).toBe(401);
    const mutationRes = await app.fetch(new Request('https://x/api/contributions/reviews', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ set_num: '111-1', rating: 4 }),
    }), env);
    expect(mutationRes.status).toBe(401);
  });

  it('never exposes raw user_id in public reviews', async () => {
    // Submit + approve a review, then confirm the public bundle omits user_id and
    // only surfaces a display name when the author's profile is public.
    await app.fetch(new Request('https://x/api/contributions/reviews', {
      method: 'POST', headers: auth(), body: JSON.stringify({ set_num: '111-1', rating: 5, title: 'Nice' }),
    }), env);
    const r = await db.prepare("SELECT id FROM set_reviews WHERE set_num='111-1'").first<any>();
    await app.fetch(new Request(`https://x/api/admin/contributions/review/${r.id}`, {
      method: 'PATCH', headers: auth(adminToken), body: JSON.stringify({ action: 'approve' }),
    }), env);

    // Private profile → no display name leaked.
    let bundle = await (await app.fetch(new Request('https://x/api/contributions/sets/111-1', { headers: auth() }), env)).json<any>();
    expect(bundle.reviews.length).toBe(1);
    expect(bundle.reviews[0]).not.toHaveProperty('user_id');
    expect(bundle.reviews[0].author).toBeNull();

    // Public profile → display name surfaces, still no user_id.
    await db.prepare("INSERT INTO user_prefs (user_id, is_public, display_name) VALUES (?, 1, 'Brick Fan')").bind(userId).run();
    bundle = await (await app.fetch(new Request('https://x/api/contributions/sets/111-1', { headers: auth() }), env)).json<any>();
    expect(bundle.reviews[0]).not.toHaveProperty('user_id');
    expect(bundle.reviews[0].author).toBe('Brick Fan');
  });

  it('withdraw soft-deletes a pending submission', async () => {
    await app.fetch(new Request('https://x/api/contributions/reviews', {
      method: 'POST', headers: auth(), body: JSON.stringify({ set_num: '111-1', rating: 3 }),
    }), env);
    const r = await db.prepare("SELECT id FROM set_reviews WHERE set_num='111-1'").first<any>();
    const res = await app.fetch(new Request(`https://x/api/contributions/review/${r.id}`, {
      method: 'DELETE', headers: auth(),
    }), env);
    expect(res.status).toBe(204);
    const row = await db.prepare('SELECT deleted_at FROM set_reviews WHERE id=?').bind(r.id).first<any>();
    expect(row.deleted_at).not.toBeNull();
  });

  it('enforces the daily contribution cap', async () => {
    // Default cap is 10/day for a non-supporter; the 11th submission is rejected.
    let last: Response | undefined;
    for (let i = 0; i < 11; i++) {
      last = await app.fetch(new Request('https://x/api/contributions/data', {
        method: 'POST', headers: auth(), body: JSON.stringify({ set_num: '111-1', kind: 'metadata', payload: {}, note: `n${i}` }),
      }), env);
    }
    expect(last!.status).toBe(429);
  });
});
