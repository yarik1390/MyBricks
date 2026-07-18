/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { runWeeklyDigest } from './jobs/weekly-digest';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;
// No RESEND/VAPID keys → detection runs, outbound sends are skipped.
const e = { ...env, RESEND_API_KEY: '', VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '' } as any;

describe('runWeeklyDigest', () => {
  beforeEach(async () => {
    await applyTestTables(db, [
      'lego_sets', 'user_collection', 'user_prefs', 'portfolio_snapshots',
      'set_value_history', 'wishlist_alerts', 'push_subscriptions',
    ]);
  });

  it('sends only to opted-in users with a snapshot', async () => {
    await db.batch([
      db.prepare(`INSERT INTO user_prefs (user_id, notify_weekly_digest) VALUES ('u-in', 1)`),
      db.prepare(`INSERT INTO user_prefs (user_id, notify_weekly_digest) VALUES ('u-out', 0)`),
      db.prepare(`INSERT INTO user_prefs (user_id, notify_weekly_digest) VALUES ('u-empty', 1)`), // opted in, no snapshots
      db.prepare(`INSERT INTO portfolio_snapshots (user_id, snapshot_date, total_value, set_count) VALUES ('u-in', date('now','-7 days'), 500, 4)`),
      db.prepare(`INSERT INTO portfolio_snapshots (user_id, snapshot_date, total_value, set_count) VALUES ('u-in', date('now'), 550, 4)`),
      db.prepare(`INSERT INTO portfolio_snapshots (user_id, snapshot_date, total_value, set_count) VALUES ('u-out', date('now'), 100, 1)`),
    ]);
    const r = await runWeeklyDigest(e);
    expect(r.eligible).toBe(2); // u-in + u-empty (opted in)
    expect(r.sent).toBe(1);     // only u-in has a snapshot to talk about
  });

  it('is a clean no-op when nobody opted in', async () => {
    await db.prepare(`INSERT INTO user_prefs (user_id, notify_weekly_digest) VALUES ('u1', 0)`).run();
    const r = await runWeeklyDigest(e);
    expect(r.eligible).toBe(0);
    expect(r.sent).toBe(0);
  });
});
