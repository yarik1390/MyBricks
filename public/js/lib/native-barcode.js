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

// Install states from the plugin's GoogleBarcodeScannerModuleInstallState.
const MODULE_COMPLETED = 4;
const MODULE_GAVE_UP = new Set([3, 5]); // CANCELED, FAILED
const MODULE_WAIT_MS = 60000;

// The system scanner needs Google's code-scanner module from Play services.
// installGoogleBarcodeScannerModule() only STARTS the download and resolves
// at once, so calling scan() right after it failed with "module is not
// available" on every phone that didn't have it yet (closed testers, Oct 22-24).
// Wait for the download to finish (progress events, plus a poll in case an
// event is missed) before scanning. `onDownloading` fires once if we must wait,
// `onDownloaded` when that wait ends (finished, failed or timed out).
export async function ensureGoogleScannerModule(BS, { onDownloading, onDownloaded, timeoutMs = MODULE_WAIT_MS } = {}) {
  if (!BS?.isGoogleBarcodeScannerModuleAvailable || !BS?.installGoogleBarcodeScannerModule) return;
  const isAvailable = async () => {
    try { return !!(await BS.isGoogleBarcodeScannerModuleAvailable())?.available; } catch { return false; }
  };
  if (await isAvailable()) return;
  onDownloading?.();
  let handle = null;
  let poll = null;
  let timer = null;
  let done = false;
  try {
    await new Promise((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
      poll = setInterval(async () => { if (await isAvailable()) resolve(); }, 2000);
      Promise.resolve(BS.addListener?.('googleBarcodeScannerModuleInstallProgress', (event) => {
        const s = Number(event?.state);
        if (s === MODULE_COMPLETED || MODULE_GAVE_UP.has(s)) resolve();
      })).then((h) => { if (done) h?.remove?.(); else handle = h; }, () => {});
      // Rejects with "already installed" when it landed in the meantime.
      Promise.resolve(BS.installGoogleBarcodeScannerModule()).catch(resolve);
    });
  } finally {
    done = true;
    clearTimeout(timer);
    clearInterval(poll);
    try { await handle?.remove?.(); } catch { /* already gone */ }
    onDownloaded?.();
  }
}

// Launch the native full-screen scanner. Resolves to the first barcode's raw
// value, or null when the user cancels / returns no result. Operational failures
// reject so the scanner UI can offer recovery instead of looking like a cancel.
// Activity owns its preview surface, avoiding CameraX-behind-WebView failures on
// edge-to-edge Android releases.
export async function scanBarcodeNative(win, { onDownloading, onDownloaded } = {}) {
  const BS = getCapacitorPlugin('BarcodeScanner', win);
  if (!BS?.scan) throw new Error('Native barcode scanner is unavailable');
  try {
    // A failed or timed-out download falls through: scan() reports the real error.
    await ensureGoogleScannerModule(BS, { onDownloading, onDownloaded });
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
// Live in-app scanner (the default). ML Kit's startScan() renders CameraX
// BEHIND a transparent WebView so our own brackets, lock-on, counter and
// result sheet stay on screen while the camera keeps running between boxes.
// The page underneath must not paint over it (bv.css hides every layer but the
// scanner while html.bv-scan-native-live is set). The Activity scanner above is
// the fallback whenever startScan is unavailable or throws, and on request
// ("Use the system scanner"). localStorage bv_scan_live = '0' turns it off.
// ---------------------------------------------------------------------------
export function liveScanEnabled(storage = globalThis.localStorage) {
  try { return storage?.getItem?.('bv_scan_live') !== '0'; } catch { return true; }
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
