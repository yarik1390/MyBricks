/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyTestTables } from './test-schema';

vi.mock('./lib/bricklink', () => ({ fetchPartPricing: vi.fn() }));
vi.mock('./lib/bricklink-colors', () => ({ toBrickLinkColorId: vi.fn() }));
import { fetchPartPricing } from './lib/bricklink';
import { toBrickLinkColorId } from './lib/bricklink-colors';
import { runPartPriceBackfill } from './jobs/part-price-backfill';

const db = (env as any).DB as D1Database;
const mockPrice = vi.mocked(fetchPartPricing);
const mockColor = vi.mocked(toBrickLinkColorId);
const today = new Date().toISOString().slice(0, 10);
const withBl = { ...env, BRICKLINK_CONSUMER_KEY: 'ck', BRICKLINK_CONSUMER_SECRET: 'cs', BRICKLINK_TOKEN: 'tok', BRICKLINK_TOKEN_SECRET: 'ts' } as any;

async function seedPart(part = 'p1', color = 0, spare = 0) {
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO lego_sets (set_num, name, year) VALUES ('X-1','X', 2015)`),
    db.prepare(`INSERT INTO set_parts (set_num, part_num, color_id, quantity, is_spare) VALUES ('X-1', ?1, ?2, 1, ?3)`).bind(part, color, spare),
  ]);
}
const price = (part = 'p1', color = 0) =>
  db.prepare(`SELECT price_new, cached_at FROM part_prices WHERE part_num=? AND color_id=?`).bind(part, color).first<{ price_new: number | null; cached_at: string }>();

describe('runPartPriceBackfill', () => {
  beforeEach(async () => {
    mockPrice.mockReset(); mockColor.mockReset();
    mockColor.mockResolvedValue(11 as any); // default: a valid BrickLink color id
    await applyTestTables(db, ['lego_sets', 'set_parts', 'part_prices', 'user_collection', 'user_wishlist', 'api_quota']);
  });

  it('skips when BrickLink is not configured', async () => {
    const r = await runPartPriceBackfill({ ...env, BRICKLINK_CONSUMER_KEY: '' } as any);
    expect(r.skipped).toMatch(/bricklink not configured/);
  });

  it('skips when the BrickLink daily budget is spent', async () => {
    await db.prepare(`INSERT INTO api_quota (service, day, used, cap) VALUES ('bricklink', ?1, 4000, 4000)`).bind(today).run();
    const r = await runPartPriceBackfill(withBl);
    expect(r.skipped).toMatch(/bricklink budget spent/);
  });

  it('prices the most-shared part and caches it', async () => {
    await seedPart();
    mockPrice.mockResolvedValue({ price_new: 2.5, qty_new: 8 } as any);
    const r = await runPartPriceBackfill(withBl);
    expect(r).toMatchObject({ processed: 1, priced: 1 });
    expect((await price())!.price_new).toBe(2.5);
  });

  it('stamps cached_at without a price on a guide miss', async () => {
    await seedPart();
    mockPrice.mockResolvedValue(null as any);
    const r = await runPartPriceBackfill(withBl);
    expect(r).toMatchObject({ processed: 1, priced: 0 });
    const row = await price();
    expect(row!.price_new).toBeNull();
    expect(row!.cached_at).toBeTruthy(); // parked so it isn't re-fetched every run
  });

  it('skips the BrickLink call for a color with no BrickLink equivalent', async () => {
    await seedPart('p2', 999);
    mockColor.mockResolvedValue(null as any); // no BL color mapping
    const r = await runPartPriceBackfill(withBl);
    expect(r).toMatchObject({ processed: 1, priced: 0 });
    expect(mockPrice).not.toHaveBeenCalled();
    expect((await price('p2', 999))!.cached_at).toBeTruthy();
  });
});
