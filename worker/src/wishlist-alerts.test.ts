/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { runWishlistAlerts } from './jobs/wishlist-alerts';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;
// No RESEND_API_KEY / VAPID keys / discord webhooks → the detection logic runs
// and writes wishlist_alerts rows, but every outbound notification is skipped.
const e = { ...env, RESEND_API_KEY: '', VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '' } as any;

describe('runWishlistAlerts', () => {
  beforeEach(async () => {
    await applyTestTables(db, [
      'lego_sets', 'set_market_ext', 'user_collection', 'user_wishlist',
      'wishlist_alerts', 'user_prefs', 'push_subscriptions',
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
      'wishlist_alerts', 'user_prefs', 'push_subscriptions',
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
});

