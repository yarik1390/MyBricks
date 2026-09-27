/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bricksetSyncRoute } from './routes/brickset-sync';
import { applyTestTables } from './test-schema';

declare module 'cloudflare:test' {
  interface ProvidedEnv { DB: D1Database }
}

const secret = 'brickset-sync-test-secret-at-least-32-chars';
const user = 'brickset-owner';
let db: D1Database;
let token: string;

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

function sync() {
  return bricksetSyncRoute.fetch(new Request('http://local/sync', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  }), env as any, ctx);
}

describe('Brickset sync counts', () => {
  beforeEach(async () => {
    (env as any).SUPABASE_JWT_SECRET = secret;
    (env as any).SUPABASE_URL = 'https://supabase.mock.io';
    (env as any).BRICKSET_API_KEY = 'test-key';
    db = (env as any).DB;
    token = await jwt(user);
    await applyTestTables(db, ['lego_sets', 'user_collection', 'user_prefs']);
    await db.batch([
      db.prepare("INSERT INTO lego_sets (set_num, name) VALUES ('10497-1', 'Galaxy Explorer')"),
      db.prepare("INSERT INTO lego_sets (set_num, name) VALUES ('21318-1', 'Tree House')"),
      db.prepare("INSERT INTO lego_sets (set_num, name) VALUES ('75192-1', 'Millennium Falcon')"),
      db.prepare("INSERT INTO user_prefs (user_id, brickset_user_hash) VALUES (?, 'hash')").bind(user),
      db.prepare("INSERT INTO user_collection (user_id, set_num) VALUES (?, '75192-1')").bind(user),
    ]);
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      status: 'success',
      sets: [
        { setID: 1, number: '10497', numberVariant: 1, name: 'Galaxy Explorer', year: 2022, owned: true },
        { setID: 2, number: '21318', numberVariant: 1, name: 'Tree House', year: 2019, owned: true },
        { setID: 3, number: '75192', numberVariant: 1, name: 'Millennium Falcon', year: 2017, owned: true },
        { setID: 4, number: '99999', numberVariant: 1, name: 'Not catalogued', year: 2026, owned: true },
      ],
    }), { headers: { 'Content-Type': 'application/json' } }));
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('tells sets already in the vault apart from sets missing from the catalog', async () => {
    const first = await (await sync()).json<any>();
    expect(first).toMatchObject({ added: 2, unknown: 1, already: 1, skipped: 2, total: 4 });
    expect(first.added_set_nums.sort()).toEqual(['10497-1', '21318-1']);

    // A repeat sync adds nothing and misses nothing new: everything is a duplicate.
    const again = await (await sync()).json<any>();
    expect(again).toMatchObject({ added: 0, unknown: 1, already: 3, added_set_nums: [] });
  });
});
