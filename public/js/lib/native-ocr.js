// Native on-device OCR via the app's TextOcr Capacitor plugin (ML Kit
// text recognition). Used only on the installed Android app — the web build
// never loads this plugin and falls through to TextDetector / no-op.
import { getCapacitorPlugin, isNativeCapacitor } from './native-auth.js';

// The answer cannot change while the app runs, so the bridge is asked once
// per window instead of on every photo.
const _supported = new WeakMap();

export async function nativeOcrSupported(win) {
  if (!isNativeCapacitor(win)) return false;
  const plugin = getCapacitorPlugin('TextOcr', win);
  if (!plugin?.recognize) return false;
  const key = win || globalThis;
  if (_supported.has(key)) return _supported.get(key);
  let supported = true;
  try {
    if (plugin.isSupported) supported = !!(await plugin.isSupported()).supported;
  } catch {
    supported = false;
  }
  _supported.set(key, supported);
  return supported;
}

// Returns OCR line strings from a captured data-URL still. Empty on cancel,
// missing plugin, or recognizer failure — the caller then skips OCR.
export async function recognizeTextNative(dataUrl, win) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return [];
  const plugin = getCapacitorPlugin('TextOcr', win);
  if (!plugin?.recognize) return [];
  try {
    if (!(await nativeOcrSupported(win))) return [];
    const result = await plugin.recognize({ image: dataUrl });
    const texts = Array.isArray(result?.texts) ? result.texts : [];
    const lines = texts.filter((line) => typeof line === 'string' && line.trim());
    if (lines.length) return lines;
    return typeof result?.fullText === 'string' && result.fullText.trim()
      ? [result.fullText]
      : [];
  } catch {
    return [];
  }
}
