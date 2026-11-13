import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  processHealth, summarizeJobHealth, sortProcesses, processProblemLine, runDots,
  quotaRows, scanFunnel, aiTotals, pct, quotaLabel,
} from '../lib/admin-home.js';

describe('admin home: job health', () => {
  const procs = [
    { name: 'a', label: 'A', health: 'ok', schedule: 'Hourly', every_hours: 1, started_at: '2026-11-12 06:00:00' },
    { name: 'b', label: 'B', health: 'missed', schedule: 'Daily 13:00 UTC', every_hours: 24, missed_runs: 8, started_at: '2026-11-03 13:01:00' },
    { name: 'c', label: 'C', health: 'failing', schedule: 'Daily 03:00 UTC', every_hours: 24, consecutive_failures: 3, status: 'failed', error: 'stale: invocation ended before finish was recorded', started_at: '2026-11-12 03:00:47' },
    { name: 'd', label: 'D', status: 'idle', schedule: 'Manual' },
  ];

  it('falls back to the last status when the server verdict is absent', () => {
    assert.equal(processHealth({ status: 'failed' }), 'failing');
    assert.equal(processHealth({ status: 'running' }), 'running');
    assert.equal(processHealth({}), 'idle');
  });

  it('counts on-time, failing, missed and scheduled jobs', () => {
    const s = summarizeJobHealth(procs);
    assert.deepEqual({ ok: s.ok, failing: s.failing, missed: s.missed, idle: s.idle, problems: s.problems, scheduled: s.scheduled }, { ok: 1, failing: 1, missed: 1, idle: 1, problems: 2, scheduled: 3 });
  });

  it('puts missed jobs first, then failing, then healthy', () => {
    assert.deepEqual(sortProcesses(procs).map(p => p.name), ['b', 'c', 'a', 'd']);
  });

  it('explains problems in plain words', () => {
    assert.equal(processProblemLine(procs[1]), 'Missed 8 daily runs');
    assert.equal(processProblemLine(procs[2]), 'Cut off before finishing · 3 runs in a row');
    assert.equal(processProblemLine({ health: 'failing', status: 'failed', summary: 'failed 200 · figs 200 · priced 0', consecutive_failures: 1 }), 'failed 200 · figs 200 · priced 0');
    assert.equal(processProblemLine({ health: 'missed', every_hours: 1, missed_runs: 1 }), 'Missed its hourly run');
  });

  it('draws at most 12 run dots, oldest first', () => {
    const runs = Array.from({ length: 14 }, (_, i) => ({ status: i % 5 === 0 ? 'failed' : 'ok' }));
    const dots = runDots({ runs });
    assert.equal(dots.length, 12);
    assert.equal(dots[3], 'failed'); // run index 5
  });
});

describe('admin home: limits, funnel, totals', () => {
  it('warns about yesterday’s full limits even when today is quiet', () => {
    const rows = quotaRows(
      [{ service: 'decodo', used: 12, cap: 300 }, { service: 'ebay', used: 320, cap: 4000 }, { service: 'unused', used: 0, cap: 0 }],
      [{ service: 'decodo', used: 300, cap: 300 }, { service: 'bricklink', used: 3866, cap: 4000 }],
    );
    assert.deepEqual(rows.map(r => r.service), ['decodo', 'ebay']);
    assert.equal(rows[0].full_yesterday, true);
    assert.equal(rows[0].label, 'Decodo');
    assert.equal(rows[1].full_yesterday, false);
  });

  it('labels quota keys', () => {
    assert.equal(quotaLabel('gemini_paid'), 'Gemini (paid)');
    assert.equal(quotaLabel('describe_translate'), 'Describe Translate');
  });

  it('builds the scanner funnel and success rate', () => {
    assert.deepEqual(scanFunnel({ scan_attempt: 176, scan_success: 11, scan_path: 123, scan_fallback: 36 }), { attempts: 176, sent: 123, fallback: 36, success: 11, rate: 6 });
    assert.equal(scanFunnel({}).rate, null);
  });

  it('sums AI calls and spend', () => {
    assert.deepEqual(aiTotals({ recent: [{ calls: 4, cost_usd: 0.002 }, { calls: 10, cost_usd: 0.5 }] }), { calls: 14, cost: 0.502 });
    assert.deepEqual(aiTotals(null), { calls: 0, cost: 0 });
  });

  it('never divides by zero', () => {
    assert.equal(pct(3, 0), null);
    assert.equal(pct(39, 54), 72);
  });
});

