import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_LOCK_ENABLED_KEY,
  appLockShouldPrelock,
  applyBootPrivacyLock,
} from '../lib/app-lock-boot.js';
import {
  resetAppLockForTests,
  initAppLock,
} from '../lib/app-lock.js';

function makeClassList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name),
  };
}

afterEach(() => {
  resetAppLockForTests();
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.localStorage;
});

describe('Android App Lock boot privacy', () => {
  it('prelocks native Android before the module boot graph renders', () => {
    const classList = makeClassList();
    const win = {
      Capacitor: { isNativePlatform: () => true },
      localStorage: { getItem: (key) => key === APP_LOCK_ENABLED_KEY ? '1' : null },
    };
    const doc = { documentElement: { classList } };

    assert.equal(appLockShouldPrelock(win), true);
    assert.equal(applyBootPrivacyLock(win, doc), true);
    assert.equal(classList.contains('app-lock-pending'), true);
  });

  it('does not prelock the PWA or disabled native installs', () => {
    const web = {
      Capacitor: { isNativePlatform: () => false },
      localStorage: { getItem: () => '1' },
    };
    const disabled = {
      Capacitor: { isNativePlatform: () => true },
      localStorage: { getItem: () => '0' },
    };
    assert.equal(appLockShouldPrelock(web), false);
    assert.equal(appLockShouldPrelock(disabled), false);
  });

  it('fails closed when enabled storage can be read but DOM mutation is unavailable', () => {
    const win = {
      Capacitor: { isNativePlatform: () => true },
      localStorage: { getItem: () => '1' },
    };
    assert.equal(applyBootPrivacyLock(win, null), false);
  });

  it('keeps the boot privacy class until biometric availability resolves', async () => {
    const rootClassList = makeClassList();
    rootClassList.add('app-lock-pending');
    const bodyClassList = makeClassList();
    let resolveAvailability;
    const availability = new Promise((resolve) => { resolveAvailability = resolve; });
    const win = {
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: {
          BiometricAuthNative: { checkBiometry: () => availability },
          App: { addListener: () => {} },
        },
      },
      localStorage: { getItem: () => '1' },
    };
    globalThis.window = win;
    globalThis.localStorage = win.localStorage;
    globalThis.document = {
      documentElement: { classList: rootClassList },
      body: { classList: bodyClassList, appendChild: () => {} },
      getElementById: () => null,
      createElement: () => ({
        id: '', className: '', innerHTML: '',
        setAttribute: () => {},
        querySelector: () => ({ addEventListener: () => {} }),
        classList: makeClassList(),
      }),
    };

    const initializing = initAppLock(win);
    await Promise.resolve();
    assert.equal(rootClassList.contains('app-lock-pending'), true);
    resolveAvailability({ isAvailable: false });
    await initializing;
    assert.equal(rootClassList.contains('app-lock-pending'), false);
  });
});
