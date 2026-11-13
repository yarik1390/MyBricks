import { describe, expect, it } from 'vitest';
import { purchasePriceError, isFuturePurchaseDate } from './purchase-validate';
import { promoLooksForeign } from './promotions';

describe('purchase validation (deep-testing BUG-004)', () => {
  it('accepts normal prices and rejects typos', () => {
    expect(purchasePriceError(null)).toBeNull();
    expect(purchasePriceError(849.99)).toBeNull();
    expect(purchasePriceError(-1)).toMatch(/>= 0/);
    expect(purchasePriceError(99_999_999)).toMatch(/too high/);
  });
  it('rejects purchase dates in the future, with a day of slack', () => {
    const now = Date.parse('2026-11-13T12:00:00Z');
    expect(isFuturePurchaseDate('2026-11-27', now)).toBe(true);
    expect(isFuturePurchaseDate('2026-11-14', now)).toBe(false);
    expect(isFuturePurchaseDate('2017-10-01', now)).toBe(false);
  });
});

describe('promoLooksForeign (deep-testing BUG-010/011)', () => {
  it('spots the US copy filed under the UK store', () => {
    expect(promoLooksForeign({ market: 'GB', currency: 'GBP', url: 'https://www.lego.com/en-us/categories/sales-and-deals', details: null })).toBe(true);
    expect(promoLooksForeign({ market: 'GB', currency: 'GBP', url: 'https://www.lego.com/en-gb/offers', details: 'Spend over $130 to unlock this gift' })).toBe(true);
  });
  it('keeps genuine local offers and every US offer', () => {
    expect(promoLooksForeign({ market: 'GB', currency: 'GBP', url: 'https://www.lego.com/en-gb/offers', details: 'Spend over £120 to unlock this gift' })).toBe(false);
    expect(promoLooksForeign({ market: 'CA', currency: 'CAD', url: 'https://www.lego.com/en-ca/offers', details: 'Spend $170' })).toBe(false);
    expect(promoLooksForeign({ market: 'US', currency: 'USD', url: 'https://www.lego.com/en-us/offers', details: 'Spend over $130' })).toBe(false);
  });
});
