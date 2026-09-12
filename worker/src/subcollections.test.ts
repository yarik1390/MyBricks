/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import app from './index';
import { USER_SCOPED_TABLES } from './routes/me';
import { applyTestTables } from './test-schema';

const db = (env as { DB: D1Database }).DB;
const secret = 'subcollections-test-secret-at-least-32-chars';
const OWNER = 'subcollections-owner';
const OTHER = 'subcollections-other';
const ID = '11111111-1111-4111-8111-111111111111';

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

async function request(path = '', init: RequestInit = {}, userId = OWNER) {
  return app.fetch(new Request(`https://example.test/api/subcollections${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await token(userId)}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  }), env as any);
}

describe('owner-private named subcollections', () => {
  beforeEach(async () => {
    (env as any).SUPABASE_JWT_SECRET = secret;
    (env as any).SUPABASE_URL = 'https://supabase.mock.io';
    (env as any).SUPABASE_ANON_KEY = 'fixture-anon-key';
    await applyTestTables(db, ['user_subcollections']);
  });

  it('requires member auth, applies private no-store, and never exposes another owner', async () => {
    const anonymous = await app.fetch(new Request('https://example.test/api/subcollections'), env as any);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('cache-control')).toBe('private, no-store');
    const created = await request(`/${ID}`, { method: 'PUT', body: JSON.stringify({ name: 'Mine', set_nums: ['123'], revision: 0 }) });
    expect(created.status).toBe(200);
    expect(created.headers.get('cache-control')).toBe('private, no-store');
    expect(await (await request('', {}, OTHER)).json()).toEqual({ subcollections: [] });
    expect((await request(`/${ID}`, { method: 'PUT', body: JSON.stringify({ name: 'Changed', set_nums: [], revision: 1 }) }, OTHER)).status).toBe(404);
  });

  it('creates, normalizes, edits, detects stale revisions, and deletes', async () => {
    const created = await request(`/${ID.toUpperCase()}`, { method: 'PUT', body: JSON.stringify({ name: '  Build Queue  ', set_nums: ['123', '123-1', 'ABC_2', 'ABC_2'], revision: 0 }) });
    const createdBody = await created.json<any>();
    expect(createdBody.subcollection).toMatchObject({ id: ID, name: 'Build Queue', set_nums: ['123-1', 'ABC_2'], revision: 1 });
    const edited = await request(`/${ID}`, { method: 'PUT', body: JSON.stringify({ name: 'Completed', set_nums: [], revision: 1 }) });
    expect(await edited.json()).toMatchObject({ subcollection: { name: 'Completed', revision: 2 } });
    const stale = await request(`/${ID}`, { method: 'PUT', body: JSON.stringify({ name: 'Stale', set_nums: [], revision: 1 }) });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'stale_revision', revision: 2 });
    expect((await request(`/${ID}`, { method: 'DELETE', body: JSON.stringify({ revision: 2 }) })).status).toBe(204);
  });

  it('rejects malformed writes and enforces the 50-list owner quota', async () => {
    const invalid = [
      ['/not-a-uuid', { name: 'List', set_nums: [], revision: 0 }],
      [`/${ID}`, { name: ' ', set_nums: [], revision: 0 }],
      [`/${ID}`, { name: 'List', set_nums: ['bad set'], revision: 0 }],
      [`/${ID}`, { name: 'List', set_nums: Array(201).fill('123'), revision: 0 }],
      [`/${ID}`, { name: 'List', set_nums: [], revision: Number.MAX_SAFE_INTEGER }],
    ] as const;
    for (const [path, body] of invalid) expect((await request(path, { method: 'PUT', body: JSON.stringify(body) })).status).toBe(400);
    await db.batch(Array.from({ length: 50 }, (_, index) => db.prepare(`INSERT INTO user_subcollections
      (user_id,id,name,set_nums,revision) VALUES (?1,?2,?3,'[]',1)`)
      .bind(OWNER, `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, `List ${index}`)));
    const over = await request('/22222222-2222-4222-8222-222222222222', { method: 'PUT', body: JSON.stringify({ name: 'Too many', set_nums: [], revision: 0 }) });
    expect(over.status).toBe(400);
    expect(await over.json()).toMatchObject({ code: 'subcollection_limit' });
  });

  it('registers the new table with the target account deletion purge', () => {
    expect(USER_SCOPED_TABLES).toContain('user_subcollections');
  });
});
