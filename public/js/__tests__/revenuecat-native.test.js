import test from 'node:test';
import assert from 'node:assert/strict';

function tokenWithSub(sub) {
  const b64 = Buffer.from(JSON.stringify({ sub })).toString('base64url');
  return `x.${b64}.x`;
}

async function loadRevenueCat({ userId = null, apiKey = 'goog_test', purchaseError = null } = {}) {
  const calls = [];
  const plugins = {
    Purchases: {
      async configure(args) { calls.push(['configure', args]); },
      async logIn(args) { calls.push(['logIn', args]); },
      async getCustomerInfo() { return { customerInfo: { entitlements: { active: {} } } }; },
      async getOfferings() {
        return { current: { availablePackages: [
          { identifier: '$rc_annual', packageType: 'ANNUAL', product: { priceString: '€47.99' } },
          { identifier: '$rc_monthly', packageType: 'MONTHLY', product: { priceString: '€4.79' } },
        ] } };
      },
      async purchasePackage(args) {
        calls.push(['purchase', args.aPackage.identifier]);
        if (purchaseError) throw purchaseError;
        return { customerInfo: { entitlements: { active: { 'BricksVault Pro': {} } } } };
      },
    },
    RevenueCatUI: {
      async presentPaywallIfNeeded(args) { calls.push(['paywall', args]); },
    },
  };
  globalThis.window = {
    RC_PLAY_BILLING_KEY: apiKey,
    Capacitor: {
      isNativePlatform: () => true,
      registerPlugin: (name) => plugins[name] || null,
    },
  };
  globalThis.localStorage = {
    getItem: (key) => key === 'bv_session' && userId
      ? JSON.stringify({ access_token: tokenWithSub(userId) })
      : null,
    setItem() {}, removeItem() {},
  };
  // api.js stores the session in module state. A unique module URL resets both
  // api.js and revenuecat-native.js for each test process import chain.
  const api = await import(`../api.js?rc-test=${Date.now()}-${Math.random()}`);
  api.loadSession();
  const rc = await import(`../lib/revenuecat-native.js?rc-test=${Date.now()}-${Math.random()}`);
  return { rc, calls };
}

test('onboarding can open RevenueCat anonymously before sign-in', async () => {
  const { rc, calls } = await loadRevenueCat();
  assert.equal(rc.proPurchaseReady(), true);
  const result = await rc.presentProPaywall();
  assert.equal(result.ok, true);
  assert.deepEqual(calls[0], ['configure', { apiKey: 'goog_test' }]);
  assert.equal(calls.some(([name]) => name === 'paywall'), true);
});

test('purchase readiness rejects a missing Play billing key', async () => {
  const { rc } = await loadRevenueCat({ apiKey: '' });
  assert.equal(rc.proPurchaseReady(), false);
});

test('Continue buys the picked plan directly, without a second paywall', async () => {
  const { rc, calls } = await loadRevenueCat({ userId: 'u1' });
  assert.deepEqual(await rc.proPlanPrices(), [
    { type: 'ANNUAL', price: '€47.99' },
    { type: 'MONTHLY', price: '€4.79' },
  ]);
  const result = await rc.purchaseProPlan('MONTHLY');
  assert.deepEqual(result, { ok: true, active: true });
  assert.deepEqual(calls.filter(([n]) => n === 'purchase'), [['purchase', '$rc_monthly']]);
  assert.equal(calls.some(([n]) => n === 'paywall'), false);
});

test('a failed purchase reports why instead of a generic error', async () => {
  const { rc } = await loadRevenueCat({
    purchaseError: { code: '3', message: 'The device or user is not allowed to make the purchase.', data: { userCancelled: false } },
  });
  const result = await rc.purchaseProPlan('ANNUAL');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_allowed');
  assert.match(result.detail, /not allowed/);
});

test('backing out of the Google Play sheet is a cancel, not an error', async () => {
  const { rc } = await loadRevenueCat({ purchaseError: { code: '1', message: 'cancelled', data: { userCancelled: true } } });
  const result = await rc.purchaseProPlan('ANNUAL');
  assert.deepEqual(result, { ok: false, reason: 'cancelled', detail: 'cancelled' });
});
