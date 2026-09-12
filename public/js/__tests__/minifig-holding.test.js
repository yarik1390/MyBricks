import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedMinifigHoldingResponse, minifigHoldingsCSV, normalizeMinifigHolding, parseMinifigHoldingForm } from '../lib/minifig-holding.js';

test('minifig holding accepts zero, distinguishes blank, and omits an unchanged precise cost', () => {
  const context = { currency: 'EUR', rate: 0.8 };
  const base = { quantity: '2', condition: 'used_good', purchased_at: '2024-02-29', notes: 'Display copy' };
  assert.equal(parseMinifigHoldingForm({ ...base, purchase_price: '0' }, context).payload.purchase_price, 0);
  assert.equal(parseMinifigHoldingForm({ ...base, purchase_price: '' }, context).payload.purchase_price, null);
  const unchanged = parseMinifigHoldingForm({ ...base, purchase_price: '8.00' }, context, { priceChanged: false });
  assert.equal(Object.hasOwn(unchanged.payload, 'purchase_price'), false);
});

test('minifig holding rejects fractional quantity, impossible dates, and long notes', () => {
  const context = { currency: 'USD', rate: 1 };
  const base = { condition: 'unknown', purchase_price: '', notes: '' };
  assert.equal(parseMinifigHoldingForm({ ...base, quantity: '1.5', purchased_at: '' }, context).field, 'quantity');
  assert.equal(parseMinifigHoldingForm({ ...base, quantity: '1', purchased_at: '2023-02-29' }, context).field, 'purchased_at');
  assert.equal(parseMinifigHoldingForm({ ...base, quantity: '1', purchased_at: '', notes: 'x'.repeat(2001) }, context).field, 'notes');
});

test('minifig holding normalization and CSV preserve private fields and escaping', () => {
  assert.deepEqual(normalizeMinifigHolding({ quantity: 3, condition: 'new', purchase_price: 0, purchased_at: '', notes: '' }), {
    quantity: 3, condition: 'new', purchase_price: 0, purchased_at: null, notes: null,
  });
  const csv = minifigHoldingsCSV([{
    fig_num: 'sw0001', name: 'Hero, "Pilot"', series: 'Space',
    holding: { quantity: 2, condition: 'used_good', purchase_price: 0, purchased_at: '2024-02-29', notes: 'Line 1\nLine 2' },
  }]);
  assert.match(csv, /purchase_price_usd/);
  assert.match(csv, /sw0001,"Hero, ""Pilot""",Space,2,used_good,0,2024-02-29,"Line 1\nLine 2"/);
});

test('minifig save receipt must confirm identity, top-level quantity, and every holding field', () => {
  const holding = { quantity: 2, condition: 'unknown', purchase_price: null, purchased_at: null, notes: null };
  assert.deepEqual(confirmedMinifigHoldingResponse({ ok: true, fig_num: 'sw1', quantity: 2, holding }, 'sw1'), holding);
  assert.equal(confirmedMinifigHoldingResponse({ ok: true, fig_num: 'sw1', quantity: 2, holding: {} }, 'sw1'), null);
  assert.equal(confirmedMinifigHoldingResponse({ ok: true, fig_num: 'other', quantity: 2, holding }, 'sw1'), null);
  assert.equal(confirmedMinifigHoldingResponse({ ok: true, fig_num: 'sw1', quantity: 1, holding }, 'sw1'), null);
});
