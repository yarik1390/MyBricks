/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import app from './index';
import { applyTestTables } from './test-schema';
import { aggregateCopies } from './lib/holding-copies';

const db = (env as { DB: D1Database }).DB;
const secret = 'copies-test-secret-at-least-32-characters!';
const OWNER = 'copies-owner';
const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException: () => {} } as any;

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

async function call(method: string, path: string, body?: unknown, userId = OWNER) {
  const res = await app.fetch(new Request(`https://example.test/api/collection${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token(userId)}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env as any, ctx);
  return { status: res.status, body: res.status === 204 ? null : await res.json() as any };
}

async function holdingId(): Promise<number> {
  const row = await db.prepare('SELECT id FROM user_collection WHERE user_id=? AND set_num=? AND deleted_at IS NULL').bind(OWNER, '10305-1').first<{ id: number }>();
  return row!.id;
}

describe('aggregateCopies', () => {
  it('averages priced copies, takes the earliest date and the most common condition', () => {
    const agg = aggregateCopies([
      { condition: 'sealed', purchase_price: 300, purchased_at: '2024-05-01', storage_location: 'Shelf A', acquisition_source: null },
      { condition: 'used_good', purchase_price: null, purchased_at: '2023-01-10', storage_location: 'Shelf A', acquisition_source: null },
      { condition: 'sealed', purchase_price: 340, purchased_at: null, storage_location: 'Shelf B', acquisition_source: null },
    ]);
    expect(agg).toEqual({ quantity: 3, purchase_price: 320, purchased_at: '2023-01-10', condition: 'sealed', storage_location: null, acquisition_source: null });
  });
});

describe('per-copy tracking', () => {
  beforeEach(async () => {
    (env as any).SUPABASE_JWT_SECRET = secret;
    (env as any).SUPABASE_URL = 'https://supabase.mock.io';
    (env as any).SUPABASE_ANON_KEY = 'fixture-anon-key';
    await applyTestTables(db, ['lego_sets', 'user_collection', 'holding_copies', 'realized_sales', 'set_value_history', 'user_prefs']);
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, current_value) VALUES ('10305-1', 'Lion Knights Castle', 2022, 450)`).run();
    await db.prepare(`INSERT INTO user_collection (user_id, set_num, quantity, condition, purchase_price, purchased_at)
      VALUES (?, '10305-1', 2, 'sealed', 400, '2023-02-01')`).bind(OWNER).run();
  });

  it('materializes one copy per unit on first read, owner only', async () => {
    const id = await holdingId();
    const other = await call('GET', `/${id}/copies`, undefined, 'intruder');
    expect(other.status).toBe(404);
    const { status, body } = await call('GET', `/${id}/copies`);
    expect(status).toBe(200);
    expect(body.copies).toHaveLength(2);
    expect(body.copies[0]).toMatchObject({ condition: 'sealed', purchase_price: 400, purchased_at: '2023-02-01' });
    // Reading again doesn't duplicate.
    expect((await call('GET', `/${id}/copies`)).body.copies).toHaveLength(2);
  });

  it('adds and edits copies and keeps the holding as their aggregate', async () => {
    const id = await holdingId();
    await call('GET', `/${id}/copies`);
    const added = await call('POST', `/${id}/copies`, { condition: 'used_good', purchase_price: 250 });
    expect(added.status).toBe(201);
    expect(added.body.item).toMatchObject({ quantity: 3, purchase_price: 350, condition: 'sealed' });
    const copyId = added.body.copies[0].id;
    const edited = await call('PATCH', `/${id}/copies/${copyId}`, { purchase_price: 100, storage_location: 'Attic' });
    expect(edited.body.item.purchase_price).toBe(250);
    expect((await call('PATCH', `/${id}/copies/${copyId}`, { condition: 'mint' })).status).toBe(400);
  });

  it('sells one copy into the ledger and sells the holding with the last copy', async () => {
    const id = await holdingId();
    const { body } = await call('GET', `/${id}/copies`);
    const [first, second] = body.copies;
    await call('PATCH', `/${id}/copies/${second.id}`, { purchase_price: 420 });
    const sold = await call('POST', `/${id}/copies/${first.id}/sell`, { sold_price: 500, sold_at: '2026-09-01', sold_fees: 50 });
    expect(sold.status).toBe(200);
    expect(sold.body.item).toMatchObject({ quantity: 1, purchase_price: 420 });
    const last = await call('POST', `/${id}/copies/${second.id}/sell`, { sold_price: 520, sold_at: '2026-09-15' });
    expect(last.body.item).toBeNull();
    const sales = await db.prepare('SELECT quantity, cost_basis, sold_price, sold_fees, source, value_at_sale FROM realized_sales WHERE user_id=? ORDER BY id').bind(OWNER).all();
    expect(sales.results).toEqual([
      { quantity: 1, cost_basis: 400, sold_price: 500, sold_fees: 50, source: 'copy', value_at_sale: 450 },
      { quantity: 1, cost_basis: 420, sold_price: 520, sold_fees: null, source: 'copy', value_at_sale: 450 },
    ]);
    const h = await db.prepare('SELECT sold_price, purchase_price, quantity, deleted_at FROM user_collection WHERE id=?').bind(id).first<any>();
    expect(h).toMatchObject({ sold_price: 520, purchase_price: 420, quantity: 1 });
    expect(h.deleted_at).not.toBeNull();
  });

  it('keeps copies in step with the quantity stepper and holding-level edits', async () => {
    const id = await holdingId();
    await call('GET', `/${id}/copies`);
    await call('PATCH', `/${id}`, { quantity: 4 });
    expect((await call('GET', `/${id}/copies`)).body.copies).toHaveLength(4);
    await call('PATCH', `/${id}`, { quantity: 1, purchase_price: 380 });
    const { body } = await call('GET', `/${id}/copies`);
    expect(body.copies).toHaveLength(1);
    expect(body.copies[0].purchase_price).toBe(380);
    expect(body.item).toMatchObject({ quantity: 1, purchase_price: 380 });
  });

  it('refuses to delete the only copy', async () => {
    const id = await holdingId();
    const { body } = await call('GET', `/${id}/copies`);
    expect((await call('DELETE', `/${id}/copies/${body.copies[0].id}`)).status).toBe(200);
    const again = await call('GET', `/${id}/copies`);
    expect((await call('DELETE', `/${id}/copies/${again.body.copies[0].id}`)).status).toBe(409);
  });

  it('records whole-holding sales in the ledger and clears them when the set is added again', async () => {
    const sold = await call('POST', '/sell', { set_num: '10305-1', sold_price: 1000, sold_at: '2026-08-01', sold_fees: 80 });
    expect(sold.status).toBe(200);
    const ledger = await db.prepare('SELECT quantity, cost_basis, source FROM realized_sales WHERE user_id=?').bind(OWNER).first();
    expect(ledger).toEqual({ quantity: 2, cost_basis: 800, source: 'holding' });
    const again = await call('POST', '', { set_num: '10305-1', quantity: 1 });
    expect(again.status).toBe(201);
    expect(again.body.item).toMatchObject({ sold_price: null, sold_at: null, sold_fees: null, quantity: 1 });
  });
});
