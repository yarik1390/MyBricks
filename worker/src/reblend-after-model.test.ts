/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./lib/pricing-budget', () => ({ pricingWritesAllowed: vi.fn(async () => true) }));
vi.mock('./lib/market-sources', () => ({ recomputeBlendedValues: vi.fn(async (_db: unknown, ids: string[]) => ids.length) }));

import { runReblendAfterModel } from './jobs/reblend-after-model';
import { recomputeBlendedValues } from './lib/market-sources';

const db = (env as any).DB as D1Database;

describe('runReblendAfterModel', () => {
  beforeEach(async () => {
    vi.mocked(recomputeBlendedValues).mockClear();
    for (const t of ['set_market_ext', 'user_collection', 'user_wishlist']) await db.prepare(`DROP TABLE IF EXISTS ${t}`).run();
    await db.prepare(`CREATE TABLE set_market_ext (set_num TEXT PRIMARY KEY, model_value REAL, model_cached_at TEXT)`).run();
    await db.prepare(`CREATE TABLE user_collection (set_num TEXT, deleted_at TEXT)`).run();
    await db.prepare(`CREATE TABLE user_wishlist (set_num TEXT)`).run();
    await db.batch([
      db.prepare(`INSERT INTO set_market_ext VALUES ('OWNED-1', 50, datetime('now')),
        ('WISH-1', 60, datetime('now', '-1 hour')), ('STALE-1', 70, datetime('now', '-2 days')),
        ('NOBODY-1', 80, datetime('now')), ('GONE-1', 90, datetime('now'))`),
      db.prepare(`INSERT INTO user_collection VALUES ('OWNED-1', NULL), ('STALE-1', NULL), ('GONE-1', '2026-01-01')`),
      db.prepare(`INSERT INTO user_wishlist VALUES ('WISH-1')`),
    ]);
  });

  it('re-blends only owned/wishlisted sets whose estimate just changed', async () => {
    const out = await runReblendAfterModel(env as any);
    expect(out).toEqual({ candidates: 2, written: 2 });
    expect(vi.mocked(recomputeBlendedValues).mock.calls[0][1]).toEqual(['OWNED-1', 'WISH-1']);
  });

  it('respects the limit and does nothing when nothing moved', async () => {
    expect(await runReblendAfterModel(env as any, { limit: 1 })).toEqual({ candidates: 1, written: 1 });
    await db.prepare(`UPDATE set_market_ext SET model_cached_at = datetime('now', '-1 day')`).run();
    vi.mocked(recomputeBlendedValues).mockClear();
    expect(await runReblendAfterModel(env as any)).toEqual({ candidates: 0, written: 0 });
    expect(recomputeBlendedValues).not.toHaveBeenCalled();
  });
});
