/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import app from './index';
import { parseMoney } from './routes/bricklink-import';
import { runCommunityComps } from './jobs/community-comps';
import { applyTestTables } from './test-schema';

const db = (env as { DB: D1Database }).DB;
const secret = 'bl-import-test-secret-at-least-32-characters';
const USER = 'bl-import-user';

const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException: () => {} };

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

async function importCsv(body: Record<string, unknown>, userId = USER) {
  const res = await app.fetch(new Request('https://example.test/api/bricklink/import-csv', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token(userId)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), env as any, ctx as any);
  return { status: res.status, json: await res.json<any>() };
}

const HEADER = 'Order ID,Date,Seller,Qty,Item Type,Item No,Item Name,Color,Condition,Price';
const row = (setNo: string, price: string, { qty = 1, date = '2026-09-01', cond = 'N' } = {}) =>
  `1,${date},seller,${qty},SET,${setNo},Name,,${cond},${price}`;

const holding = (setNum: string, rest: Record<string, unknown> = {}) => db.prepare(
  `SELECT quantity, purchase_price, sold_price, sold_at, deleted_at FROM user_collection WHERE user_id = ? AND set_num = ?`,
).bind(USER, setNum).first<any>().then(r => (r ? { ...r, ...rest } : r));

describe('POST /api/bricklink/import-csv', () => {
  beforeEach(async () => {
    (env as any).SUPABASE_JWT_SECRET = secret;
    (env as any).SUPABASE_URL = 'https://supabase.mock.io';
    (env as any).SUPABASE_ANON_KEY = 'fixture-anon-key';
    await applyTestTables(db, ['lego_sets', 'user_collection', 'user_wishlist', 'community_comps', 'pricing_signals', 'pricing_write_ledger']);
    await db.batch(['10001-1', '10002-1', '10003-1', '10004-1'].map(n =>
      db.prepare(`INSERT INTO lego_sets (set_num, name, blended_value) VALUES (?, ?, 100)`).bind(n, n)));
    await (env as any).CACHE_KV?.put('fx:usd', JSON.stringify({ USD: 1, EUR: 0.5, GBP: 0.8 }));
  });

  it('purchases mode keeps adding bought sets (default mode)', async () => {
    const { status, json } = await importCsv({ csv: [HEADER, row('10001', '$80.00')].join('\n') });
    expect(status).toBe(200);
    expect(json).toMatchObject({ mode: 'purchases', added: 1, sold: 0 });
    expect(await holding('10001-1')).toMatchObject({ purchase_price: 80, deleted_at: null });
  });

  it('converts prices to USD from the client currency or a code in the cell', async () => {
    await importCsv({ csv: [HEADER, row('10001', '40,00'), row('10002', 'GBP 80.00')].join('\n'), currency: 'EUR' });
    expect((await holding('10001-1')).purchase_price).toBe(80); // 40 EUR at 0.5 EUR per USD
    expect((await holding('10002-1')).purchase_price).toBe(100); // 80 GBP at 0.8 GBP per USD
  });

  it('sales mode marks an active holding sold, at the order price for every copy held', async () => {
    await db.prepare(`INSERT INTO user_collection (user_id, set_num, quantity, purchase_price) VALUES (?, '10001-1', 2, 60)`).bind(USER).run();
    const { json } = await importCsv({ mode: 'sales', csv: [HEADER, row('10001', '90.00', { qty: 2, date: '2026-09-10' })].join('\n') });
    expect(json).toMatchObject({ mode: 'sales', sold: 1, skipped: 0 });
    const h = await holding('10001-1');
    expect(h.sold_price).toBe(180);
    expect(h.sold_at).toBe('2026-09-10');
    expect(h.deleted_at).not.toBeNull();
  });

  it('sales mode records a sold-only row for a set never logged, merging repeat orders', async () => {
    const { json } = await importCsv({ mode: 'sales', csv: [HEADER,
      row('10002', '100.00', { date: '2026-08-01' }),
      row('10002', '110.00', { date: '2026-09-01' }),
    ].join('\n') });
    expect(json.sold).toBe(1);
    expect(await holding('10002-1')).toMatchObject({ quantity: 2, sold_price: 210, sold_at: '2026-09-01' });
    expect((await holding('10002-1')).deleted_at).not.toBeNull();
  });

  it('sales mode leaves partial sales and already-recorded sales alone', async () => {
    await db.batch([
      db.prepare(`INSERT INTO user_collection (user_id, set_num, quantity) VALUES (?, '10003-1', 3)`).bind(USER),
      db.prepare(`INSERT INTO user_collection (user_id, set_num, quantity, sold_price, sold_at, deleted_at) VALUES (?, '10004-1', 1, 95, '2026-07-01', datetime('now'))`).bind(USER),
    ]);
    const { json } = await importCsv({ mode: 'sales', csv: [HEADER, row('10003', '90.00'), row('10004', '99.00')].join('\n') });
    expect(json).toMatchObject({ sold: 0, skipped: 2 });
    expect((await holding('10003-1')).deleted_at).toBeNull();
    expect((await holding('10004-1')).sold_price).toBe(95);
  });

  it('sales mode attaches a sale to a set removed earlier without a price', async () => {
    await db.prepare(`INSERT INTO user_collection (user_id, set_num, quantity, deleted_at) VALUES (?, '10001-1', 1, datetime('now'))`).bind(USER).run();
    const { json } = await importCsv({ mode: 'sales', csv: [HEADER, row('10001', '95.00')].join('\n') });
    expect(json.sold).toBe(1);
    expect(await holding('10001-1')).toMatchObject({ sold_price: 95, sold_at: '2026-09-01' });
  });

  it('sales mode skips rows with no price or date, and a currency it cannot convert', async () => {
    const { json } = await importCsv({ mode: 'sales', currency: 'JPY', csv: [HEADER,
      row('10001', ''),
      row('10002', '50.00', { date: 'not a date' }),
      row('10003', '9000'),
    ].join('\n') });
    expect(json).toMatchObject({ sold: 0, skipped: 3 });
  });
});

describe('community comps from multi-copy sales', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'user_collection', 'user_wishlist', 'community_comps', 'pricing_signals', 'pricing_write_ledger']);
  });

  it('divides a whole-holding sale price back to a per-set comp', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, blended_value) VALUES ('CC-Q', 'CC-Q', 100)`),
      ...['u1', 'u2', 'u3', 'u4', 'u5'].map(u => db.prepare(
        `INSERT INTO user_collection (user_id, set_num, quantity, sold_price, sold_at, deleted_at) VALUES (?, 'CC-Q', 2, 200, date('now','-5 days'), datetime('now'))`,
      ).bind(u)),
    ]);
    await runCommunityComps(env as any);
    const comp = await db.prepare(`SELECT median FROM community_comps WHERE set_num='CC-Q'`).first<{ median: number }>();
    expect(comp!.median).toBe(100);
  });
});

describe('parseMoney', () => {
  it('reads US and European number formats', () => {
    expect(parseMoney('$1,234.56')).toBe(1234.56);
    expect(parseMoney('EUR 1.234,56')).toBe(1234.56);
    expect(parseMoney('12,50')).toBe(12.5);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('0')).toBeNull();
  });
});
