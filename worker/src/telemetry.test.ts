/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import app from './index';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;

// The telemetry route mirrors SLO events into D1 via waitUntil — collect those
// background promises so assertions run after the upsert lands.
const post = async (body: unknown) => {
  const tasks: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => tasks.push(p), passThroughOnException: () => {} };
  const res = await app.fetch(new Request('http://localhost/api/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), env, ctx as any);
  await Promise.all(tasks);
  return res;
};

describe('POST /api/telemetry (client metrics mirror)', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['client_metrics_daily']);
  });

  it('mirrors scan events into the daily counter, keyed by mode', async () => {
    expect((await post({ e: 'scan_attempt', d: 'barcode' })).status).toBe(204);
    expect((await post({ e: 'scan_attempt', d: 'barcode' })).status).toBe(204);
    expect((await post({ e: 'scan_success', d: 'barcode' })).status).toBe(204);
    const rows = await db.prepare(
      `SELECT event, detail, count FROM client_metrics_daily ORDER BY event`,
    ).all<{ event: string; detail: string; count: number }>();
    expect(rows.results).toEqual([
      { event: 'scan_attempt', detail: 'barcode', count: 2 },
      { event: 'scan_success', detail: 'barcode', count: 1 },
    ]);
  });

  it('client_error collapses detail (bounded PK cardinality)', async () => {
    await post({ e: 'client_error', d: 'TypeError: x is not a function @app.js:42' });
    const row = await db.prepare(`SELECT detail, count FROM client_metrics_daily WHERE event='client_error'`).first<{ detail: string; count: number }>();
    expect(row!.detail).toBe('');
    expect(row!.count).toBe(1);
  });

  it('route_view stays AE-only (no D1 row) and unknown events are ignored', async () => {
    expect((await post({ e: 'route_view', d: 'vault' })).status).toBe(204);
    expect((await post({ e: 'evil_event', d: 'x' })).status).toBe(204);
    const n = await db.prepare(`SELECT COUNT(*) AS n FROM client_metrics_daily`).first<{ n: number }>();
    expect(n!.n).toBe(0);
  });
});
