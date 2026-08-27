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
  it('requires the generic native scanner API used by the installed app', async () => {
    const embeddedOnly = {
      isSupported: async () => ({ supported: true }),
      startScan: async () => {},
      addListener: async () => ({ remove: async () => {} }),
    };
    const generic = {
      isSupported: async () => ({ supported: true }),
      scan: async () => ({ barcodes: [] }),
    };
    const { nativeBarcodeSupported } = await import('../lib/native-barcode.js');
    assert.equal(await nativeBarcodeSupported(nativeWindow(embeddedOnly)), false);
    assert.equal(await nativeBarcodeSupported(nativeWindow(generic)), true);
  });

  it('uses the generic native scanner Activity and returns its barcode', async () => {
    let usedGenericScan = false;
    let startedEmbeddedScan = false;
    const plugin = {
      scan: async () => {
        usedGenericScan = true;
        return { barcodes: [{ rawValue: '5702017419690' }] };
      },
      startScan: async () => { startedEmbeddedScan = true; },
    };
    assert.equal(await scanBarcodeNative(nativeWindow(plugin)), '5702017419690');
    assert.equal(usedGenericScan, true);
    assert.equal(startedEmbeddedScan, false);
  });

  it('treats native scanner cancellation as a null result', async () => {
    const plugin = {
      scan: async () => ({ barcodes: [] }),
    };
    assert.equal(await scanBarcodeNative(nativeWindow(plugin)), null);
    await cancelBarcodeNative();
  });
});
