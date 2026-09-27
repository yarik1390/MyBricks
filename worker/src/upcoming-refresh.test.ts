/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyTestTables } from './test-schema';

vi.mock('./lib/upcoming', () => ({ fetchUpcomingSets: vi.fn() }));
import { fetchUpcomingSets } from './lib/upcoming';
import { runUpcomingRefresh } from './jobs/upcoming-refresh';

const db = (env as any).DB as D1Database;
const mockUpcoming = vi.mocked(fetchUpcomingSets);
const withKey = { ...env, FIRECRAWL_API_KEY: 'fc' } as any;

describe('runUpcomingRefresh', () => {
  beforeEach(async () => {
    mockUpcoming.mockReset();
    await applyTestTables(db, ['lego_sets', 'upcoming_sets']);
  });

  it('clears a retiring flag on coming-soon sets even when the scrape is off', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, lego_retiring_soon, retirement_risk_score) VALUES ('UP-1','Listed Upcoming',1,75)`),
      // Flag already cleared, but a cached score still reads as "retiring".
      db.prepare(`INSERT INTO lego_sets (set_num, name, lego_retiring_soon, retirement_risk_score) VALUES ('UP-2','Score Only',0,80)`),
      db.prepare(`INSERT INTO upcoming_sets (set_num, name) VALUES ('UP-2','Score Only')`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, lego_retiring_soon, lego_availability) VALUES ('PRE-1','Pre-order',1,'pre_order')`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, lego_retiring_soon) VALUES ('RET-1','Really Retiring',1)`),
      db.prepare(`INSERT INTO upcoming_sets (set_num, name) VALUES ('UP-1','Listed Upcoming')`),
    ]);
    const r = await runUpcomingRefresh({ ...env, FIRECRAWL_API_KEY: '', FIRECRAWL_API_KEYS: '' } as any);
    expect(r.cleared).toBe(3);
    const rows = await db.prepare(`SELECT set_num, lego_retiring_soon AS f, COALESCE(retirement_risk_score, 0) AS risk FROM lego_sets ORDER BY set_num`).all<{ set_num: string; f: number; risk: number }>();
    expect(rows.results).toEqual([
      { set_num: 'PRE-1', f: 0, risk: 0 }, { set_num: 'RET-1', f: 1, risk: 0 },
      { set_num: 'UP-1', f: 0, risk: 0 }, { set_num: 'UP-2', f: 0, risk: 0 },
    ]);
  });

  it('skips when Firecrawl is disabled', async () => {
    const r = await runUpcomingRefresh({ ...env, FIRECRAWL_API_KEY: '', FIRECRAWL_API_KEYS: '' } as any);
    expect(r.skipped).toMatch(/firecrawl disabled/);
    expect(mockUpcoming).not.toHaveBeenCalled();
  });

  it('does not prune the feed on an empty/failed scrape', async () => {
    await db.prepare(`INSERT INTO upcoming_sets (set_num, name, scraped_at) VALUES ('OLD-1','Old', '2020-01-01')`).run();
    mockUpcoming.mockResolvedValue([]);
    const r = await runUpcomingRefresh(withKey);
    expect(r.skipped).toMatch(/no items scraped/);
    const n = await db.prepare(`SELECT COUNT(*) AS n FROM upcoming_sets`).first<{ n: number }>();
    expect(n!.n).toBe(1); // preserved — a transient miss must not wipe a good feed
  });

  it('upserts scraped items and prunes rows not seen this run', async () => {
    await db.prepare(`INSERT INTO upcoming_sets (set_num, name, scraped_at) VALUES ('OLD-1','Gone', '2020-01-01')`).run();
    mockUpcoming.mockResolvedValue([
      { set_num: 'NEW-1', name: 'Fresh Set', price_usd: 199.99, availability: 'coming_soon' },
    ]);

    const r = await runUpcomingRefresh(withKey);
    expect(r.upserted).toBe(1);
    expect(r.removed).toBe(1); // OLD-1 not refreshed → pruned

    const rows = await db.prepare(`SELECT set_num, price_usd, availability FROM upcoming_sets`).all<{ set_num: string; price_usd: number; availability: string }>();
    expect(rows.results).toEqual([{ set_num: 'NEW-1', price_usd: 199.99, availability: 'coming_soon' }]);
  });
});
