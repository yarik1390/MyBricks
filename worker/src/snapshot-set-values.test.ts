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

  it('reconciles only valid generator-shaped eBay sold divergences inside the inclusive 3x band', async () => {
    const sets = [
      // New-condition boundaries use bl_new_value before current_value.
      ['NEW-LOW-BOUND', 999, 90, null, 'high'],
      ['NEW-UP-BOUND', 999, 90, null, null],
      ['NEW-LOW-DIV', 90, 100, null, null],
      ['NEW-UP-DIV', 90, 100, null, 'high'],
      // Used-condition hierarchy is used_value, then bl_new_value, then current_value.
      ['USED-DIRECT', 900, 300, 120, null],
      ['USED-BL-FALLBACK', 900, 60, null, null],
      ['USED-CURRENT-FALLBACK', 75, null, null, null],
      ['NO-REF', null, null, null, null],
      ['BAD-REF', -90, null, null, null],
      ['MISSING-OBSERVED', 90, null, null, null],
      ['MALFORMED', 90, null, null, null],
      ['TEXT-NUMERIC', 90, null, null, null],
      ['NEGATIVE', 90, null, null, null],
      ['WRONG-SOURCE', 90, null, null, null],
      ['WRONG-CONDITION', 90, null, null, null],
      ['WRONG-KEY', 90, null, null, null],
      ['OTHER-TYPE', 90, null, null, null],
      ['CLOSED', 90, null, null, null],
    ] as const;

    const anomalies = [
      ['ebay_sold:NEW-LOW-BOUND:value_divergence', 'NEW-LOW-BOUND', 'new_sealed', 'ebay_sold', 'value_divergence', JSON.stringify({ observed: 30 }), 'open'],
      ['ebay_sold:NEW-UP-BOUND:value_divergence', 'NEW-UP-BOUND', 'new_sealed', 'ebay_sold', 'value_divergence', JSON.stringify({ observed: 270 }), 'open'],
      ['ebay_sold:NEW-LOW-DIV:value_divergence', 'NEW-LOW-DIV', 'new_sealed', 'ebay_sold', 'value_divergence', JSON.stringify({ observed: 29.99 }), 'open'],
      ['ebay_sold:NEW-UP-DIV:value_divergence', 'NEW-UP-DIV', 'new_sealed', 'ebay_sold', 'value_divergence', JSON.stringify({ observed: 300.01 }), 'open'],
      ['ebay_sold_used:USED-DIRECT:value_divergence', 'USED-DIRECT', 'used_complete', 'ebay_sold', 'value_divergence', JSON.stringify({ observed: 40 }), 'open'],
      ['ebay_sold_used:USED-BL-FALLBACK:value_divergence', 'USED-BL-FALLBACK', 'used_complete', 'ebay_sold', 'value_divergence', JSON.stringify({ observed: 180 }), 'open'],
      ['ebay_sold_used:USED-CURRENT-FALLBACK:value_divergence', 'USED-CURRENT-FALLBACK', 'used_complete', 'ebay_sold', 'value_divergence', JSON.stringify({ observed: 25 }), 'open'],
      ['ebay_sold:NO-SET:value_divergence', 'NO-SET', 'new_sealed', 'ebay_sold', 'value_divergence', JSON.stringify({ observed: 90 }), 'open'],
      ['ebay_sold:NO-REF:value_divergence', 'NO-REF', 'new_sealed', 'ebay_sold', 'value_divergence', JSON.stringify({ observed: 90 }), 'open'],
      ['ebay_sold:BAD-REF:value_divergence', 'BAD-REF', 'new_sealed', 'ebay_sold', 'value_divergence', JSON.stringify({ observed: 90 }), 'open'],
      ['ebay_sold:MISSING-OBSERVED:value_divergence', 'MISSING-OBSERVED', 'new_sealed', 'ebay_sold', 'value_divergence', JSON.stringify({ reference: 90 }), 'open'],
      ['ebay_sold:MALFORMED:value_divergence', 'MALFORMED', 'new_sealed', 'ebay_sold', 'value_divergence', '{bad json', 'open'],
      ['ebay_sold:TEXT-NUMERIC:value_divergence', 'TEXT-NUMERIC', 'new_sealed', 'ebay_sold', 'value_divergence', JSON.stringify({ observed: '90' }), 'open'],
      ['ebay_sold:NEGATIVE:value_divergence', 'NEGATIVE', 'new_sealed', 'ebay_sold', 'value_divergence', JSON.stringify({ observed: -30 }), 'open'],
      ['ebay_sold:WRONG-SOURCE:value_divergence', 'WRONG-SOURCE', 'new_sealed', 'other', 'value_divergence', JSON.stringify({ observed: 90 }), 'open'],
      ['ebay_sold:WRONG-CONDITION:value_divergence', 'WRONG-CONDITION', 'used_good', 'ebay_sold', 'value_divergence', JSON.stringify({ observed: 90 }), 'open'],
      ['custom:WRONG-KEY:value_divergence', 'WRONG-KEY', 'new_sealed', 'ebay_sold', 'value_divergence', JSON.stringify({ observed: 90 }), 'open'],
      ['ebay_sold:OTHER-TYPE:day_move', 'OTHER-TYPE', 'new_sealed', 'ebay_sold', 'day_move', JSON.stringify({ observed: 90 }), 'open'],
      ['ebay_sold:CLOSED:value_divergence', 'CLOSED', 'new_sealed', 'ebay_sold', 'value_divergence', JSON.stringify({ observed: 90 }), 'resolved'],
    ] as const;

    await db.batch([
      ...sets.map(([setNum, currentValue, blNewValue, usedValue, confidence]) => db.prepare(`
        INSERT INTO lego_sets (set_num, name, current_value, bl_new_value, used_value, blended_confidence)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(setNum, setNum, currentValue, blNewValue, usedValue, confidence)),
      ...anomalies.map(([key, setNum, condition, source, type, detail, status]) => db.prepare(`
        INSERT INTO pricing_anomalies (
          anomaly_key, set_num, condition, source, anomaly_type, severity, detail_json, status
        ) VALUES (?, ?, ?, ?, ?, 'warning', ?, ?)
      `).bind(key, setNum, condition, source, type, detail, status)),
    ]);

    const r = await detectValueMovers(env as any);
    expect(r).toEqual({ flagged: 0, resolved: 5 });

    const { results } = await db.prepare(`
      SELECT anomaly_key, status, resolved_at
      FROM pricing_anomalies
      ORDER BY anomaly_key
    `).all<{ anomaly_key: string; status: string; resolved_at: string | null }>();
    const byKey = new Map(results.map((row) => [row.anomaly_key, row]));

    const resolved = [
      'ebay_sold:NEW-LOW-BOUND:value_divergence',
      'ebay_sold:NEW-UP-BOUND:value_divergence',
      'ebay_sold_used:USED-DIRECT:value_divergence',
      'ebay_sold_used:USED-BL-FALLBACK:value_divergence',
      'ebay_sold_used:USED-CURRENT-FALLBACK:value_divergence',
    ];
    for (const key of resolved) {
      expect(byKey.get(key)?.status, key).toBe('resolved');
      expect(byKey.get(key)?.resolved_at, key).toBeTruthy();
    }

    const stillOpen = anomalies
      .filter(([, , , , , , status]) => status === 'open')
      .map(([key]) => key)
      .filter((key) => !resolved.includes(key));
    for (const key of stillOpen) {
      expect(byKey.get(key)?.status, key).toBe('open');
      expect(byKey.get(key)?.resolved_at, key).toBeNull();
    }
    expect(byKey.get('ebay_sold:CLOSED:value_divergence')?.status).toBe('resolved');
  });

  it('preserves the pricing write-budget guard before anomaly reconciliation', async () => {
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, current_value) VALUES ('BUDGET-1', 'BUDGET-1', 90)`),
      db.prepare(`
        INSERT INTO pricing_anomalies (
          anomaly_key, set_num, condition, source, anomaly_type, severity, detail_json, status
        ) VALUES (
          'ebay_sold:BUDGET-1:value_divergence', 'BUDGET-1', 'new_sealed', 'ebay_sold',
          'value_divergence', 'warning', '{"observed":90}', 'open'
        )
      `),
      db.prepare(`
        INSERT INTO pricing_write_ledger (day, job, rows_written)
        VALUES (date('now'), 'budget-test', 1000000)
      `),
    ]);

    await expect(detectValueMovers(env as any)).resolves.toEqual({
      flagged: 0,
      resolved: 0,
      skipped: 'pricing write budget exhausted',
    });
    const row = await db.prepare(`
      SELECT status FROM pricing_anomalies
      WHERE anomaly_key='ebay_sold:BUDGET-1:value_divergence'
    `).first<{ status: string }>();
    expect(row?.status).toBe('open');
  });

  it('propagates value-divergence resolver SQL failures', async () => {
    await db.prepare(`DROP TABLE pricing_anomalies`).run();
    await db.prepare(`
      CREATE TABLE pricing_anomalies (
        anomaly_key TEXT PRIMARY KEY, set_num TEXT, condition TEXT, source TEXT,
        anomaly_type TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'warning',
        status TEXT NOT NULL DEFAULT 'open', first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT
      )
    `).run();

    await expect(detectValueMovers(env as any)).rejects.toThrow(/detail_json/i);
  });
});

