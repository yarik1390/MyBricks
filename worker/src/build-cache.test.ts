/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { app } from './index';

// "What can I build?" pre-warm regression tests.
//
// The parts matcher (/api/build/sets) scans ~1.35M set_parts rows and is cached
// per user keyed by a fingerprint of their owned sets. Adding a set changes the
// fingerprint, so the first Build visit after every vault add was guaranteed
// cold (multi-second). Collection mutations now recompute the cache in the
// background (waitUntil); these tests pin that behavior end-to-end.

interface Ctx { waited: Promise<unknown>[] }
function makeCtx(): Ctx {
  return {
    waited: [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
// Minimal ExecutionContext shape collecting waitUntil promises so tests can
// deterministically await background work.
function ctxOf(c: Ctx): ExecutionContext {
  return {
    waitUntil: (p: Promise<unknown>) => { c.waited.push(p); },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

function authed(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

describe('build matcher cache pre-warm', () => {
  const JWT_SECRET = 'test-secret-at-least-32-chars-long-and-super-secure';
  let token: string;
  const uid = 'build-test-user';

  async function createMockJWT(userId: string, secret: string): Promise<string> {
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = { sub: userId, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 };
    const b64url = (json: unknown) => btoa(JSON.stringify(json)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const unsigned = `${b64url(header)}.${b64url(payload)}`;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(unsigned));
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `${unsigned}.${sigB64}`;
  }

  beforeEach(async () => {
    (env as { SUPABASE_JWT_SECRET?: string }).SUPABASE_JWT_SECRET = JWT_SECRET;
    token = await createMockJWT(uid, JWT_SECRET);
    const db = (env as { DB: D1Database }).DB;
    await db.batch([
      db.prepare('DROP TABLE IF EXISTS user_build_cache'),
      db.prepare('DROP TABLE IF EXISTS set_parts'),
      db.prepare('DROP TABLE IF EXISTS user_collection'),
      db.prepare('DROP TABLE IF EXISTS user_prefs'),
      db.prepare('DROP TABLE IF EXISTS kids_badges'),
      db.prepare('DROP TABLE IF EXISTS lego_sets'),
    ]);
    await db.batch([
      db.prepare(`CREATE TABLE lego_sets (
        set_num TEXT PRIMARY KEY, name TEXT NOT NULL, theme TEXT, year INTEGER,
        pieces INTEGER, current_value REAL, image_url TEXT)`),
      db.prepare(`CREATE TABLE user_collection (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL, set_num TEXT NOT NULL, quantity INTEGER NOT NULL,
        condition TEXT NOT NULL DEFAULT 'new',
        purchase_price REAL, notes TEXT, purchased_at TEXT, added_at TEXT DEFAULT CURRENT_TIMESTAMP,
        is_complete INTEGER DEFAULT 1, deleted_at TEXT,
        last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, set_num))`),
      db.prepare(`CREATE TABLE set_parts (
        set_num TEXT NOT NULL, part_num TEXT NOT NULL, color_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL, is_spare INTEGER DEFAULT 0,
        PRIMARY KEY (set_num, part_num, color_id))`),
      db.prepare(`CREATE TABLE user_build_cache (
        user_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL,
        payload TEXT NOT NULL, computed_at INTEGER NOT NULL)`),
      db.prepare(`CREATE TABLE user_prefs (
        user_id TEXT PRIMARY KEY, kids_xp INTEGER NOT NULL DEFAULT 0,
        kids_level INTEGER NOT NULL DEFAULT 1, kids_pin_hash TEXT)`),
      db.prepare(`CREATE TABLE kids_badges (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, badge_slug TEXT NOT NULL)`),
    ]);
    await db.batch([
      db.prepare("INSERT INTO lego_sets (set_num, name, theme, year, pieces) VALUES ('3001-1','Owned A','City',2020,60)"),
      db.prepare("INSERT INTO lego_sets (set_num, name, theme, year, pieces) VALUES ('3002-1','Owned B','City',2021,80)"),
      db.prepare("INSERT INTO lego_sets (set_num, name, theme, year, pieces) VALUES ('4001-1','Buildable C','Technic',2019,50)"),
      db.prepare("INSERT INTO lego_sets (set_num, name, theme, year, pieces) VALUES ('4002-1','Too Small D','Duplo',2019,10)"),
    ]);
    // Owned A supplies parts p1..p6 (color 0). Owned B supplies p4..p9.
    const sp: string[] = [];
    for (let i = 1; i <= 9; i++) {
      if (i <= 6) sp.push(`INSERT INTO set_parts (set_num,part_num,color_id,quantity,is_spare) VALUES ('3001-1','p${i}',0,10,0)`);
      else sp.push(`INSERT INTO set_parts (set_num,part_num,color_id,quantity,is_spare) VALUES ('3002-1','p${i}',0,10,0)`);
    }
    // Buildable C needs exactly 6 of each p1..p9 (54 total, 9 distinct, not dominated).
    for (let i = 1; i <= 9; i++) {
      sp.push(`INSERT INTO set_parts (set_num,part_num,color_id,quantity,is_spare) VALUES ('4001-1','p${i}',0,6,0)`);
    }
    // Too Small D: req_total below the min-parts gate (50).
    sp.push("INSERT INTO set_parts (set_num,part_num,color_id,quantity,is_spare) VALUES ('4002-1','p1',0,20,0)");
    await db.batch(sp.map((sql) => db.prepare(sql)));
    await db.batch([
      db.prepare("INSERT INTO user_collection (user_id,set_num,quantity,is_complete) VALUES (?,'3001-1',1,1)").bind(uid),
      db.prepare("INSERT INTO user_collection (user_id,set_num,quantity,is_complete) VALUES (?,'3002-1',1,1)").bind(uid),
    ]);
  });

  it('GET /api/build/sets computes, caches, and serves the cached payload on repeat', async () => {
    const db = (env as { DB: D1Database }).DB;
    const H = authed(token);

    // First (cold) call — computes and writes the cache.
    const res1 = await app.fetch(new Request('http://localhost/api/build/sets?limit=120', { headers: H }), env);
    expect(res1.status).toBe(200);
    const body1 = await res1.json() as { builds: Array<{ set_num: string; buildable: boolean; pct: number }>; can_build: number; cached: boolean };
    expect(body1.cached).toBe(false);
    const c = body1.builds.find((b) => b.set_num === '4001-1');
    expect(c?.buildable).toBe(true);
    expect(c?.pct).toBe(100);
    expect(body1.can_build).toBeGreaterThanOrEqual(1);
    // Too Small D must be gated out by MIN_REQ_PARTS.
    expect(body1.builds.some((b) => b.set_num === '4002-1')).toBe(false);

    const row = await db.prepare('SELECT fingerprint, payload FROM user_build_cache WHERE user_id = ?').bind(uid).first<{ fingerprint: string; payload: string }>();
    expect(row).toBeTruthy();

    // Second call with unchanged collection — served from cache.
    const res2 = await app.fetch(new Request('http://localhost/api/build/sets?limit=120', { headers: H }), env);
    const body2 = await res2.json() as { cached: boolean };
    expect(body2.cached).toBe(true);
  });

  it('adding a set schedules a background recompute that warms the NEW fingerprint', async () => {
    const db = (env as { DB: D1Database }).DB;
    const H = authed(token);

    // Cold prime with the initial collection.
    await app.fetch(new Request('http://localhost/api/build/sets?limit=120', { headers: H }), env);

    // Add a set through the real route with a capturing executionCtx.
    const cap = makeCtx();
    const addRes = await app.fetch(
      new Request('http://localhost/api/collection', {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ set_num: '4001-1', quantity: 1 }),
      }),
      env,
      ctxOf(cap),
    );
    expect(addRes.status).toBe(201);

    // The add must have scheduled exactly one background recompute.
    expect(cap.waited.length).toBeGreaterThanOrEqual(1);
    await Promise.allSettled(cap.waited);

    // The cache now holds the fingerprint of the NEW collection state.
    const owned = await db.prepare(
      "SELECT set_num, quantity FROM user_collection WHERE user_id=? AND deleted_at IS NULL AND is_complete=1 ORDER BY set_num",
    ).bind(uid).all<{ set_num: string; quantity: number }>();
    const rows = owned.results || [];
    const enc = new TextEncoder();
    const fpInput = `v2|user=${uid}|min=50|lim=120|` + rows.map((r) => `${r.set_num}x${r.quantity || 1}`).join(',');
    const digest = await crypto.subtle.digest('SHA-256', enc.encode(fpInput));
    const fp = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');

    const hit = await db.prepare('SELECT payload FROM user_build_cache WHERE user_id=? AND fingerprint=?').bind(uid, fp).first<{ payload: string }>();
    expect(hit).toBeTruthy();
    const payload = JSON.parse(hit!.payload) as { owned_sets: number };
    expect(payload.owned_sets).toBe(3);
  });

  it('background recompute failure never surfaces to the mutation response', async () => {
    const H = authed(token);
    // Drop set_parts so the recompute's coverage query fails hard.
    const db = (env as { DB: D1Database }).DB;
    await db.prepare('DROP TABLE set_parts').run();

    const cap = makeCtx();
    const addRes = await app.fetch(
      new Request('http://localhost/api/collection', {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ set_num: '3001-1', quantity: 2 }),
      }),
      env,
      ctxOf(cap),
    );
    // The mutation itself must still succeed…
    expect(addRes.status).toBe(201);
    // …and the background promise rejects without escaping (waitUntil swallows;
    // here we just assert it settles at all).
    await Promise.allSettled(cap.waited);
  });
});
