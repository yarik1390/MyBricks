/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { runWishlistAlerts, wantsAlert, inQuietHours } from './jobs/wishlist-alerts';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;
// No RESEND_API_KEY / VAPID keys / discord webhooks → the detection logic runs
// and writes wishlist_alerts rows, but every outbound notification is skipped.
const e = { ...env, RESEND_API_KEY: '', VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '' } as any;

describe('runWishlistAlerts', () => {
  beforeEach(async () => {
    await applyTestTables(db, [
      'lego_sets', 'set_market_ext', 'user_collection', 'user_wishlist',
      'wishlist_alerts', 'user_prefs', 'push_subscriptions', 'set_valuation_state',
    ]);
  });

  it('fires a price-drop alert and stamps the cooldown', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, current_value, valuation_method) VALUES ('D-1','Drop Set', 50, 'market')`),
      db.prepare(`INSERT INTO user_wishlist (user_id, set_num, target_price, alerted_at) VALUES ('u1','D-1', 60, NULL)`),
    ]);

    const r = await runWishlistAlerts(e);

    expect(r.fired).toBe(1);
    const alert = await db.prepare(`SELECT alert_type, current_value FROM wishlist_alerts WHERE set_num='D-1'`).first<{ alert_type: string; current_value: number }>();
    expect(alert!.alert_type).toBe('drop');
    const wl = await db.prepare(`SELECT alerted_at FROM user_wishlist WHERE set_num='D-1'`).first<{ alerted_at: string | null }>();
    expect(wl!.alerted_at).toBeTruthy(); // cooldown stamped
  });

  it('respects the 7-day drop cooldown', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, current_value, valuation_method) VALUES ('D-2','Recent', 50, 'market')`),
      db.prepare(`INSERT INTO user_wishlist (user_id, set_num, target_price, alerted_at) VALUES ('u1','D-2', 60, datetime('now','-2 days'))`),
    ]);
    const r = await runWishlistAlerts(e);
    expect(r.fired).toBe(0); // alerted 2 days ago → still in cooldown
  });

  it('fires a value-spike alert for a +30% collection gain', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, current_value, valuation_method) VALUES ('S-1','Spiker', 200, 'market')`),
      db.prepare(`INSERT INTO user_collection (user_id, set_num, purchase_price, deleted_at, spike_alerted_at) VALUES ('u1','S-1', 100, NULL, NULL)`),
    ]);

    const r = await runWishlistAlerts(e);

    expect(r.spikes).toBe(1); // 200 > 1.3 * 100
    const alert = await db.prepare(`SELECT alert_type FROM wishlist_alerts WHERE set_num='S-1'`).first<{ alert_type: string }>();
    expect(alert!.alert_type).toBe('spike');
    const uc = await db.prepare(`SELECT spike_alerted_at FROM user_collection WHERE set_num='S-1'`).first<{ spike_alerted_at: string | null }>();
    expect(uc!.spike_alerted_at).toBeTruthy();
  });

  it('fires retiring / deal / preorder alerts for wishlisted sets', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, current_value, retired, lego_retiring_soon) VALUES ('R-1','Retiring', 30, 0, 1)`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, blended_value, deal_signal) VALUES ('B-1','Buy', 40, 'buy')`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, lego_availability) VALUES ('P-1','Preorder', 'pre_order')`),
      // target_price NULL so none of these trip the price-drop path — they must be
      // detected purely by their retiring/deal/preorder signals.
      db.prepare(`INSERT INTO user_wishlist (user_id, set_num) VALUES ('u1','R-1')`),
      db.prepare(`INSERT INTO user_wishlist (user_id, set_num) VALUES ('u1','B-1')`),
      db.prepare(`INSERT INTO user_wishlist (user_id, set_num) VALUES ('u1','P-1')`),
    ]);

    const r = await runWishlistAlerts(e);

    expect(r.fired).toBe(0); // no target_price → no drop alerts
    expect(r.retiring).toBe(1);
    expect(r.deals).toBe(1);
    expect(r.preorders).toBe(1);
    const types = await db.prepare(`SELECT alert_type FROM wishlist_alerts ORDER BY alert_type`).all<{ alert_type: string }>();
    expect(types.results.map(t => t.alert_type)).toEqual(['deal', 'preorder', 'retiring']);
  });
});

