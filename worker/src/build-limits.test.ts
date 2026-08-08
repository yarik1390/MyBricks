/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import app from './index';

declare module 'cloudflare:test' {
  interface ProvidedEnv { DB: D1Database }
}

async function createMockJWT(userId: string, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { sub: userId, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 };
  const b64url = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsigned = `${b64url(header)}.${b64url(payload)}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(unsigned));
  const encoded = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${unsigned}.${encoded}`;
}

describe('build routes with large collections', () => {
  const secret = 'test-secret-at-least-32-chars-long-and-super-secure';
  const userId = 'large-collector';
  const db = (env as any).DB as D1Database;
  let token: string;

  beforeEach(async () => {
    Object.assign(env as any, {
      SUPABASE_JWT_SECRET: secret,
      SUPABASE_URL: 'https://supabase.mock.io',
      SUPABASE_ANON_KEY: 'supabase-anon-key-mock',
      REBRICKABLE_API_KEY: '',
    });
    token = await createMockJWT(userId, secret);
    for (const sql of [
      'DROP TABLE IF EXISTS set_alt_builds',
      'DROP TABLE IF EXISTS set_alts_fetched',
      'DROP TABLE IF EXISTS user_collection',
      'DROP TABLE IF EXISTS lego_sets',
      'CREATE TABLE lego_sets (set_num TEXT PRIMARY KEY, name TEXT, image_url TEXT)',
      'CREATE TABLE user_collection (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, set_num TEXT, quantity INTEGER DEFAULT 1, is_complete INTEGER DEFAULT 1, deleted_at DATETIME)',
      'CREATE TABLE set_alts_fetched (set_num TEXT PRIMARY KEY, fetched_at DATETIME, alt_count INTEGER)',
      'CREATE TABLE set_alt_builds (set_num TEXT, moc_num TEXT, name TEXT, num_parts INTEGER, year INTEGER, designer TEXT, moc_img_url TEXT, moc_url TEXT, cached_at DATETIME, PRIMARY KEY (set_num, moc_num))',
    ]) await db.prepare(sql).run();

    const statements: D1PreparedStatement[] = [];
    for (let i = 0; i < 101; i++) {
      const setNum = `owned-${i}`;
      statements.push(db.prepare('INSERT INTO lego_sets (set_num, name) VALUES (?, ?)').bind(setNum, `Owned ${i}`));
      statements.push(db.prepare('INSERT INTO user_collection (user_id, set_num) VALUES (?, ?)').bind(userId, setNum));
      statements.push(db.prepare("INSERT INTO set_alts_fetched (set_num, fetched_at, alt_count) VALUES (?, datetime('now'), 0)").bind(setNum));
    }
    for (let i = 0; i < statements.length; i += 200) await db.batch(statements.slice(i, i + 200));
    await db.prepare("INSERT INTO set_alt_builds (set_num, moc_num, name, num_parts) VALUES ('owned-100', 'MOC-1', 'Large collection build', 500)").run();
  });

  it('does not exceed D1\'s 100-bound-parameter query limit', async () => {
    const res = await app.fetch(new Request('https://x/api/build', {
      headers: { Authorization: `Bearer ${token}` },
    }), env);
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.owned_sets).toBe(101);
    expect(body.indexing).toBe(0);
    expect(body.total).toBe(1);
    expect(body.builds[0].moc_num).toBe('MOC-1');
  });
});
