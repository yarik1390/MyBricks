// Native barcode scanning via @capacitor-mlkit/barcode-scanning (Google ML Kit).
// The installed app uses CameraX behind the WebView so Bricksvault owns the
// visible scanner UI; the web build keeps its BarcodeDetector path.
import { getCapacitorPlugin, isNativeCapacitor } from './native-auth.js';

const FORMATS = ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39'];
let activeScan = null;

export async function nativeBarcodeSupported(win) {
  if (!isNativeCapacitor(win)) return false;
  const BS = getCapacitorPlugin('BarcodeScanner', win);
  if (!BS?.startScan || !BS?.addListener) return false;
  try {
    const { supported } = await BS.isSupported();
    return !!supported;
  } catch {
    return false;
  }
}

async function finishActiveScan(value) {
  const scan = activeScan;
  if (!scan || scan.settled) return;
  scan.settled = true;
  activeScan = null;
  try { await scan.barcodeHandle?.remove?.(); } catch { /* already removed */ }
  try { await scan.errorHandle?.remove?.(); } catch { /* already removed */ }
  try { await scan.plugin.stopScan?.(); } catch { /* scanner already stopped */ }
  scan.win.document?.body?.classList?.remove('native-barcode-active');
  scan.resolve(value);
}

// Stop CameraX when the branded sheet is closed with its button, Android Back,
// or a route change. This is deliberately idempotent.
export async function cancelBarcodeNative() {
  await finishActiveScan(null);
}

// Start CameraX behind the transparent portion of Bricksvault's scanner sheet.
// Unlike plugin.scan(), this never launches Google's generic scanner Activity.
export async function scanBarcodeNative(win) {
  await cancelBarcodeNative();
  const BS = getCapacitorPlugin('BarcodeScanner', win);
  if (!BS?.startScan || !BS?.addListener) return null;

  try {
    const permission = await BS.checkPermissions?.();
    if (permission?.camera !== 'granted') {
      const requested = await BS.requestPermissions?.();
      if (requested?.camera !== 'granted') return null;
    }

    return await new Promise(async resolve => {
      const scan = { win, plugin: BS, resolve, settled: false };
      activeScan = scan;
      try {
        scan.barcodeHandle = await BS.addListener('barcodeScanned', event => {
          const raw = event?.barcode?.rawValue ?? event?.barcode?.displayValue ?? null;
          if (raw) void finishActiveScan(String(raw));
        });
        scan.errorHandle = await BS.addListener('scanError', () => {
          void finishActiveScan(null);
        });
        win.document?.body?.classList?.add('native-barcode-active');
        await BS.startScan({ formats: FORMATS, lensFacing: 'BACK' });
      } catch {
        await finishActiveScan(null);
      }
    });
  } catch {
    await cancelBarcodeNative();
    return null;
  }
}
