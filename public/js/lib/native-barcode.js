// Native barcode scanning via @capacitor-mlkit/barcode-scanning (Google ML Kit).
// The web BarcodeDetector the scanner falls back to is inconsistent across
// Android WebView versions; ML Kit's on-device scanner is faster, more reliable,
// supports more symbologies, and works offline. Used only on the installed app —
// the web build keeps the BarcodeDetector path.
import { getCapacitorPlugin, isNativeCapacitor } from './native-auth.js';

// LEGO set boxes carry EAN-13 / UPC-A retail barcodes; keep the format list
// tight so the scanner locks on faster and ignores QR/other noise.
const FORMATS = ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39'];

// True only when the installed app has a working native ML Kit scanner.
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

// Launch the native full-screen scanner. Resolves to the first barcode's raw
// value, or null when the user cancels / it's unavailable. Ensures the on-demand
// Google scanner module is present first (a no-op once installed).
export async function scanBarcodeNative(win) {
  const BS = getCapacitorPlugin('BarcodeScanner', win);
  if (!BS?.scan) return null;
  try {
    if (BS.isGoogleBarcodeScannerModuleAvailable && BS.installGoogleBarcodeScannerModule) {
      try {
        const { available } = await BS.isGoogleBarcodeScannerModuleAvailable();
        if (!available) await BS.installGoogleBarcodeScannerModule();
      } catch { /* proceed — scan() surfaces a real failure below */ }
    }
    const { barcodes } = await BS.scan({ formats: FORMATS });
    const v = barcodes?.[0]?.rawValue;
    return typeof v === 'string' && v ? v : null; // null = user cancelled
  } catch {
    return null;
  }
}
