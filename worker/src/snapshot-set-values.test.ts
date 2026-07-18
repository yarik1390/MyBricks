/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { detectValueMovers, runSnapshotSetValues } from './jobs/snapshot-set-values';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;

describe('runSnapshotSetValues', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'user_collection', 'user_wishlist', 'set_value_history', 'minifigs', 'minifig_value_history']);
  });

  it('snapshots the displayed value for owned sets and priced minifigs, and prunes ancient rows', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, blended_value, current_value, bl_new_value) VALUES ('X-1','X', 100, 90, 70)`),
      db.prepare(`INSERT INTO user_collection (user_id, set_num) VALUES ('u1','X-1')`),
      db.prepare(`INSERT INTO minifigs (fig_num, name, current_value, ebay_value) VALUES ('fig-1','Luke', 25, 20)`),
      // Ancient history row (>400d) that must be pruned this run.
      db.prepare(`INSERT INTO set_value_history (set_num, snapshot_date, current_value) VALUES ('X-1', DATE('now','-500 days'), 10)`),
    ]);

    const r = await runSnapshotSetValues(env as any);

    expect(r.snapshotted).toBeGreaterThanOrEqual(1);
    expect(r.figSnapshotted).toBe(1);
    expect(r.pruned).toBe(1); // the 500-day-old row

    const today = await db.prepare(`SELECT current_value FROM set_value_history WHERE set_num='X-1' AND snapshot_date = DATE('now')`).first<{ current_value: number }>();
    expect(today!.current_value).toBe(100); // blended value preferred over current_value
    const fig = await db.prepare(`SELECT current_value FROM minifig_value_history WHERE fig_num='fig-1' AND snapshot_date = DATE('now')`).first<{ current_value: number }>();
    expect(fig!.current_value).toBe(25);
  });

  it('skips sets with no displayable value', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, blended_value, current_value) VALUES ('N-1','N', NULL, NULL)`),
      db.prepare(`INSERT INTO user_collection (user_id, set_num) VALUES ('u1','N-1')`),
    ]);
    const r = await runSnapshotSetValues(env as any);
    expect(r.snapshotted).toBe(0);
  });
});

describe('detectValueMovers (day-over-day anomaly detector)', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'user_collection', 'user_wishlist', 'set_value_history', 'minifigs', 'minifig_value_history', 'pricing_anomalies', 'pricing_write_ledger']);
  });

  const seed = (setNum: string, prev: number, curr: number, confidence: string | null = null) => [
    db.prepare(`INSERT INTO lego_sets (set_num, name, blended_confidence) VALUES (?, ?, ?)`).bind(setNum, setNum, confidence),
    db.prepare(`INSERT INTO set_value_history (set_num, snapshot_date, current_value) VALUES (?, DATE('now','-1 day'), ?)`).bind(setNum, prev),
    db.prepare(`INSERT INTO set_value_history (set_num, snapshot_date, current_value) VALUES (?, DATE('now'), ?)`).bind(setNum, curr),
  ];

  it('flags a +40% jump on a medium-confidence set, severity warning', async () => {
    await db.batch(seed('MV-1', 100, 145, 'medium'));
    const r = await detectValueMovers(env as any);
    expect(r.flagged).toBe(1);
    const row = await db.prepare(`SELECT severity, status FROM pricing_anomalies WHERE anomaly_key='blend:MV-1:day_move'`).first<{ severity: string; status: string }>();
    expect(row!.status).toBe('open');
    expect(row!.severity).toBe('warning');
  });

  it('escalates to error severity at >= 2.5x', async () => {
    await db.batch(seed('MV-2', 100, 260, 'low'));
    await detectValueMovers(env as any);
    const row = await db.prepare(`SELECT severity FROM pricing_anomalies WHERE anomaly_key='blend:MV-2:day_move'`).first<{ severity: string }>();
    expect(row!.severity).toBe('error');
  });

  it('does not flag high-confidence sets or small moves or penny sets', async () => {
    await db.batch([
      ...seed('HC-1', 100, 200, 'high'),   // big move, but corroborated
      ...seed('SM-1', 100, 120, 'medium'), // +20% — inside the band
      ...seed('PN-1', 10, 30, 'medium'),   // prev < $25 floor
    ]);
    const r = await detectValueMovers(env as any);
    expect(r.flagged).toBe(0);
  });

  it('re-running upserts the same key without duplicating', async () => {
    await db.batch(seed('MV-3', 100, 50, 'medium'));
    await detectValueMovers(env as any);
    await detectValueMovers(env as any);
    const rows = await db.prepare(`SELECT COUNT(*) AS n FROM pricing_anomalies WHERE set_num='MV-3'`).first<{ n: number }>();
    expect(rows!.n).toBe(1);
  });

  it('auto-resolves an open day_move once the value reverts into the band', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, blended_confidence) VALUES ('RV-1','RV-1','medium')`),
      db.prepare(`INSERT INTO pricing_anomalies (anomaly_key, set_num, anomaly_type, severity, status) VALUES ('blend:RV-1:day_move','RV-1','day_move','warning','open')`),
      db.prepare(`INSERT INTO set_value_history (set_num, snapshot_date, current_value) VALUES ('RV-1', DATE('now','-1 day'), 100)`),
      db.prepare(`INSERT INTO set_value_history (set_num, snapshot_date, current_value) VALUES ('RV-1', DATE('now'), 105)`),
    ]);
    const r = await detectValueMovers(env as any);
    expect(r.flagged).toBe(0);
    expect(r.resolved).toBe(1);
    const row = await db.prepare(`SELECT status, resolved_at FROM pricing_anomalies WHERE anomaly_key='blend:RV-1:day_move'`).first<{ status: string; resolved_at: string | null }>();
    expect(row!.status).toBe('resolved');
    expect(row!.resolved_at).toBeTruthy();
  });
});

