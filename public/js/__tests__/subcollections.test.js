import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionProgress, collectorInsights, normalizeSubcollection } from '../lib/subcollections.js';

test('list progress counts distinct owned sets, excludes deleted and pending additions, and empty is not complete', () => {
  const items = [{ set_num: '123', quantity: 5 }, { set_num: '123-1', quantity: 1 }, { set_num: '456-1', deleted_at: '2026-01-01' }, { set_num: '789-1', _pendingCollectionNew: true }];
  assert.deepEqual(collectionProgress({ set_nums: ['123', '123-1', '456-1', '789-1'] }, items), { owned: 1, total: 3, missing: ['456-1', '789-1'], complete: false });
  assert.equal(collectionProgress({ set_nums: [] }, items).complete, false);
  assert.equal(collectionProgress({ set_nums: ['123-1'] }, items).complete, true);
});

test('insights distinguish free purchases from missing records and never infer complete from unknown', () => {
  const rows = [
    { set_num: '1', purchase_price: 0, purchased_at: '2026-01-01', is_complete: true },
    { set_num: '2', purchase_price: null, purchased_at: null, is_complete: 1, missing_pieces: 3 },
    { set_num: '3', purchase_price: '', purchased_at: '', is_complete: null },
    { set_num: '4', purchase_price: null, deleted_at: '2026-01-01' },
  ];
  const result = collectorInsights(rows);
  assert.equal(result.distinct, 3);
  assert.deepEqual(result.missingCost, [rows[1], rows[2]]);
  assert.deepEqual(result.missingDate, [rows[1], rows[2]]);
  assert.deepEqual(result.complete, [rows[0]]);
  assert.deepEqual(result.incomplete, [rows[1]]);
});

test('list validation canonicalizes and bounds input without allowing markup as set numbers', () => {
  assert.deepEqual(normalizeSubcollection({ name: ' Display ', set_nums: ['123', '123-1'], revision: 0 }), { name: 'Display', set_nums: ['123-1'], revision: 0 });
  for (const body of [{ name: ' ', set_nums: [], revision: 0 }, { name: 'x', set_nums: ['<script>'], revision: 0 }, { name: 'x', set_nums: Array(201).fill('123'), revision: 0 }, { name: 'x', set_nums: [], revision: -1 }]) assert.throws(() => normalizeSubcollection(body));
});
