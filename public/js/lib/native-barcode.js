// Native barcode scanning via @capacitor-mlkit/barcode-scanning (Google ML Kit).
// The web BarcodeDetector path is inconsistent across Android WebView versions;
// the installed app therefore launches ML Kit's native scanner Activity.
import { getCapacitorPlugin, isNativeCapacitor } from './native-auth.js';

// LEGO set boxes carry EAN-13 / UPC-A retail barcodes; keep the format list
// tight so the scanner locks on faster and ignores QR/other noise.
const FORMATS = ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39'];

export async function nativeBarcodeSupported(win) {
  if (!isNativeCapacitor(win)) return false;
  const BS = getCapacitorPlugin('BarcodeScanner', win);
  if (!BS?.scan) return false;
  try {
    const { supported } = await BS.isSupported();
    return !!supported;
  } catch {
    return false;
  }
}

function isScannerCancellation(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || error || '').toLowerCase();
  return code.includes('cancel') || message.includes('cancelled') || message.includes('canceled');
}

// Launch the native full-screen scanner. Resolves to the first barcode's raw
// value, or null when the user cancels / returns no result. Operational failures
// reject so the scanner UI can offer recovery instead of looking like a cancel.
// Activity owns its preview surface, avoiding CameraX-behind-WebView failures on
// edge-to-edge Android releases.
export async function scanBarcodeNative(win) {
  const BS = getCapacitorPlugin('BarcodeScanner', win);
  if (!BS?.scan) throw new Error('Native barcode scanner is unavailable');
  try {
    if (BS.isGoogleBarcodeScannerModuleAvailable && BS.installGoogleBarcodeScannerModule) {
      try {
        const { available } = await BS.isGoogleBarcodeScannerModuleAvailable();
        if (!available) await BS.installGoogleBarcodeScannerModule();
      } catch { /* proceed — scan() surfaces a real failure below */ }
    }
    const { barcodes } = await BS.scan({ formats: FORMATS });
    const value = barcodes?.[0]?.rawValue ?? barcodes?.[0]?.displayValue;
    return typeof value === 'string' && value ? value : null;
  } catch (error) {
    if (isScannerCancellation(error)) return null;
    throw error;
  }
}

// The generic native scanner Activity closes itself. Kept as an idempotent API
// for route/back cleanup shared with scanner.js.
export async function cancelBarcodeNative() {}

// ---------------------------------------------------------------------------
// Live in-app scanner (opt-in). ML Kit's startScan() renders CameraX BEHIND a
// transparent WebView so our own brackets, counter and result sheet stay on
// screen while the camera keeps running between boxes. It is opt-in
// (localStorage bv_scan_live = '1') because CameraX-behind-WebView has failed
// on some edge-to-edge Android releases; the Activity scanner above remains the
// default and the fallback whenever startScan is unavailable or throws.
// ---------------------------------------------------------------------------
export function liveScanOptIn(storage = globalThis.localStorage) {
  try { return storage?.getItem?.('bv_scan_live') === '1'; } catch { return false; }
}

export async function nativeLiveScanSupported(win) {
  if (!isNativeCapacitor(win)) return false;
  const BS = getCapacitorPlugin('BarcodeScanner', win);
  if (!BS?.startScan || !BS?.stopScan || !BS?.addListener) return false;
  try {
    const { supported } = await BS.isSupported();
    return !!supported;
  } catch {
    return false;
  }
}

/**
 * Start continuous scanning. `onBarcodes(barcodes)` receives every
 * `barcodesScanned` event ({ rawValue, displayValue, cornerPoints: [[x,y]…] }).
 * Resolves to an idempotent async stop() that removes the listener and stops
 * the camera. Rejects when the camera can't start so the caller falls back.
 */
export async function startNativeLiveScan(win, { onBarcodes, onError } = {}) {
  const BS = getCapacitorPlugin('BarcodeScanner', win);
  if (!BS?.startScan) throw new Error('Live scanner is unavailable');
  const handles = [];
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    for (const h of handles) { try { await h?.remove?.(); } catch { /* already gone */ } }
    try { await BS.stopScan(); } catch { /* not running */ }
  };
  try {
    handles.push(await BS.addListener('barcodesScanned', (event) => {
      if (!stopped) onBarcodes?.(Array.isArray(event?.barcodes) ? event.barcodes : []);
    }));
    if (onError) handles.push(await BS.addListener('scanError', (event) => { if (!stopped) onError(event); }));
    await BS.startScan({ formats: FORMATS, lensFacing: 'BACK' });
  } catch (error) {
    await stop();
    throw error;
  }
  return stop;
}

/** ML Kit corner points arrive as [[x, y], …]; normalise to [{x, y}, …]. */
export function normalizeCornerPoints(points) {
  if (!Array.isArray(points)) return [];
  return points
    .map((p) => (Array.isArray(p) ? { x: Number(p[0]), y: Number(p[1]) } : { x: Number(p?.x), y: Number(p?.y) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

export async function setNativeTorch(win, on) {
  const BS = getCapacitorPlugin('BarcodeScanner', win);
  try {
    if (on) await BS?.enableTorch?.(); else await BS?.disableTorch?.();
    return true;
  } catch { return false; }
}

export async function setNativeZoom(win, zoomRatio) {
  const BS = getCapacitorPlugin('BarcodeScanner', win);
  try {
    const limits = await BS?.getMaxZoomRatio?.().catch(() => null);
    const max = Number(limits?.zoomRatio) || zoomRatio;
    await BS?.setZoomRatio?.({ zoomRatio: Math.min(zoomRatio, max) });
    return true;
  } catch { return false; }
}
