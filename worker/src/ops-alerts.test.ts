/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runOpsHealthCheck } from './lib/ops-alerts';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;
const hook = { ...env, DISCORD_OPS_WEBHOOK: 'https://discord.test/hook' } as any;

const seedRun = (name: string, status: string, ago: string) =>
  db.prepare(`INSERT INTO cron_runs (name, started_at, status) VALUES (?1, datetime('now', ?2), ?3)`)
    .bind(name, ago, status);
const seedHealth = (service: string, okAgo: string | null, failAgo: string | null) =>
  db.prepare(
    `INSERT INTO integration_health (service, last_ok_at, last_fail_at, ok_count, fail_count, last_error)
     VALUES (?1, ${okAgo ? `datetime('now', '${okAgo}')` : 'NULL'},
                 ${failAgo ? `datetime('now', '${failAgo}')` : 'NULL'}, 1, 99, 'HTTP 502')`,
  ).bind(service);

describe('runOpsHealthCheck', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['cron_runs', 'integration_health']);
    vi.unstubAllGlobals();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reports nothing when everything is healthy', async () => {
    await db.batch([seedRun('valuate-sets', 'ok', '-1 hours'), seedRun('valuate-sets', 'ok', '-2 hours')]);
    const r = await runOpsHealthCheck(env as any);
    expect(r.alerts).toEqual([]);
    expect(r.notified).toBe(false);
  });

  it('flags a job that keeps failing, counting stuck "running" rows as failures', async () => {
    // The eBay incident: killed invocations leave 'running' rows that the stale
    // sweep only closes after 30 min — they are failures, not activity.
    await db.batch([
      seedRun('ebay-sold-scrape', 'failed', '-9 hours'),
      seedRun('ebay-sold-scrape', 'failed', '-6 hours'),
      seedRun('ebay-sold-scrape', 'running', '-3 hours'),
    ]);
    const r = await runOpsHealthCheck(env as any);
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0]).toMatchObject({ kind: 'cron', name: 'ebay-sold-scrape' });
    expect(r.alerts[0].detail).toMatch(/3 failed\/stalled/);
  });

  it('stays quiet for a flaky job that is below the threshold', async () => {
    await db.batch([seedRun('brickset-enrich', 'failed', '-5 hours'), seedRun('brickset-enrich', 'ok', '-1 hours')]);
    expect((await runOpsHealthCheck(env as any)).alerts).toEqual([]);
  });

  it('stays quiet for a job that failed repeatedly but has since recovered', async () => {
    await db.batch([
      seedRun('stockx-enrich', 'failed', '-9 hours'),
      seedRun('stockx-enrich', 'failed', '-8 hours'),
      seedRun('stockx-enrich', 'failed', '-7 hours'),
      seedRun('stockx-enrich', 'ok', '-1 hours'),
    ]);
    expect((await runOpsHealthCheck(env as any)).alerts).toEqual([]);
  });

  it('flags a provider that is failing with no success in 24h', async () => {
    await seedHealth('brightdata', '-6 days', '-20 minutes').run();
    const r = await runOpsHealthCheck(env as any);
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0]).toMatchObject({ kind: 'integration', name: 'brightdata' });
  });

  it('does not nag about a source that is switched off rather than broken', async () => {
    // BrickOwl: lots of lifetime failures, but nothing recent because nothing calls it.
    await seedHealth('brickowl', null, '-40 days').run();
    expect((await runOpsHealthCheck(env as any)).alerts).toEqual([]);
  });

  it('posts to the webhook when configured, and is a no-op without one', async () => {
    await seedHealth('brightdata', '-6 days', '-20 minutes').run();
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 })); // Discord replies 204, no body
    vi.stubGlobal('fetch', fetchSpy);

    expect((await runOpsHealthCheck(hook)).notified).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchSpy.mock.calls[0] as any)[1].body);
    expect(body.content).toMatch(/brightdata/);

    expect((await runOpsHealthCheck(env as any)).notified).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // no second post
  });

  it('survives a webhook that rejects, without throwing', async () => {
    await seedHealth('brightdata', null, '-20 minutes').run();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const r = await runOpsHealthCheck(hook);
    expect(r.alerts).toHaveLength(1);
    expect(r.notified).toBe(false);
  });
});
