/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyTestTables } from './test-schema';
import { buildAdvisorContext } from './lib/advisor-context';

const db = (env as any).DB as D1Database;

describe('buildAdvisorContext', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'set_market_ext', 'set_valuation_state', 'user_collection',
      'user_wishlist', 'set_value_history', 'minifigs', 'user_minifigs']);
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, theme, year, current_value, blended_value, bl_new_value, bl_new_qty)
                  VALUES ('FALL-1', 'Falling Set', 'City', 2020, 100, 100, 80, 6)`),
      db.prepare(`INSERT INTO user_collection (user_id, set_num, quantity, condition, purchase_price)
                  VALUES ('u1', 'FALL-1', 1, 'new', 50)`),
    ]);
    // 150 -> 200 -> ... -> 100: the set fell 33% over the window even though
    // its max-min spread is +100%.
    const vals = [150, 200, 180, 160, 140, 120, 110, 100];
    for (let i = 0; i < vals.length; i++) {
      await db.prepare(`INSERT INTO set_value_history (set_num, snapshot_date, current_value)
                        VALUES ('FALL-1', date('now', ?), ?)`).bind(`-${80 - i * 10} days`, vals[i]).run();
    }
  });

  it('reports chronological 90-day change and the vault holding value', async () => {
    const ctx = await buildAdvisorContext('u1', env as any);
    expect(ctx).toContain('-33.3%/90d');
    expect(ctx).not.toContain('+100%/90d');
    // An opened copy ('new') is capped at BrickLink's $80, like the vault total.
    expect(ctx).toContain('Total value: $80 | Total paid: $50');
    expect(ctx).toContain('- City: 1 sets, $80 value');
  });
});
