import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { localMoneyToUsd, parseStrictMoneyInput, resolveMoneyInputContext, usdMoneyInputValue } from '../lib/money-input.js';

describe('strict money input', () => {
  it('accepts blank purchase prices and explicit zero without conflating them', () => {
    assert.deepEqual(parseStrictMoneyInput(''), { valid: true, blank: true, value: null, usd: null });
    assert.deepEqual(localMoneyToUsd('0', { rate: 0.92 }), { valid: true, blank: false, value: 0, usd: 0 });
    assert.deepEqual(localMoneyToUsd('', { rate: 0.92 }), { valid: true, blank: true, value: null, usd: null });
  });

  it('accepts only a trimmed unsigned plain decimal with one separator', () => {
    assert.equal(localMoneyToUsd(' 92,00 ', { rate: 0.92 }).usd, 100);
    for (const value of ['-1', '+1', '1,000.00', '1.000,00', '1e3', 'NaN', 'Infinity', '€1', '.5', '1.']) {
      assert.equal(parseStrictMoneyInput(value).valid, false, value);
    }
  });

  it('preserves full converted USD precision and rejects unsafe conversion', () => {
    assert.equal(localMoneyToUsd('1.23456789', { rate: 0.92 }).usd, 1.23456789 / 0.92);
    assert.equal(localMoneyToUsd('1', { rate: 0 }).valid, false);
    assert.equal(localMoneyToUsd('1', { rate: Number.POSITIVE_INFINITY }).valid, false);
    assert.equal(localMoneyToUsd(`0.${'0'.repeat(323)}1`, { rate: 1 }).valid, false);
  });

  it('formats the captured display value without changing stored USD', () => {
    assert.equal(usdMoneyInputValue(100.123456789, { rate: 0.92 }), '92.11');
    assert.equal(usdMoneyInputValue(null, { rate: 0.92 }), '');
  });

  it('uses USD explicitly when a non-USD FX snapshot is missing or malformed', () => {
    assert.deepEqual(resolveMoneyInputContext('EUR', { USD: 1 }), { currency: 'USD', rate: 1, fallback: true });
    assert.deepEqual(resolveMoneyInputContext('EUR', { EUR: '0.92' }), { currency: 'USD', rate: 1, fallback: true });
    assert.deepEqual(resolveMoneyInputContext('EUR', { EUR: true }), { currency: 'USD', rate: 1, fallback: true });
    assert.deepEqual(resolveMoneyInputContext('EUR', { EUR: 0.92 }), { currency: 'EUR', rate: 0.92, fallback: false });
  });
});
