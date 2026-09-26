import { env as testEnv } from 'cloudflare:test';
import type { Env } from './types';
const env = testEnv as unknown as Env;
import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index';
import { runUpcomingRefresh } from './jobs/upcoming-refresh';
vi.mock('./jobs/upcoming-refresh', () => ({ runUpcomingRefresh: vi.fn() }));

const event = { cron: '0 15 * * *' } as ScheduledEvent;
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

describe('scheduled lease and failure contract', () => {
  beforeEach(async () => {
    vi.mocked(runUpcomingRefresh).mockReset();
    await env.DB.prepare('DROP TABLE IF EXISTS cron_runs').run();
    await env.DB.prepare(`CREATE TABLE cron_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, started_at TEXT,
      finished_at TEXT, status TEXT, summary TEXT, error TEXT, duration_ms INTEGER
    )`).run();
  });
  it('admits only one overlapping invocation', async () => {
    let release!: () => void;
    vi.mocked(runUpcomingRefresh).mockImplementation(() => new Promise(resolve => {
      release = () => resolve({} as any);
    }));
    const first = worker.scheduled(event, env, ctx);
    for (let i = 0; i < 100 && !release; i++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(release).toBeTypeOf('function');
    try {
      await worker.scheduled(event, env, ctx);
      expect(runUpcomingRefresh).toHaveBeenCalledTimes(1);
    } finally { release(); await first; }
  });
  it('propagates job rejection and records failure', async () => {
    vi.mocked(runUpcomingRefresh).mockRejectedValue(new Error('injected job failure'));
    await expect(worker.scheduled(event, env, ctx)).rejects.toThrow('injected job failure');
    const row = await env.DB.prepare('SELECT status FROM cron_runs').first<any>();
    expect(row.status).toBe('failed');
  });
  it('fails closed if lease storage is unavailable', async () => {
    await env.DB.prepare('DROP TABLE cron_runs').run();
    await expect(worker.scheduled(event, env, ctx)).rejects.toThrow();
    expect(runUpcomingRefresh).not.toHaveBeenCalled();
  });
});
