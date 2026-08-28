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
