/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyTestTables } from './test-schema';

vi.mock('./lib/brickinsights', () => ({ fetchBrickInsightsRating: vi.fn() }));
import { fetchBrickInsightsRating } from './lib/brickinsights';
import { runBrickInsightsBackfill } from './jobs/brickinsights';

const db = (env as any).DB as D1Database;
const mockRating = vi.mocked(fetchBrickInsightsRating);

async function seedSet(setNum = 'X-1') {
  await db.prepare(`INSERT INTO lego_sets (set_num, name, brickinsights_cached_at) VALUES (?1,'S', NULL)`).bind(setNum).run();
}
const cachedAt = (setNum: string) =>
  db.prepare(`SELECT brickinsights_rating AS r, brickinsights_cached_at AS c FROM lego_sets WHERE set_num=?`).bind(setNum).first<{ r: number | null; c: string | null }>();

describe('runBrickInsightsBackfill', () => {
  beforeEach(async () => {
    mockRating.mockReset();
    await applyTestTables(db, ['lego_sets', 'user_collection', 'user_wishlist', 'integration_health']);
  });

  it('skips when BrickInsights is disabled', async () => {
    const r = await runBrickInsightsBackfill({ ...env, BRICKINSIGHTS_ENABLED: '0' } as any);
    expect(r.skipped).toMatch(/brickinsights disabled/);
    expect(mockRating).not.toHaveBeenCalled();
  });

  it('writes a rating and stamps cached_at on success', async () => {
    await seedSet();
    mockRating.mockResolvedValue({ rating: 8.5, review_count: 100, url: 'https://brickinsights.com/x' } as any);
    const r = await runBrickInsightsBackfill(env as any);
    expect(r).toMatchObject({ processed: 1, updated: 1 });
    const row = await cachedAt('X-1');
    expect(row!.r).toBe(8.5);
    expect(row!.c).toBeTruthy();
  });

  it('stamps cached_at (but does not count as updated) when the set is not reviewed', async () => {
    await seedSet();
    mockRating.mockResolvedValue({ rating: null, review_count: null, url: null } as any);
    const r = await runBrickInsightsBackfill(env as any);
    expect(r).toMatchObject({ processed: 1, updated: 0 });
    const row = await cachedAt('X-1');
    expect(row!.r).toBeNull();
    expect(row!.c).toBeTruthy(); // parked so missing sets aren't re-probed each run
  });

  it('leaves cached_at NULL on a transport failure so it retries next run', async () => {
    await seedSet();
    mockRating.mockRejectedValue(new Error('502 upstream'));
    const r = await runBrickInsightsBackfill(env as any);
    expect(r).toMatchObject({ processed: 1, updated: 0 });
    const row = await cachedAt('X-1');
    expect(row!.c).toBeNull(); // NOT stamped → retried
  });
});
