/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { priceChartingBulkNeedsRetry } from './jobs/pricecharting-bulk';

const db = (env as any).DB as D1Database;
const at = (iso: string) => Date.parse(iso);

async function lastResult(value: Record<string, unknown> | null) {
  await db.prepare(`DELETE FROM app_settings`).run();
  if (value) {
    await db.prepare(`INSERT INTO app_settings (key,value,updated_at) VALUES ('pc_bulk_last_result',?1,datetime('now'))`)
      .bind(JSON.stringify(value)).run();
  }
}

describe('PriceCharting bulk download retry', () => {
  beforeEach(async () => {
    await db.prepare(`DROP TABLE IF EXISTS app_settings`).run();
    await db.prepare(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)`).run();
  });

  it('retries a failed download an hour later on the same import day', async () => {
    await lastResult({ rows: 0, matched: 0, unmatched: 0, updated: 0, skipped: 'download HTTP 503', finished_at: '2026-10-12T04:30:17Z' });
    expect(await priceChartingBulkNeedsRetry(env as any, at('2026-10-12T05:15:00Z'))).toBe(false); // too soon
    expect(await priceChartingBulkNeedsRetry(env as any, at('2026-10-12T05:30:00Z'))).toBe(true);
    expect(await priceChartingBulkNeedsRetry(env as any, at('2026-10-13T02:15:00Z'))).toBe(true);
  });

  it('stops once the next daily slot has passed or the download succeeded', async () => {
    await lastResult({ rows: 0, matched: 0, unmatched: 0, updated: 0, skipped: 'download failed: timeout', finished_at: '2026-10-12T04:30:17Z' });
    expect(await priceChartingBulkNeedsRetry(env as any, at('2026-10-13T05:15:00Z'))).toBe(false);
    await lastResult({ rows: 13283, matched: 3138, unmatched: 10145, updated: 3138, finished_at: '2026-10-12T04:31:11Z' });
    expect(await priceChartingBulkNeedsRetry(env as any, at('2026-10-12T06:15:00Z'))).toBe(false);
  });

  it('does not retry a wrong-token body or a missing record', async () => {
    await lastResult({ rows: 0, matched: 0, unmatched: 0, updated: 0, skipped: 'unexpected (non-CSV) download body', finished_at: '2026-10-12T04:30:17Z' });
    expect(await priceChartingBulkNeedsRetry(env as any, at('2026-10-12T06:15:00Z'))).toBe(false);
    await lastResult(null);
    expect(await priceChartingBulkNeedsRetry(env as any, at('2026-10-12T06:15:00Z'))).toBe(false);
  });
});
