/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { assessProcess, expectedEveryHours, parseRunTime, PROCESS_REGISTRY } from './lib/process-registry';
import { getAdminSummary } from './lib/admin-summary';
import { recordScanOutcome, scanOutcomeDetail } from './lib/analytics';
import { getRecentRuns, recordCronFinish, recordCronStart } from './lib/cron-runs';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;
const H = 3600_000;
const NOW = Date.parse('2026-11-12T06:40:00Z');
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString().replace('T', ' ').slice(0, 19);

describe('expectedEveryHours', () => {
  it('reads the interval from every schedule string in the registry', () => {
    expect(expectedEveryHours('Hourly (:15)')).toBe(1);
    expect(expectedEveryHours('Daily 13:00 UTC')).toBe(24);
    expect(expectedEveryHours('Daily 01:00 & 05:00 UTC')).toBe(24);
    expect(expectedEveryHours('Weekly Sun 04:00 UTC')).toBe(168);
    expect(expectedEveryHours('Manual')).toBeNull();
    expect(expectedEveryHours('')).toBeNull();
    for (const [name, info] of Object.entries(PROCESS_REGISTRY)) {
      if (info.schedule && !/^manual/i.test(info.schedule)) {
        expect(expectedEveryHours(info.schedule), name).not.toBeNull();
      }
    }
  });
  it('parses SQLite UTC timestamps', () => {
    expect(parseRunTime('2026-11-03 13:01:00')).toBe(Date.parse('2026-11-03T13:01:00Z'));
    expect(Number.isNaN(parseRunTime(null))).toBe(true);
  });
});

describe('assessProcess', () => {
  it('flags a daily job that stopped firing as missed, even if its last run was ok', () => {
    // The value model: last ran Nov 3 13:01, checked Nov 12 06:40.
    const a = assessProcess('Daily 13:00 UTC', [{ status: 'ok', started_at: '2026-11-03 13:01:00' }], NOW);
    expect(a.health).toBe('missed');
    expect(a.missed_runs).toBe(8);
  });
  it('allows slow slots and jitter before calling a run missed', () => {
    expect(assessProcess('Daily 13:00 UTC', [{ status: 'ok', started_at: at(30 * H) }], NOW).health).toBe('ok');
    expect(assessProcess('Daily 13:00 UTC', [{ status: 'ok', started_at: at(38 * H) }], NOW).health).toBe('missed');
    expect(assessProcess('Hourly', [{ status: 'ok', started_at: at(2 * H) }], NOW).health).toBe('ok');
    expect(assessProcess('Hourly', [{ status: 'ok', started_at: at(3 * H) }], NOW).health).toBe('missed');
  });
  it('counts consecutive failures from the newest run', () => {
    const runs = [
      { status: 'failed', started_at: at(4 * H) },
      { status: 'failed', started_at: at(28 * H) },
      { status: 'ok', started_at: at(52 * H) },
      { status: 'failed', started_at: at(76 * H) },
    ];
    const a = assessProcess('Daily 03:00 UTC', runs, NOW);
    expect(a.health).toBe('failing');
    expect(a.consecutive_failures).toBe(2);
  });
  it('never marks manual jobs missed and reports running / never-run states', () => {
    expect(assessProcess('Manual', [{ status: 'ok', started_at: at(900 * H) }], NOW).health).toBe('ok');
    expect(assessProcess('Hourly', [{ status: 'running', started_at: at(10 * H) }], NOW).health).toBe('running');
    expect(assessProcess('Hourly', [], NOW).health).toBe('idle');
  });
});

describe('run history', () => {
  beforeEach(() => applyTestTables(db, ['cron_runs']));
  it('returns up to 12 runs per process, newest first', async () => {
    for (let i = 0; i < 15; i++) {
      const id = await recordCronStart(env as any, 'valuate-sets');
      await recordCronFinish(env as any, id, 'valuate-sets', { ok: i % 2 === 0, summary: `run ${i}` });
    }
    const { history, latest } = await getRecentRuns(env as any);
    expect(history['valuate-sets']).toHaveLength(12);
    expect(history['valuate-sets'][0].summary).toBe('run 14');
    expect(latest['valuate-sets'].summary).toBe('run 14');
  });
});