import { scanOutcomes } from '../lib/admin-home.js';

describe('scan outcomes (server-side scan results)', () => {
  const rows = [
    { detail: 'image:hit:brickognize', n: 6 }, { detail: 'image:hit:local-ocr', n: 2 },
    { detail: 'image:miss:not-lego', n: 3 }, { detail: 'image:err:provider-timeout', n: 1 },
    { detail: 'barcode:hit:catalog', n: 4 }, { detail: 'barcode:miss:not-in-catalog', n: 4 },
    { detail: 'garbage', n: 9 },
  ];
  it('groups by mode with hit rate, answering steps and miss reasons', () => {
    const [image, barcode] = scanOutcomes(rows);
    assert.equal(image.mode, 'image');
    assert.deepEqual([image.total, image.hits, image.misses, image.errors, image.rate], [12, 8, 3, 1, 67]);
    assert.deepEqual(image.steps, { brickognize: 6, 'local-ocr': 2 });
    assert.deepEqual(image.reasons, { 'not-lego': 3, 'provider-timeout': 1 });
    assert.deepEqual([barcode.mode, barcode.total, barcode.rate], ['barcode', 8, 50]);
    assert.deepEqual(scanOutcomes(null), []);
  });
});

import {
  liveProgress, liveProgressLine, stoppedAtLine, adviceLabel, adviceCopyText, durationText,
} from '../lib/admin-home.js';

describe('admin home: live job progress', () => {
  const now = Date.parse('2026-11-13T10:00:00Z');
  it('counts progress from done/total and estimates time left', () => {
    const live = liveProgress({ health: 'running', status: 'running', started_at: '2026-11-13 09:59:00', heartbeat_at: '2026-11-13 09:59:55', progress_done: 50, progress_total: 200, progress_step: 'Valuing 10305-1' }, now);
    assert.equal(live.pct, 0.25);
    assert.equal(live.estimated, false);
    assert.equal(live.stalled, false);
    assert.equal(live.etaMs, 180000);
    assert.equal(liveProgressLine(live), 'Valuing 10305-1 · 50 of 200 · running 1m 00s · ~3m 00s left');
  });
  it('falls back to the usual run length when the job reports no counts', () => {
    const live = liveProgress({ health: 'running', started_at: '2026-11-13 09:59:30', heartbeat_at: '2026-11-13 09:59:50', typical_ms: 60000 }, now);
    assert.equal(live.estimated, true);
    assert.equal(live.pct, 0.5);
    assert.match(liveProgressLine(live), /~50% of its usual time/);
  });
  it('flags a run whose heartbeat stopped', () => {
    const live = liveProgress({ health: 'running', started_at: '2026-11-13 09:50:00', heartbeat_at: '2026-11-13 09:57:00' }, now);
    assert.equal(live.stalled, true);
    assert.match(liveProgressLine(live), /probably cut off/);
  });
  it('is null for jobs that are not running', () => {
    assert.equal(liveProgress({ health: 'ok' }, now), null);
  });
  it('says where a failed run stopped', () => {
    assert.equal(stoppedAtLine({ status: 'failed', progress_step: 'Matching rows to sets', progress_done: 2, progress_total: 7 }), 'Stopped at step 3 of 7: Matching rows to sets');
    assert.equal(stoppedAtLine({ status: 'failed', progress_step: 'Valuing 1-1', progress_done: 40, progress_total: 200 }), 'Stopped after 40 of 200 (Valuing 1-1)');
    assert.equal(stoppedAtLine({ status: 'ok', progress_step: 'x' }), '');
  });
  it('formats durations and advice text', () => {
    assert.equal(durationText(45000), '45s');
    assert.equal(durationText(3725000), '1h 02m');
    assert.equal(adviceLabel('code'), 'Code fix');
    const text = adviceCopyText({ name: 'pricecharting-bulk-fetch', label: 'PriceCharting (bulk fetch)', error: 'D1_ERROR: too many columns', consecutive_failures: 2 });
    assert.match(text, /PriceCharting \(bulk fetch\)/);
    assert.match(text, /Failed 2 runs in a row/);
  });
});
