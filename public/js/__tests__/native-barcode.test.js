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

  it('treats an empty native scanner result as user cancellation', async () => {
    const plugin = {
      scan: async () => ({ barcodes: [] }),
    };
    assert.equal(await scanBarcodeNative(nativeWindow(plugin)), null);
    await cancelBarcodeNative();
  });

  it('treats an explicit native cancellation rejection as cancellation', async () => {
    const plugin = {
      scan: async () => {
        const error = new Error('Scan canceled by user');
        error.code = 'SCAN_CANCELED';
        throw error;
      },
    };
    assert.equal(await scanBarcodeNative(nativeWindow(plugin)), null);
  });

  it('preserves operational scanner failures for the UI to recover from', async () => {
    const cause = new Error('Camera service unavailable');
    const plugin = {
      scan: async () => { throw cause; },
    };
    await assert.rejects(() => scanBarcodeNative(nativeWindow(plugin)), cause);
  });
});

describe('opt-in live native scanning', () => {
  it('is opt-in and needs the embedded scanner API', async () => {
    const { liveScanOptIn, nativeLiveScanSupported } = await import('../lib/native-barcode.js');
    assert.equal(liveScanOptIn({ getItem: () => null }), false);
    assert.equal(liveScanOptIn({ getItem: (k) => (k === 'bv_scan_live' ? '1' : null) }), true);
    assert.equal(liveScanOptIn({ getItem: () => { throw new Error('blocked'); } }), false);
    const generic = { isSupported: async () => ({ supported: true }), scan: async () => ({ barcodes: [] }) };
    const embedded = { ...generic, startScan: async () => {}, stopScan: async () => {}, addListener: async () => ({ remove: async () => {} }) };
    assert.equal(await nativeLiveScanSupported(nativeWindow(generic)), false);
    assert.equal(await nativeLiveScanSupported(nativeWindow(embedded)), true);
  });

  it('streams barcodes until stopped, then removes listeners and stops the camera', async () => {
    const { startNativeLiveScan, normalizeCornerPoints } = await import('../lib/native-barcode.js');
    const listeners = {};
    let started = null, stopCalls = 0, removed = 0;
    const plugin = {
      startScan: async (opts) => { started = opts; },
      stopScan: async () => { stopCalls++; },
      addListener: async (name, fn) => { listeners[name] = fn; return { remove: async () => { removed++; } }; },
    };
    const seen = [];
    const stop = await startNativeLiveScan(nativeWindow(plugin), { onBarcodes: (b) => seen.push(...b), onError: () => {} });
    assert.ok(started.formats.includes('EAN_13'));
    listeners.barcodesScanned({ barcodes: [{ rawValue: '5702017419690', cornerPoints: [[10, 20], [110, 20], [110, 60], [10, 60]] }] });
    assert.equal(seen.length, 1);
    assert.deepEqual(normalizeCornerPoints(seen[0].cornerPoints)[1], { x: 110, y: 20 });
    await stop();
    await stop();
    listeners.barcodesScanned({ barcodes: [{ rawValue: 'late' }] });
    assert.equal(seen.length, 1, 'no events after stop');
    assert.equal(stopCalls, 1);
    assert.equal(removed, 2);
  });

  it('cleans up and rejects when the camera fails to start', async () => {
    const { startNativeLiveScan } = await import('../lib/native-barcode.js');
    let removed = 0, stopped = 0;
    const plugin = {
      startScan: async () => { throw new Error('CameraX unavailable'); },
      stopScan: async () => { stopped++; },
      addListener: async () => ({ remove: async () => { removed++; } }),
    };
    await assert.rejects(() => startNativeLiveScan(nativeWindow(plugin), { onBarcodes: () => {} }), /CameraX/);
    assert.equal(removed, 1);
    assert.equal(stopped, 1);
  });

  it('caps the zoom step at the device maximum', async () => {
    const { setNativeZoom } = await import('../lib/native-barcode.js');
    let applied = null;
    const plugin = { getMaxZoomRatio: async () => ({ zoomRatio: 1.5 }), setZoomRatio: async ({ zoomRatio }) => { applied = zoomRatio; } };
    assert.equal(await setNativeZoom(nativeWindow(plugin), 2), true);
    assert.equal(applied, 1.5);
  });
});