describe('scan outcome metric', () => {
  beforeEach(() => applyTestTables(db, ['lego_themes', 'lego_sets', 'user_prefs', 'user_collection', 'user_wishlist', 'client_metrics_daily', 'api_quota', 'app_feedback']));

  it('names the mode, hit/miss/err and the answering step or reason', () => {
    expect(scanOutcomeDetail('image', { identified: true, provider: 'brickognize' }, 200)).toBe('image:hit:brickognize');
    expect(scanOutcomeDetail('image', { identified: true }, 200)).toBe('image:hit:ai');
    expect(scanOutcomeDetail('image', { identified: false, reason: 'not_lego' }, 200)).toBe('image:miss:not-lego');
    expect(scanOutcomeDetail('shelf', { identified: false }, 200)).toBe('shelf:miss:no-match');
    expect(scanOutcomeDetail('image', { identified: false, reason: 'provider_timeout' }, 503)).toBe('image:err:provider-timeout');
    expect(scanOutcomeDetail('barcode', { identified: true, barcode_source: 'taught_by_you' }, 200)).toBe('barcode:hit:taught-by-you');
    expect(scanOutcomeDetail('image', { identified: true, provider: 'x'.repeat(80) }, 200).length).toBeLessThanOrEqual(32);
  });

  it('counts per day and shows up in the admin summary', async () => {
    await recordScanOutcome(env as any, 'image', { identified: true, provider: 'local-ocr' }, 200);
    await recordScanOutcome(env as any, 'image', { identified: true, provider: 'local-ocr' }, 200);
    await recordScanOutcome(env as any, 'image', { identified: false, reason: 'not_lego' }, 200);
    const s = await getAdminSummary(env as any);
    expect(s.scan_outcomes_7d).toEqual([{ detail: 'image:hit:local-ocr', n: 2 }, { detail: 'image:miss:not-lego', n: 1 }]);
  });
});

describe('getAdminSummary', () => {
  beforeEach(() => applyTestTables(db, ['lego_themes', 'lego_sets', 'user_prefs', 'user_collection', 'user_wishlist', 'client_metrics_daily', 'api_quota', 'app_feedback']));

  it('counts accounts, holdings, events and market-priced held sets', async () => {
    await db.prepare(`INSERT INTO user_prefs (user_id, created_at) VALUES ('a', datetime('now','-2 days')), ('b', datetime('now','-20 days')), ('c', datetime('now','-90 days'))`).run();
    await db.prepare(`INSERT INTO lego_sets (set_num, name, valuation_method) VALUES ('1-1','A','market'), ('2-1','B','formula_bulk'), ('3-1','C','ebay_sold')`).run();
    await db.prepare(`INSERT INTO user_collection (user_id, set_num) VALUES ('a','1-1'), ('a','2-1')`).run();
    await db.prepare(`INSERT INTO user_wishlist (user_id, set_num) VALUES ('b','3-1')`).run();
    await db.prepare(`INSERT INTO client_metrics_daily (day, event, detail, count) VALUES (date('now'),'scan_attempt','',10), (date('now','-1 day'),'scan_success','',3), (date('now','-30 days'),'scan_attempt','',99)`).run();
    await db.prepare(`INSERT INTO api_quota (service, day, used, cap) VALUES ('decodo', date('now','-1 day'), 300, 300), ('decodo', date('now'), 4, 300)`).run();
    const s = await getAdminSummary(env as any);
    expect(s.users).toMatchObject({ total: 3, new_7d: 1, new_30d: 2, with_sets: 1, sets_logged: 2, wishlist_items: 1 });
    expect(s.events_7d).toEqual({ scan_attempt: 10, scan_success: 3 });
    expect(s.quota_yesterday).toEqual([{ service: 'decodo', used: 300, cap: 300 }]);
    expect(s.held_sets).toEqual({ total: 3, market_priced: 2 });
    expect(s.catalog).toEqual({ total: 3, market_priced: 2 });
    expect(s.contributions_pending).toBe(0); // table absent → fails open
  });
});
