import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cancelBarcodeNative, scanBarcodeNative } from '../lib/native-barcode.js';

afterEach(() => { delete globalThis.document; });

function nativeWindow(plugin) {
  return {
    Capacitor: {
      isNativePlatform: () => true,
      Plugins: { BarcodeScanner: plugin },
    },
  };
}

describe('native branded barcode scanning', () => {
  it('uses the embedded scanner API rather than the generic Google UI', async () => {
    let usedGenericScan = false;
    let listener;
    const plugin = {
      scan: async () => { usedGenericScan = true; return { barcodes: [] }; },
      startScan: async () => {},
      stopScan: async () => {},
      addListener: async (event, fn) => {
        if (event === 'barcodeScanned') listener = fn;
        return { remove: async () => {} };
      },
      checkPermissions: async () => ({ camera: 'granted' }),
    };
    globalThis.document = { body: { classList: { add() {}, remove() {} } } };
    const pending = scanBarcodeNative(nativeWindow(plugin));
    await new Promise(resolve => setTimeout(resolve, 0));
    listener({ barcode: { rawValue: '5702017419690' } });
    assert.equal(await pending, '5702017419690');
    assert.equal(usedGenericScan, false);
  });

  it('cancels a pending scan and restores the WebView', async () => {
    let stopped = 0;
    let listener;
    const classes = new Set();
    const plugin = {
      startScan: async () => {},
      stopScan: async () => { stopped += 1; },
      addListener: async (event, fn) => {
        if (event === 'barcodeScanned') listener = fn;
        return { remove: async () => {} };
      },
      checkPermissions: async () => ({ camera: 'granted' }),
    };
    const win = nativeWindow(plugin);
    win.document = { body: { classList: {
      add: value => classes.add(value),
      remove: value => classes.delete(value),
    } } };
    const pending = scanBarcodeNative(win);
    await new Promise(resolve => setTimeout(resolve, 0));
    await cancelBarcodeNative();
    assert.equal(await pending, null);
    assert.equal(stopped, 1);
    assert.equal(classes.has('native-barcode-active'), false);
    assert.equal(typeof listener, 'function');
  });
});
