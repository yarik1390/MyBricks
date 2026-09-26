import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  hasKnownCost, vaultTotals, themeAllocation, retirementRadar, gainersAndLosers,
  recordCompleteness, clipHistory, changeSinceFromSnapshots, changesWindowDays, changeItems,
} from '../lib/vault-insights.js';

const SETS = [
  { set_num: '75192-1', theme: 'Star Wars', market_value: 850, purchase_price: 765, pieces: 7541, retired: 1 },
  { set_num: '10294-1', theme: 'Icons', market_value: 760, purchase_price: 612, pieces: 9090, retired: 1 },
  { set_num: '42143-1', theme: 'Technic', market_value: 372, purchase_price: 360, pieces: 3778, retired: 0, lego_retiring_soon: 1 },
  { set_num: '21333-1', theme: 'Ideas', market_value: 205, purchase_price: 153, pieces: 2316, retired: 1 },
  { set_num: '76419-1', theme: 'Harry Potter', market_value: 150, purchase_price: null, pieces: 2660, retired: 0 },
  { set_num: '10497-1', theme: 'Icons', market_value: 88, purchase_price: 90, pieces: 1254, retired: 0 },
];

describe('vault totals', () => {
  it('treats zero as a known cost and blank as unknown', () => {
    assert.equal(hasKnownCost({ purchase_price: 0 }), true);
    assert.equal(hasKnownCost({ purchase_price: null }), false);
    assert.equal(hasKnownCost({ purchase_price: '' }), false);
    assert.equal(hasKnownCost({ purchase_price: -1 }), false);
  });

  it('matches the canvas sums: paper gain only over priced sets', () => {
    const t = vaultTotals(SETS);
    assert.equal(t.value, 2425);
    assert.equal(t.paid, 1980);
    assert.equal(t.paperGain, 295);
    assert.equal(t.gainPct.toFixed(1), '14.9');
    assert.equal(t.pieces, 26639);
    assert.equal(t.sets, 6);
    assert.equal(t.unpriced, 1);
  });

  it('multiplies by quantity and has no percentage without a paid basis', () => {
    const t = vaultTotals([{ set_num: 'a', market_value: 10, quantity: 3, purchase_price: null, pieces: 5 }]);
    assert.deepEqual([t.value, t.holdings, t.pieces, t.gainPct], [30, 3, 15, null]);
  });
});

describe('insights', () => {
  it('allocates value by theme with a folded tail', () => {
    const a = themeAllocation(SETS, undefined, { limit: 3 });
    assert.deepEqual(a.rows.map(r => r.theme), ['Star Wars', 'Icons', 'Technic']);
    assert.equal(Math.round(a.rows[0].share), 35);
    assert.equal(a.rest, 2);
    assert.equal(a.total, 2425);
  });

  it('counts retired and retiring-soon holdings once each', () => {
    const r = retirementRadar([...SETS, SETS[0]]);
    assert.deepEqual([r.total, r.retired, r.retiring], [6, 3, 1]);
    assert.equal(r.retiringRows[0].set_num, '42143-1');
  });

  it('ranks gainers and losers against the price paid', () => {
    const { gainers, losers } = gainersAndLosers(SETS);
    assert.deepEqual(gainers.map(g => g.row.set_num), ['21333-1', '10294-1', '75192-1']);
    assert.deepEqual(losers.map(l => l.row.set_num), ['10497-1']);
  });

  it('scores record completeness on known cost', () => {
    const r = recordCompleteness(SETS);
    assert.equal(r.pct, 83);
    assert.equal(r.missingCost.length, 1);
    assert.equal(r.missingDate.length, 6);
    assert.equal(recordCompleteness([]).pct, 0);
  });
});

describe('what changed', () => {
  const now = new Date('2026-09-23T12:00:00Z');
  const snaps = [
    { snapshot_date: '2026-09-10', total_value: 2300 },
    { snapshot_date: '2026-09-21', total_value: 2383 },
    { snapshot_date: '2026-09-23', total_value: 2425 },
  ];

  it('clips history by day count', () => {
    assert.equal(clipHistory(snaps, 7, now).length, 2);
    assert.equal(clipHistory(snaps, 9999, now).length, 3);
  });

  it('measures change from the last snapshot on or before the window start', () => {
    const c = changeSinceFromSnapshots(snaps, '2026-09-21', 2425);
    assert.equal(c.since, '2026-09-21');
    assert.equal(c.delta, 42);
    assert.equal(c.pct.toFixed(1), '1.8');
    assert.equal(changeSinceFromSnapshots(snaps, '2026-09-01', 2425), null);
  });

  it('looks back from the last visit, clamped to 1–30 days', () => {
    assert.equal(changesWindowDays(null, now), 7);
    assert.equal(changesWindowDays('2026-09-21T08:00:00Z', now), 2);
    assert.equal(changesWindowDays('2026-09-23T01:00:00Z', now), 1);
    assert.equal(changesWindowDays('2026-01-01T00:00:00Z', now), 30);
    assert.equal(changesWindowDays('2027-01-01T00:00:00Z', now), 7);
  });

  it('orders target hits before spikes and retirement news', () => {
    const items = changeItems({
      alerts: [
        { alert_type: 'spike', set_num: '75192-1', set_name: 'Falcon' },
        { alert_type: 'sell_target', set_num: '10294-1', set_name: 'Titanic' },
        { alert_type: null, set_num: '21333-1', set_name: 'Starry Night' },
      ],
      retiringOwned: [{ set_num: '42143-1', name: 'Ferrari' }],
      retiringWished: [{ set_num: '10276-1', name: 'Colosseum' }],
    });
    assert.deepEqual(items.map(i => i.kind), ['drop', 'sell_target', 'spike', 'retiringOwned', 'retiringWished']);
    assert.equal(items[0].name, 'Starry Night');
  });
});
