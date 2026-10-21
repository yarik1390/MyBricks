/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTestTables } from './test-schema';

// Serve gzipped Rebrickable inventory files so the job runs the real gunzip,
// parse and D1 writes with no network.
const H = vi.hoisted(() => {
  const INVENTORIES = 'id,version,set_num\n' +
    '10,1,PACK-1\n11,2,PACK-1\n' + // two versions: the lowest wins
    '20,1,S1-17\n' +
    '30,1,S1-14\n' +
    '40,1,PACK-2\n';
  const INVENTORY_SETS = 'inventory_id,set_num,quantity\n' +
    '10,A-1,1\n10,B-1,2\n' +
    '11,A-1,9\n' +
    '20,S1-1,1\n20,S1-2,1\n20,S1-3,1\n20,S1-4,1\n' +
    '30,S1-0,36\n' +
    '40,A-1,1\n40,UNPRICED-1,1\n';
  const gz = async (s: string) => {
    const cs = new CompressionStream('gzip');
    const w = cs.writable.getWriter(); w.write(new TextEncoder().encode(s)); w.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  };
  return { INVENTORIES, INVENTORY_SETS, gz };
});
vi.mock('./lib/http', () => ({
  fetchWithRetry: vi.fn(),
  fetchTracked: vi.fn(async (_env: unknown, _service: string, url: string) =>
    new Response(await H.gz(url.includes('inventory_sets') ? H.INVENTORY_SETS : H.INVENTORIES), { status: 200 })),
}));
vi.mock('./lib/pricing-budget', () => ({ pricingWritesAllowed: vi.fn(async () => true) }));
vi.mock('./lib/market-sources', () => ({ recomputeBlendedValues: vi.fn(async (_db: unknown, ids: string[]) => ids.length) }));

import { computeBundleValues, parseBundleItems, runBundleValues } from './jobs/bundle-values';
import { recomputeBlendedValues } from './lib/market-sources';

const db = (env as any).DB as D1Database;

describe('parseBundleItems', () => {
  it('maps each bundle to the sets in its lowest-version inventory', () => {
    const items = parseBundleItems(H.INVENTORIES, H.INVENTORY_SETS);
    expect(items.get('PACK-1')).toEqual([{ set_num: 'A-1', quantity: 1 }, { set_num: 'B-1', quantity: 2 }]);
    expect(items.get('S1-14')).toEqual([{ set_num: 'S1-0', quantity: 36 }]);
  });
});

describe('computeBundleValues', () => {
  const bundles = parseBundleItems(H.INVENTORIES, H.INVENTORY_SETS);

  it('sums the contents, averages random boxes, and fills nested bundles', () => {
    const values = new Map([['A-1', 10], ['B-1', 5], ['S1-1', 4], ['S1-2', 6], ['S1-3', 8], ['S1-4', 200]]);
    const out = computeBundleValues(bundles, ['S1-0'], values);
    expect(out.get('PACK-1')).toBe(20); // 10 + 2 x 5
    expect(out.get('S1-17')).toBe(218); // the complete series is every figure
    // The $200 chase figure counts at most 3x the median ($8) in a random draw.
    expect(out.get('S1-0')).toBe(10.5); // (4 + 6 + 8 + 24) / 4
    expect(out.get('S1-14')).toBe(378); // a sealed box is 36 random boxes
    expect(out.has('PACK-2')).toBe(false); // one item has no value
  });

  it('skips a random box when too few figures are priced', () => {
    const out = computeBundleValues(bundles, ['S1-0'], new Map([['S1-1', 4], ['S1-2', 6]]));
    expect(out.has('S1-0')).toBe(false);
    expect(out.has('S1-14')).toBe(false);
  });
});

describe('runBundleValues', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'set_market_ext', 'set_valuation_state']);
    const sets = ['PACK-1', 'PACK-2', 'A-1', 'B-1', 'S1-1', 'S1-2', 'S1-3', 'S1-4', 'S1-17', 'S1-14', 'OLD-1'];
    await db.batch(sets.map(s => db.prepare(
      'INSERT INTO lego_sets (set_num, name, year, theme) VALUES (?, ?, 2020, ?)',
    ).bind(s, s, s.startsWith('S1') ? 'Collectible Minifigures' : 'City')));
    await db.prepare("INSERT INTO lego_sets (set_num, name, year, theme) VALUES ('S1-0', 'Random Bag', 2020, 'Collectible Minifigures')").run();
    const fair: Array<[string, number]> = [['A-1', 10], ['B-1', 5], ['S1-1', 4], ['S1-2', 6], ['S1-3', 8]];
    await db.batch(fair.map(([s, v]) => db.prepare(
      "INSERT INTO set_valuation_state (set_num, condition, fair_value) VALUES (?, 'new_sealed', ?)",
    ).bind(s, v)));
    // S1-4 has only our model's estimate; OLD-1 was a bundle that left Rebrickable's list.
    await db.batch([
      db.prepare('INSERT INTO set_market_ext (set_num, model_value) VALUES (?, ?)').bind('S1-4', 12),
      db.prepare('INSERT INTO set_market_ext (set_num, bundle_value, model_value) VALUES (?, ?, ?)').bind('OLD-1', 50, 50),
    ]);
  });

  const ext = (s: string) => db.prepare('SELECT bundle_value, model_value FROM set_market_ext WHERE set_num=?')
    .bind(s).first<{ bundle_value: number | null; model_value: number | null }>();

  it('stores bundle values as the model estimate and clears stale ones', async () => {
    const result = await runBundleValues(env as any);
    expect(result.valued).toBe(4); // PACK-1, S1-17, S1-0, S1-14
    expect(await ext('PACK-1')).toEqual({ bundle_value: 20, model_value: 20 });
    expect(await ext('S1-17')).toEqual({ bundle_value: 30, model_value: 30 });
    expect(await ext('S1-0')).toEqual({ bundle_value: 7.5, model_value: 7.5 });
    expect(await ext('S1-14')).toEqual({ bundle_value: 270, model_value: 270 });
    expect(await ext('PACK-2')).toBeNull();
    expect(await ext('OLD-1')).toEqual({ bundle_value: null, model_value: null });
    expect(result.cleared).toBe(1);
    expect(recomputeBlendedValues).toHaveBeenCalled();

    // A second run with nothing changed writes nothing.
    const again = await runBundleValues(env as any);
    expect(again.written).toBe(0);
    expect(again.cleared).toBe(0);
  });
});