describe('runWishlistAlerts — blended value + confidence gate', () => {
  beforeEach(async () => {
    await applyTestTables(db, [
      'lego_sets', 'set_market_ext', 'user_collection', 'user_wishlist',
      'wishlist_alerts', 'user_prefs', 'push_subscriptions', 'set_valuation_state',
    ]);
  });

  it('fires on blended-below-target and records the blended value, not raw', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, current_value, blended_value, blended_confidence) VALUES ('BL-1','Blend Drop', 90, 55, 'high')`),
      db.prepare(`INSERT INTO user_wishlist (user_id, set_num, target_price) VALUES ('u1','BL-1', 60)`),
    ]);
    const r = await runWishlistAlerts(e);
    expect(r.fired).toBe(1);
    const alert = await db.prepare(`SELECT current_value FROM wishlist_alerts WHERE set_num='BL-1'`).first<{ current_value: number }>();
    expect(alert!.current_value).toBe(55); // blended, not the raw 90
  });

  it('does not fire when raw is below target but blended is above', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, current_value, blended_value, blended_confidence) VALUES ('BL-2','Raw Dip', 50, 80, 'high')`),
      db.prepare(`INSERT INTO user_wishlist (user_id, set_num, target_price) VALUES ('u1','BL-2', 60)`),
    ]);
    const r = await runWishlistAlerts(e);
    expect(r.fired).toBe(0);
  });

  it('does not fire on a low-confidence blend', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, current_value, blended_value, blended_confidence) VALUES ('BL-3','Low Conf', 90, 55, 'low')`),
      db.prepare(`INSERT INTO user_wishlist (user_id, set_num, target_price) VALUES ('u1','BL-3', 60)`),
    ]);
    const r = await runWishlistAlerts(e);
    expect(r.fired).toBe(0);
  });

  it('does not fire on a formula-only valuation with no blend', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, current_value, valuation_method) VALUES ('BL-4','Formula', 55, 'formula_bulk')`),
      db.prepare(`INSERT INTO user_wishlist (user_id, set_num, target_price) VALUES ('u1','BL-4', 60)`),
    ]);
    const r = await runWishlistAlerts(e);
    expect(r.fired).toBe(0);
  });

  it('estimate-only set with a live in-stock offer at target still fires', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, current_value, valuation_method) VALUES ('BL-5','Live Offer', 120, 'ai')`),
      db.prepare(`INSERT INTO set_market_ext (set_num, pa_lowest_offer, pa_in_stock, pa_best_merchant) VALUES ('BL-5', 58, 1, 'Shop')`),
      db.prepare(`INSERT INTO user_wishlist (user_id, set_num, target_price) VALUES ('u1','BL-5', 60)`),
    ]);
    const r = await runWishlistAlerts(e);
    expect(r.fired).toBe(1);
    const alert = await db.prepare(`SELECT current_value FROM wishlist_alerts WHERE set_num='BL-5'`).first<{ current_value: number }>();
    expect(alert!.current_value).toBe(58); // the live offer price
  });

  it('spike leg uses blended value and skips low-confidence jumps', async () => {
    await db.batch([
      // Corroborated blended spike: 150 blended > 1.3 * 100 -> fires.
      db.prepare(`INSERT INTO lego_sets (set_num, name, current_value, blended_value, blended_confidence) VALUES ('SP-1','Blend Spike', 90, 150, 'medium')`),
      db.prepare(`INSERT INTO user_collection (user_id, set_num, purchase_price, deleted_at) VALUES ('u1','SP-1', 100, NULL)`),
      // Uncorroborated raw spike: raw 200 jumps but blend is low-confidence -> silent.
      db.prepare(`INSERT INTO lego_sets (set_num, name, current_value, blended_value, blended_confidence) VALUES ('SP-2','Noisy Spike', 200, 200, 'low')`),
      db.prepare(`INSERT INTO user_collection (user_id, set_num, purchase_price, deleted_at) VALUES ('u1','SP-2', 100, NULL)`),
    ]);
    const r = await runWishlistAlerts(e);
    expect(r.spikes).toBe(1);
    const alert = await db.prepare(`SELECT set_num, current_value FROM wishlist_alerts WHERE alert_type='spike'`).first<{ set_num: string; current_value: number }>();
    expect(alert!.set_num).toBe('SP-1');
    expect(alert!.current_value).toBe(150);
  });

  it('fires one sell-target alert per upward crossing and re-arms below the target', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, current_value, valuation_method) VALUES ('T-1','Titanic', 760, 'market')`),
      db.prepare(`INSERT INTO user_collection (user_id, set_num, purchase_price, sell_target) VALUES ('u1','T-1', 612, 750)`),
      // Below its target: no alert.
      db.prepare(`INSERT INTO lego_sets (set_num, name, current_value, valuation_method) VALUES ('T-2','Falcon', 850, 'market')`),
      db.prepare(`INSERT INTO user_collection (user_id, set_num, purchase_price, sell_target) VALUES ('u1','T-2', 765, 1000)`),
    ]);

    const first = await runWishlistAlerts(e);
    expect(first.sellTargets).toBe(1);
    const alert = await db.prepare(`SELECT alert_type, target_price, current_value FROM wishlist_alerts WHERE set_num='T-1'`).first<{ alert_type: string; target_price: number; current_value: number }>();
    expect(alert).toEqual({ alert_type: 'sell_target', target_price: 750, current_value: 760 });

    // Still above the target the next day: latched, no duplicate.
    const second = await runWishlistAlerts(e);
    expect(second.sellTargets).toBe(0);

    // Falls back below, then crosses again: a new alert.
    await db.prepare(`UPDATE lego_sets SET current_value = 700 WHERE set_num='T-1'`).run();
    expect((await runWishlistAlerts(e)).sellTargets).toBe(0);
    await db.prepare(`UPDATE lego_sets SET current_value = 780 WHERE set_num='T-1'`).run();
    expect((await runWishlistAlerts(e)).sellTargets).toBe(1);
    const count = await db.prepare(`SELECT COUNT(*) AS n FROM wishlist_alerts WHERE alert_type='sell_target'`).first<{ n: number }>();
    expect(count!.n).toBe(2);
  });

  it('crosses a used copy on its used value, not the sealed one', async () => {
    await db.batch([
      // Sealed 800 is past the 600 target, but a built copy is worth 500: silent.
      db.prepare(`INSERT INTO lego_sets (set_num, name, current_value, ebay_used_value, valuation_method) VALUES ('U-1','Built Copy', 800, 500, 'market')`),
      db.prepare(`INSERT INTO set_valuation_state (set_num, condition, fair_value) VALUES ('U-1', 'used_complete', 500)`),
      db.prepare(`INSERT INTO user_collection (user_id, set_num, condition, sell_target) VALUES ('u1','U-1', 'used_good', 600)`),
      // Its used value (650) is past the target: fires at 650.
      db.prepare(`INSERT INTO lego_sets (set_num, name, current_value, ebay_used_value, valuation_method) VALUES ('U-2','Parts Copy', 900, 650, 'market')`),
      db.prepare(`INSERT INTO set_valuation_state (set_num, condition, fair_value) VALUES ('U-2', 'used_complete', 650)`),
      db.prepare(`INSERT INTO user_collection (user_id, set_num, condition, sell_target) VALUES ('u1','U-2', 'used_acceptable', 600)`),
    ]);
    expect((await runWishlistAlerts(e)).sellTargets).toBe(1);
    const alert = await db.prepare(`SELECT set_num, current_value FROM wishlist_alerts WHERE alert_type='sell_target'`).first<{ set_num: string; current_value: number }>();
    expect(alert).toEqual({ set_num: 'U-2', current_value: 650 });
  });

  it('ignores formula-only values for sell targets', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, current_value, valuation_method) VALUES ('F-1','Formula', 900, 'formula_bulk')`),
      db.prepare(`INSERT INTO user_collection (user_id, set_num, sell_target) VALUES ('u1','F-1', 500)`),
    ]);
    expect((await runWishlistAlerts(e)).sellTargets).toBe(0);
  });
});

describe('runWishlistAlerts — per-set switches', () => {
  beforeEach(async () => {
    await applyTestTables(db, [
      'lego_sets', 'set_market_ext', 'user_collection', 'user_wishlist',
      'wishlist_alerts', 'user_prefs', 'push_subscriptions',
    ]);
  });

  it('skips a drop alert when the set\'s "price reaches my target" switch is off', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, current_value, valuation_method) VALUES ('Q-1','Quiet', 50, 'market')`),
      db.prepare(`INSERT INTO user_wishlist (user_id, set_num, target_price, notify_target) VALUES ('u1','Q-1', 60, 0)`),
    ]);
    const r = await runWishlistAlerts(e);
    expect(r.fired).toBe(0);
  });

  it('honours the per-set retiring and back-in-stock switches', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, current_value, retired, lego_retiring_soon) VALUES ('R-2','Retiring', 30, 0, 1)`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, lego_availability) VALUES ('P-2','Preorder', 'pre_order')`),
      db.prepare(`INSERT INTO user_wishlist (user_id, set_num, notify_retiring) VALUES ('u1','R-2', 0)`),
      db.prepare(`INSERT INTO user_wishlist (user_id, set_num, notify_stock) VALUES ('u1','P-2', 0)`),
    ]);
    const r = await runWishlistAlerts(e);
    expect(r.retiring).toBe(0);
    expect(r.preorders).toBe(0);
  });

  it('a switched-off category records nothing: no in-app alert, no cooldown stamp', async () => {
    await db.batch([
      db.prepare(`INSERT INTO user_prefs (user_id, notify_price_drops, notify_big_moves, notify_retiring) VALUES ('u1', 1, 0, 0)`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, current_value, valuation_method) VALUES ('S-9','Spiker', 200, 'market')`),
      db.prepare(`INSERT INTO user_collection (user_id, set_num, purchase_price) VALUES ('u1','S-9', 100)`),
      db.prepare(`INSERT INTO lego_sets (set_num, name, current_value, retired, lego_retiring_soon) VALUES ('R-9','Retiring', 30, 0, 1)`),
      db.prepare(`INSERT INTO user_wishlist (user_id, set_num) VALUES ('u1','R-9')`),
      // A collector who wants both still gets both.
      db.prepare(`INSERT INTO user_collection (user_id, set_num, purchase_price) VALUES ('u2','S-9', 100)`),
      db.prepare(`INSERT INTO user_wishlist (user_id, set_num) VALUES ('u2','R-9')`),
    ]);
    const r = await runWishlistAlerts(e);
    expect(r.spikes).toBe(1);
    expect(r.retiring).toBe(1);
    const mine = await db.prepare(`SELECT COUNT(*) AS n FROM wishlist_alerts WHERE user_id='u1'`).first<{ n: number }>();
    expect(mine!.n).toBe(0);
    const stamp = await db.prepare(`SELECT spike_alerted_at FROM user_collection WHERE user_id='u1'`).first<{ spike_alerted_at: string | null }>();
    expect(stamp!.spike_alerted_at).toBeNull();
  });
});

describe('alert preferences', () => {
  const base = { email: null, discord_webhook_url: null, notify_price_drops: 1 };

  it('categories inherit the master switch until set', () => {
    expect(wantsAlert({ ...base }, 'moves')).toBe(true);
    expect(wantsAlert({ ...base, notify_price_drops: 0 }, 'moves')).toBe(false);
    expect(wantsAlert({ ...base, notify_price_drops: 0, notify_big_moves: 1 }, 'moves')).toBe(true);
    expect(wantsAlert({ ...base, notify_sell_targets: 0 }, 'sell')).toBe(false);
    expect(wantsAlert({ ...base, notify_sell_targets: 0 }, 'wishlist')).toBe(true);
  });

  it('quiet hours wrap midnight in the user\'s time zone', () => {
    const prefs = { ...base, quiet_hours: 1, quiet_start: 22, quiet_end: 8, timezone: 'Europe/Kyiv' };
    // 21:30 UTC = 00:30 in Kyiv (UTC+3 in summer) → quiet.
    expect(inQuietHours(prefs, new Date('2026-07-01T21:30:00Z'))).toBe(true);
    // 09:00 UTC = 12:00 in Kyiv → not quiet.
    expect(inQuietHours(prefs, new Date('2026-07-01T09:00:00Z'))).toBe(false);
    // Off switch or an empty window never silences.
    expect(inQuietHours({ ...prefs, quiet_hours: 0 }, new Date('2026-07-01T21:30:00Z'))).toBe(false);
    expect(inQuietHours({ ...prefs, quiet_end: 22 }, new Date('2026-07-01T21:30:00Z'))).toBe(false);
    // Unknown zone falls back to UTC.
    expect(inQuietHours({ ...prefs, timezone: 'Not/AZone' }, new Date('2026-07-01T23:00:00Z'))).toBe(true);
  });
});
