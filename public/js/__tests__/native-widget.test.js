import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clearVaultWidget, updateVaultWidget } from '../lib/native-widget.js';

afterEach(() => { delete globalThis.window; });

function nativeWindow(plugin) {
  return {
    Capacitor: {
      isNativePlatform: () => true,
      Plugins: { WidgetBridge: plugin },
    },
  };
}

describe('native vault widget privacy', () => {
  it('clears native widget state on request', async () => {
    let cleared = 0;
    globalThis.window = nativeWindow({ clearWidget: async () => { cleared += 1; } });
    await clearVaultWidget();
    assert.equal(cleared, 1);
  });

  it('is a no-op on the PWA', async () => {
    let cleared = 0;
    globalThis.window = {
      Capacitor: {
        isNativePlatform: () => false,
        Plugins: { WidgetBridge: { clearWidget: async () => { cleared += 1; } } },
      },
    };
    await clearVaultWidget();
    assert.equal(cleared, 0);
  });

  it('passes the account owner when updating native widget state', async () => {
    let payload;
    globalThis.window = nativeWindow({ updateWidget: async (value) => { payload = value; } });
    updateVaultWidget({ value: '$10', delta: '+2%', deltaUp: true, sets: 3, owner: 'user-a' });
    await Promise.resolve();
    assert.equal(payload.owner, 'user-a');
  });
});
