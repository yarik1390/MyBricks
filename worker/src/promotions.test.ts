/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTestTables } from './test-schema';

vi.mock('./lib/firecrawl', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/firecrawl')>(), firecrawlScrape: vi.fn(),
}));
import { firecrawlScrape } from './lib/firecrawl';
import { normalizePromo, promoKey, stripMarkdown } from './lib/promotions';
import { runPromotionsRefresh } from './jobs/promotions-refresh';
import app from './index';

const db = (env as { DB: D1Database }).DB;
const secret = 'promo-test-secret-at-least-32-characters!!';
const withKey = { ...env, FIRECRAWL_API_KEY: 'fc', FIRECRAWL_DAILY_CREDITS: '' } as any;
const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException: () => {} } as any;
const scrape = vi.mocked(firecrawlScrape);
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

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

async function call(method: string, path: string, userId: string | null, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (userId) headers.Authorization = `Bearer ${await token(userId)}`;
  const res = await app.fetch(new Request(`https://example.test/api/promotions${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  }), env as any, ctx);
  return { status: res.status, body: await res.json() as any };
}

describe('normalizePromo', () => {
  it('classifies offers, fixes swapped dates and keeps only a real gift set number', () => {
    expect(normalizePromo({ title: 'Free Mini Tree with purchases over $150', start_date: '2026-11-20', end_date: '2026-11-01', min_spend_usd: 150, gift_set_number: '40573' }))
      .toMatchObject({ kind: 'gwp', starts_on: '2026-11-01', ends_on: '2026-11-20', min_spend: 150, gift_set_num: '40573-1' });
    expect(normalizePromo({ title: 'Double Insiders points on Star Wars', kind: 'double_points' })?.kind).toBe('double_points');
    expect(normalizePromo({ title: '20% off select sets', gift_set_number: 'see site' })).toMatchObject({ kind: 'sale', gift_set_num: null });
    expect(normalizePromo({ title: '  ' })).toBeNull();
  });

  it('keeps the store, its currency and plain text', () => {
    const fr = normalizePromo({ title: 'Mini-modèle _TIE Interceptor_ ™ offert', details: 'Dès **40 €** d\'achat [Star Wars](https://x)', min_spend: 40 }, 'FR')!;
    expect(fr).toMatchObject({ market: 'FR', currency: 'EUR', min_spend: 40, title: 'Mini-modèle TIE Interceptor™ offert', details: "Dès 40 € d'achat Star Wars" });
    expect(promoKey(fr).startsWith('FR|')).toBe(true);
    const us = normalizePromo({ title: 'Free tree', min_spend_usd: 150 })!;
    expect(us).toMatchObject({ market: 'US', currency: 'USD', min_spend: 150 });
    expect(promoKey(us)).toBe('other|free tree|'); // US keys unchanged
    expect(normalizePromo({ title: 'x' }, 'ZZ')?.market).toBe('US');
    expect(stripMarkdown('Spend over $40 on _Star Wars_ ™ to unlock')).toBe('Spend over $40 on Star Wars™ to unlock');
    expect(stripMarkdown('snake_case_name stays')).toBe('snake_case_name stays');
  });
});

describe('promotions', () => {
  beforeEach(async () => {
    scrape.mockReset();
    (env as any).SUPABASE_JWT_SECRET = secret;
    (env as any).SUPABASE_URL = 'https://supabase.mock.io';
    (env as any).SUPABASE_ANON_KEY = 'fixture-anon-key';
    (env as any).ADMIN_USER_ID = 'admin-user';
    await applyTestTables(db, ['lego_sets', 'promotions', 'api_quota', 'app_settings']);
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, image_url) VALUES ('40573-1', 'Christmas Tree', 2022, 'https://img/1.png')`).run();
  });

  it('refresh upserts current offers once, skips ended ones and never overwrites an admin edit', async () => {
    scrape.mockResolvedValue({ data: { promotions: [
      { title: 'Free Christmas Tree', kind: 'gift_with_purchase', start_date: day(-2), end_date: day(10), min_spend_usd: 150, gift_set_number: '40573' },
      { title: 'Double points weekend', kind: 'double_points', start_date: day(5), end_date: day(7) },
      { title: 'Last month sale', kind: 'sale', end_date: day(-3) },
    ] } } as any);
    const first = await runPromotionsRefresh(withKey, { markets: ['US'] });
    expect(first).toMatchObject({ pages: 2, seen: 4, added: 2 }); // both pages list the same two offers
    expect((await db.prepare('SELECT COUNT(*) AS n FROM promotions').first<{ n: number }>())?.n).toBe(2);

    const tree = await db.prepare(`SELECT id FROM promotions WHERE kind = 'gwp'`).first<{ id: number }>();
    expect((await call('PATCH', `/admin/${tree!.id}`, 'admin-user', { details: 'Fixed by hand' })).status).toBe(200);
    await runPromotionsRefresh(withKey, { markets: ['US'] });
    expect(await db.prepare('SELECT details, source FROM promotions WHERE id = ?').bind(tree!.id).first())
      .toEqual({ details: 'Fixed by hand', source: 'admin' });
  });

  it('reads each country store with its own currency and serves the asked store, falling back to US', async () => {
    scrape.mockImplementation(async (req: any) => {
      const fr = String(req.url).includes('/fr-fr/');
      return { data: { promotions: [fr
        ? { title: 'Mini-modèle TIE Interceptor offert', kind: 'gift_with_purchase', end_date: day(3), min_spend: 40 }
        : { title: 'TIE Interceptor Mini-Build', kind: 'gift_with_purchase', end_date: day(3), min_spend: 40, details: 'Spend over $40 on _Star Wars_ ™' }] } } as any;
    });
    const res = await runPromotionsRefresh(withKey, { markets: ['US', 'FR'] });
    expect(res.markets).toMatchObject({ US: { pages: 2, added: 1 }, FR: { pages: 2, added: 1 } });
    expect(scrape.mock.calls.map(([r]: any) => r.url)).toEqual(expect.arrayContaining([
      'https://www.lego.com/fr-fr/offers', 'https://www.lego.com/en-us/offers']));

    const fr = await call('GET', '?market=FR', null);
    expect(fr.body).toMatchObject({ market: 'FR', fallback: false });
    expect(fr.body.now).toEqual([expect.objectContaining({ title: 'Mini-modèle TIE Interceptor offert', min_spend: 40, currency: 'EUR', market: 'FR' })]);
    const us = await call('GET', '?market=US', null);
    expect(us.body.now).toEqual([expect.objectContaining({ currency: 'USD', details: 'Spend over $40 on Star Wars™' })]);
    const gb = await call('GET', '?market=GB', null);
    expect(gb.body).toMatchObject({ market: 'US', asked_market: 'GB', fallback: true });
    expect(gb.body.now[0].currency).toBe('USD');
  });

  it('lists what is on now and coming up, hides hidden ones, and keeps admin routes for the admin', async () => {
    const add = (p: Record<string, unknown>) => {
      const n = normalizePromo(p)!;
      return db.prepare(`INSERT INTO promotions (dedupe_key, kind, title, starts_on, ends_on, gift_set_num, source, hidden, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, 'lego.com', ?, datetime('now'))`).bind(promoKey(n), n.kind, n.title, n.starts_on, n.ends_on, n.gift_set_num, p.hidden ? 1 : 0).run();
    };
    await add({ title: 'Free tree', kind: 'gwp', start_date: day(-1), end_date: day(3), gift_set_number: '40573' });
    await add({ title: 'Double points', kind: 'double_points', start_date: day(4), end_date: day(6) });
    await add({ title: 'Wrong one', kind: 'sale', end_date: day(6), hidden: true });
    await add({ title: 'Over', kind: 'sale', end_date: day(-1) });

    const list = await call('GET', '', null);
    expect(list.status).toBe(200);
    expect(list.body.now.map((p: any) => [p.title, p.gift_name])).toEqual([['Free tree', 'Christmas Tree']]);
    expect(list.body.upcoming.map((p: any) => p.title)).toEqual(['Double points']);

    expect((await call('GET', '/admin', 'someone')).status).toBe(403);
    expect((await call('POST', '/admin', 'someone', { title: 'x' })).status).toBe(403);
    const created = await call('POST', '/admin', 'admin-user', { title: 'Target sale', kind: 'sale', ends_on: day(2), url: 'https://www.target.com/lego' });
    expect(created.body.ok).toBe(true);
    const all = await call('GET', '/admin', 'admin-user');
    expect(all.body.promotions.map((p: any) => p.title)).toEqual(expect.arrayContaining(['Target sale', 'Wrong one']));
  });
});
