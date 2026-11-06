/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import app from './index';
import { applyTestTables } from './test-schema';
import { dayIsCurrent, gameAnswer } from './routes/kids';

const db = (env as { DB: D1Database }).DB;
const secret = 'kids-play-test-secret-at-least-32-chars-long';
const KID = 'kids-play-user';
const OTHER = 'kids-play-other';

async function token(userId: string): Promise<string> {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: userId, role: 'authenticated', aud: 'authenticated',
    iss: 'https://supabase.mock.io/auth/v1', exp: Math.floor(Date.now() / 1000) + 3600,
  })}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}`;
}

async function call(path: string, body?: unknown, userId = KID) {
  const res = await app.fetch(new Request(`https://example.test/api/kids${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${await token(userId)}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env as any);
  return { status: res.status, json: await res.json().catch(() => null) as any };
}

const today = new Date().toISOString().slice(0, 10);

describe('Kids play layer', () => {
  beforeEach(async () => {
    (env as any).SUPABASE_JWT_SECRET = secret;
    (env as any).SUPABASE_URL = 'https://supabase.mock.io';
    (env as any).SUPABASE_ANON_KEY = 'fixture-anon-key';
    await applyTestTables(db, ['lego_sets', 'user_collection', 'user_prefs']);
    for (const t of ['kids_badges', 'kids_set_marks', 'kids_game_plays']) await db.prepare(`DROP TABLE IF EXISTS ${t}`).run();
    await db.prepare(`CREATE TABLE kids_badges (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, badge_slug TEXT NOT NULL, awarded_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, badge_slug))`).run();
    await db.prepare(`CREATE TABLE kids_set_marks (user_id TEXT NOT NULL, set_num TEXT NOT NULL, built INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0, built_xp INTEGER NOT NULL DEFAULT 0, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, set_num))`).run();
    await db.prepare(`CREATE TABLE kids_game_plays (user_id TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, set_a TEXT NOT NULL, set_b TEXT NOT NULL, pick TEXT NOT NULL, correct INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, day))`).run();
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, theme, year, pieces, minifigs) VALUES ('60001-1', 'Fire Truck', 'City', 2020, 500, 3)`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, theme, year, pieces, minifigs) VALUES ('60002-1', 'Police Car', 'City', 2015, 200, 2)`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, theme, year, pieces, minifigs) VALUES ('60003-1', 'Boat', 'City', 2018, 300, 1)`),
      db.prepare(`INSERT INTO user_collection (user_id, set_num) VALUES ('${KID}', '60001-1')`),
      db.prepare(`INSERT INTO user_collection (user_id, set_num) VALUES ('${KID}', '60002-1')`),
      db.prepare(`INSERT INTO user_collection (user_id, set_num) VALUES ('${OTHER}', '60003-1')`),
    ]);
  });

  it('requires sign-in', async () => {
    const res = await app.fetch(new Request('https://example.test/api/kids/state'), env as any);
    expect(res.status).toBe(401);
  });

  it('"I built it!" gives XP once per set, and favourite needs an owned set', async () => {
    const first = await call('/mark', { set_num: '60001-1', built: true });
    expect(first.status).toBe(200);
    expect(first.json.xp_gained).toBe(5);
    await call('/mark', { set_num: '60001-1', built: false });
    const again = await call('/mark', { set_num: '60001-1', built: true });
    expect(again.json.xp_gained).toBe(0);
    const fav = await call('/mark', { set_num: '60001-1', favorite: true });
    expect(fav.json).toMatchObject({ built: true, favorite: true });
    expect((await call('/mark', { set_num: '60003-1', favorite: true })).status).toBe(404);
    const state = await call('/state');
    expect(state.json.xp).toBe(5);
    expect(state.json.marks).toEqual([{ set_num: '60001-1', built: true, favorite: true }]);
  });

  it('daily game checks the answer, pays XP and only once per day', async () => {
    const body = { day: today, kind: 'pieces', set_a: '60001-1', set_b: '60002-1', pick: '60001-1' };
    const win = await call('/game', body);
    expect(win.status).toBe(200);
    expect(win.json).toMatchObject({ correct: true, answer: '60001-1', xp_gained: 5 });
    expect(win.json.values).toEqual({ '60001-1': 500, '60002-1': 200 });
    expect((await call('/game', body)).status).toBe(409);
    const state = await call('/state');
    expect(state.json.plays).toHaveLength(1);
    expect(state.json.plays[0]).toMatchObject({ day: today, correct: true });
  });

  it('game rejects sets the kid does not own, bad picks and old days', async () => {
    expect((await call('/game', { day: today, kind: 'pieces', set_a: '60001-1', set_b: '60003-1', pick: '60001-1' })).status).toBe(404);
    expect((await call('/game', { day: today, kind: 'pieces', set_a: '60001-1', set_b: '60002-1', pick: '60003-1' })).status).toBe(400);
    expect((await call('/game', { day: '2020-01-01', kind: 'pieces', set_a: '60001-1', set_b: '60002-1', pick: '60001-1' })).status).toBe(400);
    const wrong = await call('/game', { day: today, kind: 'older', set_a: '60001-1', set_b: '60002-1', pick: '60001-1' });
    expect(wrong.json).toMatchObject({ correct: false, answer: '60002-1', xp_gained: 2 });
  });

  it('stores badge slugs and ignores junk', async () => {
    const res = await call('/badges', { slugs: ['built_1', 'fan_city', 'BAD SLUG', 42] });
    expect(res.json.saved).toBe(2);
    expect((await call('/state')).json.badges.sort()).toEqual(['built_1', 'fan_city']);
    expect((await call('/state', undefined, OTHER)).json.badges).toEqual([]);
  });

  it('pure helpers', () => {
    expect(dayIsCurrent(today)).toBe(true);
    expect(dayIsCurrent('2020-01-01')).toBe(false);
    expect(gameAnswer('minifigs', { set_num: 'a', pieces: 1, year: 2000, minifigs: 0 }, { set_num: 'b', pieces: 1, year: 2000, minifigs: 2 })).toBe('b');
  });
});
