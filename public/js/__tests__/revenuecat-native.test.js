import test from 'node:test';
import assert from 'node:assert/strict';

function tokenWithSub(sub) {
  const b64 = Buffer.from(JSON.stringify({ sub })).toString('base64url');
  return `x.${b64}.x`;
}

async function loadRevenueCat({ userId = null, apiKey = 'goog_test' } = {}) {
  const calls = [];
  const plugins = {
    Purchases: {
      async configure(args) { calls.push(['configure', args]); },
      async logIn(args) { calls.push(['logIn', args]); },
      async getCustomerInfo() { return { customerInfo: { entitlements: { active: {} } } }; },
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
