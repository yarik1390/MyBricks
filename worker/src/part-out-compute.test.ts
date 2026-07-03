/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { runPartOutCompute } from './jobs/part-out-compute';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;

describe('runPartOutCompute', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'set_parts', 'part_prices', 'user_collection', 'user_wishlist']);
  });

  it('processes nothing when no set has a parts breakdown', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year) VALUES ('A-1','A', 2015)`).run();
    expect(await runPartOutCompute(env as any)).toMatchObject({ processed: 0, valued: 0 });
  });

  it('sums cached part prices into part_out_value with full coverage', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, year) VALUES ('X-1','X', 2015)`),
      db.prepare(`INSERT INTO set_parts (set_num, part_num, color_id, quantity, is_spare) VALUES ('X-1','p1', 0, 1, 0)`),
      db.prepare(`INSERT INTO set_parts (set_num, part_num, color_id, quantity, is_spare) VALUES ('X-1','p2', 0, 1, 0)`),
      db.prepare(`INSERT INTO part_prices (part_num, color_id, price_new) VALUES ('p1', 0, 2.00)`),
      db.prepare(`INSERT INTO part_prices (part_num, color_id, price_new) VALUES ('p2', 0, 3.00)`),
    ]);

    const r = await runPartOutCompute(env as any);
    expect(r).toMatchObject({ processed: 1, valued: 1 });
    const row = await db.prepare(`SELECT part_out_value, part_out_coverage, part_out_cached_at FROM lego_sets WHERE set_num='X-1'`)
      .first<{ part_out_value: number; part_out_coverage: number; part_out_cached_at: string }>();
    expect(row!.part_out_value).toBe(5);      // 2 + 3
    expect(row!.part_out_coverage).toBe(1);    // every lot priced
    expect(row!.part_out_cached_at).toBeTruthy();
  });

  it('stamps cached_at but leaves value null when no part is priced', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, year) VALUES ('Y-1','Y', 2015)`),
      db.prepare(`INSERT INTO set_parts (set_num, part_num, color_id, quantity, is_spare) VALUES ('Y-1','p9', 0, 3, 0)`),
    ]);
    const r = await runPartOutCompute(env as any);
    expect(r).toMatchObject({ processed: 1, valued: 0 });
    const row = await db.prepare(`SELECT part_out_value, part_out_coverage, part_out_cached_at FROM lego_sets WHERE set_num='Y-1'`)
      .first<{ part_out_value: number | null; part_out_coverage: number; part_out_cached_at: string }>();
    expect(row!.part_out_value).toBeNull();
    expect(row!.part_out_coverage).toBe(0);
    expect(row!.part_out_cached_at).toBeTruthy(); // still stamped so it isn't recomputed immediately
  });

  it('excludes spare parts from the part-out sum', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, year) VALUES ('Z-1','Z', 2015)`),
      db.prepare(`INSERT INTO set_parts (set_num, part_num, color_id, quantity, is_spare) VALUES ('Z-1','sp', 0, 1, 1)`), // spare only
      db.prepare(`INSERT INTO part_prices (part_num, color_id, price_new) VALUES ('sp', 0, 9.00)`),
    ]);
    const r = await runPartOutCompute(env as any);
    expect(r).toMatchObject({ processed: 1, valued: 0 }); // spare-only → nothing to value
    const row = await db.prepare(`SELECT part_out_value FROM lego_sets WHERE set_num='Z-1'`).first<{ part_out_value: number | null }>();
    expect(row!.part_out_value).toBeNull();
  });
});
