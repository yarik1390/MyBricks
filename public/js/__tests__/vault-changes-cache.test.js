import test from 'node:test';
import assert from 'node:assert/strict';

const memory = new Map();
globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)), removeItem: key => memory.delete(key) };
globalThis.location = { hash: '', href: 'https://app.test/', origin: 'https://app.test' };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
globalThis.window = { IMAGE_BASE: '', addEventListener() {}, dispatchEvent() {}, location: globalThis.location };
const { state, invalidatePortfolio } = await import('../state.js');

test('a collection mutation drops the cached What changed digest with the portfolio', () => {
  state.portfolio = { items: [{ set_num: '10294-1' }] };
  state.vaultChanges = { data: { realized: { gain: 0, sales: 0 } }, days: 7, ts: Date.now(), owner: 'u1' };
  invalidatePortfolio();
  assert.equal(state.portfolio, null);
  // Otherwise Insights and the Vault keep showing pre-sale realized gains and
  // movers for a removed holding for up to five minutes.
  assert.equal(state.vaultChanges, null);
});
