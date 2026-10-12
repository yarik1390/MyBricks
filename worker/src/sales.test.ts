/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import app from './index';
import { applyTestTables } from './test-schema';
import { summarizeSales, valueCheck } from './routes/sales';

const db = (env as { DB: D1Database }).DB;
const secret = 'sales-test-secret-at-least-32-characters!!';
const OWNER = 'sales-owner';
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

async function call(method: string, path: string, userId: string | null = OWNER) {
  const headers: Record<string, string> = {};
  if (userId) headers.Authorization = `Bearer ${await token(userId)}`;
  const res = await app.fetch(new Request(`https://example.test/api/sales${path}`, { method, headers }), env as any, ctx);
  return { status: res.status, body: await res.json() as any };
}

describe('summarizeSales', () => {
  it('nets fees, splits short and long term and counts sales without a cost', () => {
    const { rows, summary } = summarizeSales([
      { id: 1, set_num: 'a', name: null, quantity: 1, condition: 'sealed', purchased_at: '2024-01-01', sold_at: '2026-03-01', cost_basis: 100, sold_price: 200, sold_fees: 20, origin: 'ledger' },
      { id: 2, set_num: 'b', name: null, quantity: 2, condition: 'sealed', purchased_at: '2026-01-01', sold_at: '2026-03-01', cost_basis: 300, sold_price: 250, sold_fees: null, origin: 'ledger' },
      { id: 3, set_num: 'c', name: null, quantity: 1, condition: 'sealed', purchased_at: null, sold_at: '2026-03-01', cost_basis: null, sold_price: 50, sold_fees: null, origin: 'legacy' },
    ]);
    expect(rows.map((r) => [r.gain, r.term])).toEqual([[80, 'long'], [-50, 'short'], [null, null]]);
    expect(summary).toMatchObject({ sales: 3, units: 4, proceeds: 500, fees: 20, cost: 400, gain: 30, long_term_gain: 80, short_term_gain: -50, missing_cost: 1 });
  });
});

describe('valueCheck', () => {
  it('waits for enough sales, then reports median error and hit rates without outliers', () => {
    expect(valueCheck([{ value: 100, price: 100 }], 20)).toMatchObject({ ready: false, sales: 1 });
    const pairs = Array.from({ length: 20 }, (_, i) => ({ value: 100, price: i < 10 ? 100 : 125 }));
    pairs.push({ value: 100, price: 1000 }); // a bundle: dropped
    const r = valueCheck(pairs, 20) as any;
    expect(r.ready).toBe(true);
    expect(r.sales).toBe(20);
    expect(r.within_10_pct).toBe(50);
    expect(r.within_20_pct).toBe(100);
  });
});

describe('/api/sales', () => {
  beforeEach(async () => {
    (env as any).SUPABASE_JWT_SECRET = secret;
    (env as any).SUPABASE_URL = 'https://supabase.mock.io';
    (env as any).SUPABASE_ANON_KEY = 'fixture-anon-key';
    await applyTestTables(db, ['lego_sets', 'user_collection', 'realized_sales', 'user_prefs']);
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year) VALUES ('1-1', 'One', 2020), ('2-1', 'Two', 2021), ('3-1', 'Three', 2022)`).run();
    await db.prepare(`INSERT INTO realized_sales (user_id, set_num, quantity, cost_basis, purchased_at, sold_price, sold_fees, sold_at, value_at_sale, source)
      VALUES (?, '1-1', 1, 100, '2024-01-01', 180, 10, '2026-02-01', 170, 'copy'),
             (?, '2-1', 2, 300, '2025-12-01', 400, NULL, '2025-12-20', 190, 'holding'),
             ('someone-else', '1-1', 1, 1, NULL, 999, NULL, '2026-02-01', 170, 'copy')`).bind(OWNER, OWNER).run();
    // A legacy sold holding with no ledger row, and one the ledger already covers.
    await db.prepare(`INSERT INTO user_collection (user_id, set_num, quantity, purchase_price, purchased_at, sold_price, sold_at, deleted_at)
      VALUES (?, '3-1', 1, 40, '2025-01-01', 90, '2026-05-05', '2026-05-05'),
             (?, '1-1', 1, 100, '2024-01-01', 180, '2026-02-01', '2026-02-01')`).bind(OWNER, OWNER).run();
  });

  it('requires a member', async () => {
    expect((await call('GET', '', null)).status).toBe(401);
  });

  it('gives free members the summary, not the per-sale report', async () => {
    const { status, body } = await call('GET', '?year=2026');
    expect(status).toBe(200);
    expect(body.years).toEqual([2026, 2025]);
    expect(body.pro).toBe(false);
    expect(body.rows).toBeNull();
    expect(body.summary).toMatchObject({ sales: 2, proceeds: 270, fees: 10, cost: 140, gain: 120 });
  });

  it('gives Pro the per-sale rows, including legacy sales, and lets a sale be removed', async () => {
    await db.prepare(`INSERT INTO user_prefs (user_id, is_supporter) VALUES (?, 1)`).bind(OWNER).run();
    const { body } = await call('GET', '?year=2026');
    expect(body.rows.map((r: any) => [r.set_num, r.origin, r.gain])).toEqual([['1-1', 'ledger', 70], ['3-1', 'legacy', 50]]);
    const legacy = body.rows.find((r: any) => r.origin === 'legacy');
    expect((await call('DELETE', `/${legacy.id}`)).status).toBe(200);
    const ledger = body.rows.find((r: any) => r.origin === 'ledger');
    expect((await call('DELETE', `/${ledger.id}`)).status).toBe(200);
    expect((await call('DELETE', `/${ledger.id}`)).status).toBe(404);
    expect((await call('GET', '?year=2026')).body.summary.sales).toBe(0);
  });

  it('serves the public value check without sign-in', async () => {
    const { status, body } = await call('GET', '/value-check', null);
    expect(status).toBe(200);
    expect(body).toMatchObject({ ready: false, sales: 2 });
  });
});
