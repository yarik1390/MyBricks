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

  it('prunes only positively released entries before clearing retirement flags', async () => {
    const cases = [
      ['FRESH-1', 0, 'retiring', "datetime('now', '-1 day')"],
      ['RETIRED-1', 1, 'coming_soon', "NULL"],
      ['STALE-1', 0, 'in_stock', "datetime('now', '-8 days')"],
      ['UNKNOWN-1', 0, null, "datetime('now')"],
      ['FUTURE-1', 0, 'sold_out', "datetime('now', '+1 day')"],
      ['INVALID-1', 0, 'back_order', "'invalid'"],
    ] as const;
    for (const [num, retired, availability, clock] of cases) {
      await db.batch([
        db.prepare(`INSERT INTO lego_sets (set_num,name,retired,lego_retiring_soon,retirement_risk_score,lego_availability,lego_checked_at)
          VALUES (?, 'S', ?, 1, 75, ?, ${clock})`).bind(num, retired, availability),
        db.prepare(`INSERT INTO upcoming_sets (set_num,name) VALUES (?, 'S')`).bind(num),
      ]);
    }
    mockUpcoming.mockResolvedValue([{ set_num: 'NEW-1', name: 'New', price_usd: null, availability: 'coming_soon' }]);
    const r = await runUpcomingRefresh(withKey);
    expect(r).toMatchObject({ upserted: 1, removed: 2 });
    const rows = await db.prepare(`SELECT set_num FROM upcoming_sets ORDER BY set_num`).all();
    expect(rows.results.map((row) => row.set_num)).toEqual(['FUTURE-1', 'INVALID-1', 'NEW-1', 'STALE-1', 'UNKNOWN-1']);
    const released = await db.prepare(`SELECT lego_retiring_soon AS r, retirement_risk_score AS risk FROM lego_sets
      WHERE set_num IN ('FRESH-1','RETIRED-1')`).all();
    expect(released.results).toEqual([{ r: 1, risk: 75 }, { r: 1, risk: 75 }]);
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

  it('upserts a partial scrape without deleting omitted rows', async () => {
    await db.prepare(`INSERT INTO upcoming_sets (set_num, name, scraped_at) VALUES ('OLD-1','Gone', '2020-01-01')`).run();
    mockUpcoming.mockResolvedValue([
      { set_num: 'NEW-1', name: 'Fresh Set', price_usd: 199.99, availability: 'coming_soon' },
    ]);

    const r = await runUpcomingRefresh(withKey);
    expect(r.upserted).toBe(1);
    expect(r.removed).toBe(0); // absence is not release evidence

    const rows = await db.prepare(`SELECT set_num, price_usd, availability FROM upcoming_sets ORDER BY set_num`).all<{ set_num: string; price_usd: number; availability: string }>();
    expect(rows.results).toEqual([
      { set_num: 'NEW-1', price_usd: 199.99, availability: 'coming_soon' },
      { set_num: 'OLD-1', price_usd: null, availability: null },
    ]);
  });
});
