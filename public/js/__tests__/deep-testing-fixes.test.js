// Deep-testing report fixes (2026-11-13): pure helpers behind BUG-004
// (purchase price/date checks) and BUG-007 (price-history spike filter).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { purchaseInputIssue, dropHistorySpikes } from '../lib/pure.js';

describe('purchaseInputIssue', () => {
  it('rejects a purchase date in the future', () => {
    assert.equal(purchaseInputIssue({ usd: 100, date: '2026-11-27', today: '2026-11-13' }), 'future');
    assert.equal(purchaseInputIssue({ usd: 100, date: '2026-11-13', today: '2026-11-13' }), null);
  });
  it('flags impossible and suspiciously high prices', () => {
    assert.equal(purchaseInputIssue({ usd: 99_999_999 }), 'impossible');
    assert.equal(purchaseInputIssue({ usd: 5000, valueUsd: 500 }), 'high');
    assert.equal(purchaseInputIssue({ usd: 700, valueUsd: 600 }), null);
    // Cheap sets: a few dollars over five times the value is not worth a prompt.
    assert.equal(purchaseInputIssue({ usd: 60, valueUsd: 10 }), null);
    assert.equal(purchaseInputIssue({ usd: null }), null);
  });
});

describe('dropHistorySpikes', () => {
  const rows = (vals) => vals.map((v, i) => ({ snapshot_date: `2026-06-${String(10 + i).padStart(2, '0')}`, current_value: v }));
  it('drops a lone first-point spike that faked "Down 60%"', () => {
    assert.deepEqual(dropHistorySpikes(rows([1100, 430, 425, 426, 428, 426])).map((r) => r.current_value), [430, 425, 426, 428, 426]);
  });
  it('drops an isolated spike in the middle', () => {
    assert.deepEqual(dropHistorySpikes(rows([100, 101, 400, 102, 103])).map((r) => r.current_value), [100, 101, 102, 103]);
  });
  it('keeps a real move that spans several snapshots', () => {
    const vals = [100, 105, 110, 180, 190, 200, 210];
    assert.deepEqual(dropHistorySpikes(rows(vals)).map((r) => r.current_value), vals);
  });
  it('leaves short histories alone', () => {
    const vals = [1000, 400, 400];
    assert.deepEqual(dropHistorySpikes(rows(vals)).map((r) => r.current_value), vals);
  });
});
