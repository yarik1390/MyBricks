/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import app from './index';
import { applyTestTables } from './test-schema';
import { mergeWantedParts, toBrickLinkXml, toRebrickableCsv } from './lib/wanted-list';

const db = (env as { DB: D1Database }).DB;
const secret = 'wanted-list-test-secret-at-least-32-chars';
const OWNER = 'wanted-owner';

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

async function get(path: string, userId = OWNER) {
  return app.fetch(new Request(`https://example.test/api/wanted-list${path}`, {
    headers: { Authorization: `Bearer ${await token(userId)}` },
  }), env as any, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
}

describe('wanted-list formatters', () => {
  it('merges duplicate part+color rows and drops empty ones', () => {
    const merged = mergeWantedParts([
      { part_num: '3001', color_id: 4, quantity: 2 },
      { part_num: '3001', color_id: 4, quantity: 3 },
      { part_num: '3002', color_id: 0, quantity: 0 },
    ]);
    expect(merged).toEqual([{ part_num: '3001', color_id: 4, quantity: 5 }]);
  });

  it('writes Rebrickable CSV with quoted cells when needed', () => {
    expect(toRebrickableCsv([{ part_num: '973pr1,a', color_id: 15, quantity: 1 }]))
      .toBe('Part,Color,Quantity\n"973pr1,a",15,1\n');
  });

  it('writes BrickLink XML with translated colors and skips colors BrickLink lacks', () => {
    const { xml, skipped } = toBrickLinkXml(
      [{ part_num: '3001', color_id: 0, quantity: 2 }, { part_num: '3003', color_id: 999, quantity: 1 }],
      (id) => (id === 0 ? 11 : null),
    );
    expect(skipped).toBe(1);
    expect(xml).toContain('<ITEMID>3001</ITEMID>');
    expect(xml).toContain('<COLOR>11</COLOR>');
    expect(xml).toContain('<MINQTY>2</MINQTY>');
    expect(xml).not.toContain('3003');
  });
});

describe('GET /api/wanted-list', () => {
  beforeEach(async () => {
    (env as any).SUPABASE_JWT_SECRET = secret;
    (env as any).SUPABASE_URL = 'https://supabase.mock.io';
    (env as any).SUPABASE_ANON_KEY = 'fixture-anon-key';
    (env as any).REBRICKABLE_API_KEY = '';
    await applyTestTables(db, ['lego_sets', 'user_collection', 'set_parts', 'user_missing_parts']);
    for (const s of ['A-1', 'B-1', 'T-1']) {
      await db.prepare('INSERT INTO lego_sets (set_num, name, year) VALUES (?, ?, 2020)').bind(s, s).run();
    }
    await db.prepare('INSERT INTO user_collection (user_id, set_num, quantity) VALUES (?, ?, 1), (?, ?, 2)')
      .bind(OWNER, 'A-1', OWNER, 'B-1').run();
    await db.prepare(`INSERT INTO set_parts (set_num, part_num, color_id, quantity, is_spare, part_name) VALUES
      ('A-1','3001',4,4,0,'Brick 2x4'), ('B-1','3001',4,1,0,'Brick 2x4'), ('B-1','3023',0,2,0,'Plate 1x2'),
      ('T-1','3001',4,10,0,'Brick 2x4'), ('T-1','3023',0,3,0,'Plate 1x2'), ('T-1','3024',15,1,0,'Plate 1x1'), ('T-1','3070',1,9,1,'Tile 1x1')`).run();
    await db.prepare(`INSERT INTO user_missing_parts (user_id, set_num, part_num, color_id, missing_qty) VALUES
      (?, 'A-1', '3001', 4, 2), (?, 'B-1', '3001', 4, 1), ('someone-else', 'A-1', '3023', 0, 5)`).bind(OWNER, OWNER).run();
  });

  it('requires a member', async () => {
    const res = await app.fetch(new Request('https://example.test/api/wanted-list'), env as any);
    expect(res.status).toBe(401);
  });

  it('merges the missing parts marked across owned sets, only for this user', async () => {
    const body = await (await get('')).json() as any;
    expect(body.count).toBe(1);
    expect(body.pieces).toBe(3);
    expect(body.parts[0]).toMatchObject({ part_num: '3001', color_id: 4, quantity: 3 });
  });

  it('limits to one set and returns a Rebrickable file', async () => {
    const body = await (await get('?set=A-1&format=rebrickable')).json() as any;
    expect(body.file.name).toBe('missing-A-1-rebrickable.csv');
    expect(body.file.content).toBe('Part,Color,Quantity\n3001,4,2\n');
  });

  it('computes the shortfall to build a set from owned parts, ignoring spares', async () => {
    // Owned pool: 3001/4 = 4 + 1*2 = 6, 3023/0 = 2*2 = 4. T-1 needs 10, 3, 1.
    const body = await (await get('/build/T-1')).json() as any;
    expect(body.parts).toEqual([
      expect.objectContaining({ part_num: '3001', color_id: 4, quantity: 4 }),
      expect.objectContaining({ part_num: '3024', color_id: 15, quantity: 1 }),
    ]);
  });
});
