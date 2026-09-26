/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import app from './index';
import { clampDays, isoDaysAgo } from './routes/changes';
import { applyTestTables } from './test-schema';

const db = (env as { DB: D1Database }).DB;
const secret = 'changes-test-secret-at-least-32-characters';
const OWNER = 'changes-owner';
const OTHER = 'changes-other';

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

async function request(query = '', userId = OWNER) {
  return app.fetch(new Request(`https://example.test/api/changes${query}`, {
    headers: { Authorization: `Bearer ${await token(userId)}` },
  }), env as any);
}

async function seedSet(setNum: string, name: string, value: number, extra: Record<string, unknown> = {}) {
  await db.prepare(`INSERT INTO lego_sets (set_num, name, theme, year, pieces, blended_value, current_value, image_url, retired)
    VALUES (?, ?, ?, 2020, 100, ?, ?, NULL, 0)`).bind(setNum, name, extra.theme ?? 'Icons', extra.blended ?? value, value).run();
}

async function hold(userId: string, setNum: string, { quantity = 1, addedDaysAgo = 60, price = null as number | null, sold = null as null | { price: number; daysAgo: number } } = {}) {
  await db.prepare(`INSERT INTO user_collection (user_id, set_num, quantity, purchase_price, added_at, deleted_at, sold_price, sold_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    userId, setNum, quantity, price, `${isoDaysAgo(addedDaysAgo)} 10:00:00`,
    sold ? `${isoDaysAgo(sold.daysAgo)} 12:00:00` : null,
    sold ? sold.price : null,
    sold ? isoDaysAgo(sold.daysAgo) : null,
  ).run();
}

async function history(setNum: string, daysAgo: number, value: number) {
  await db.prepare('INSERT INTO set_value_history (set_num, snapshot_date, current_value) VALUES (?, ?, ?)')
    .bind(setNum, isoDaysAgo(daysAgo), value).run();
}

describe('GET /api/changes — What changed digest', () => {
  beforeEach(async () => {
    (env as any).SUPABASE_JWT_SECRET = secret;
    (env as any).SUPABASE_URL = 'https://supabase.mock.io';
    (env as any).SUPABASE_ANON_KEY = 'fixture-anon-key';
    await applyTestTables(db, ['lego_sets', 'user_collection', 'set_value_history', 'set_valuation_state']);
  });

  it('requires a member and is private, no-store', async () => {
    const anonymous = await app.fetch(new Request('https://example.test/api/changes'), env as any);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('cache-control')).toBe('private, no-store');
    const res = await request();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('clamps the window and dates it from UTC midnight', () => {
    expect(clampDays(undefined)).toBe(7);
    expect(clampDays('0')).toBe(1);
    expect(clampDays('400')).toBe(90);
    expect(clampDays('nope')).toBe(7);
    expect(isoDaysAgo(3, new Date('2026-09-23T23:59:00Z'))).toBe('2026-09-20');
  });

  it('measures market movement per holding and ranks the biggest movers', async () => {
    await seedSet('10294-1', 'Titanic', 760);
    await seedSet('75192-1', 'Millennium Falcon', 850);
    await seedSet('10497-1', 'Galaxy Explorer', 88);
    await seedSet('42143-1', 'Ferrari Daytona SP3', 372);
    await hold(OWNER, '10294-1');
    await hold(OWNER, '75192-1');
    await hold(OWNER, '10497-1', { quantity: 2 });
    // Added yesterday: part of the collection, not part of the market delta.
    await hold(OWNER, '42143-1', { addedDaysAgo: 1 });
    await history('10294-1', 7, 732);
    await history('10294-1', 30, 700);
    await history('75192-1', 8, 835); // last snapshot on/before the window start
    await history('10497-1', 7, 92);
    await history('42143-1', 7, 300);

    const body = await (await request('?days=7')).json<any>();
    expect(body.days).toBe(7);
    expect(body.since).toBe(isoDaysAgo(7));
    expect(body.compared).toBe(3);
    expect(body.value_then).toBe(732 + 835 + 92 * 2);
    expect(body.value_now).toBe(760 + 850 + 88 * 2);
    expect(body.delta).toBe(28 + 15 - 8);
    expect(body.pct).toBeCloseTo((35 / (732 + 835 + 184)) * 100, 1);
    expect(body.total_now).toBe(760 + 850 + 176 + 372);
    expect(body.movers.map((m: any) => m.set_num)).toEqual(['10294-1', '75192-1', '10497-1']);
    expect(body.movers[0]).toMatchObject({ name: 'Titanic', value_then: 732, value_now: 760, delta: 28, quantity: 1 });
    expect(body.movers[0].pct).toBeCloseTo(3.83, 1);
    expect(body.movers[2]).toMatchObject({ delta: -8, quantity: 2 });
  });

  it('moves a used copy from its own used value, as the Vault prices it', async () => {
    await seedSet('10294-1', 'Titanic', 760);
    await db.prepare('UPDATE lego_sets SET ebay_used_value = 500 WHERE set_num = ?').bind('10294-1').run();
    await db.prepare("INSERT INTO set_valuation_state (set_num, condition, fair_value) VALUES ('10294-1', 'used_complete', 500)").run();
    await hold(OWNER, '10294-1');
    await db.prepare("UPDATE user_collection SET condition = 'used_good' WHERE user_id = ?").bind(OWNER).run();
    await history('10294-1', 7, 700);
    const body = await (await request('?days=7')).json<any>();
    // History tracks the sealed series (700 → 760); the used copy moves by the
    // same ratio from its own 500, never from the sealed price.
    expect(body.total_now).toBe(500);
    expect(body.value_now).toBe(500);
    expect(body.value_then).toBeCloseTo((500 * 700) / 760, 2);
    expect(body.movers[0]).toMatchObject({ set_num: '10294-1', value_now: 500 });
    expect(body.movers[0].pct).toBeCloseTo((760 / 700 - 1) * 100, 1);
  });

  it('never exposes another collector and reports no delta without history', async () => {
    await seedSet('10294-1', 'Titanic', 760);
    await hold(OTHER, '10294-1');
    await history('10294-1', 7, 700);
    const mine = await (await request('?days=7')).json<any>();
    expect(mine).toMatchObject({ value_now: null, value_then: null, delta: null, pct: null, compared: 0, total_now: 0, movers: [] });
    await hold(OWNER, '10294-1', { addedDaysAgo: 30 });
    await db.prepare('DELETE FROM set_value_history').run();
    const noHistory = await (await request('?days=3')).json<any>();
    expect(noHistory).toMatchObject({ days: 3, delta: null, compared: 0, total_now: 760, movers: [] });
  });

  it('summarizes realized gains from sold holdings with known cost', async () => {
    await seedSet('10281-1', 'Bonsai Tree', 45);
    await seedSet('10497-1', 'Galaxy Explorer', 88);
    await seedSet('21333-1', 'The Starry Night', 205);
    await hold(OWNER, '10281-1', { price: 40, sold: { price: 88, daysAgo: 20 } });
    await hold(OWNER, '21333-1', { price: null, sold: { price: 190, daysAgo: 3 } });
    await hold(OWNER, '10497-1', { price: 90 });
    const body = await (await request()).json<any>();
    expect(body.realized).toMatchObject({ gain: 48, sales: 2, priced_sales: 1, proceeds: 278 });
    expect(body.realized.items.map((s: any) => s.set_num)).toEqual(['21333-1', '10281-1']);
    expect(body.realized.items[1]).toMatchObject({ name: 'Bonsai Tree', sold_price: 88, purchase_price: 40, sold_at: isoDaysAgo(20) });
    // Sold rows are soft-deleted, so they never count as current holdings.
    expect(body.total_now).toBe(88);
  });
});
