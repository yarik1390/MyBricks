// Native on-device OCR via the app's TextOcr Capacitor plugin (ML Kit
// text recognition). Used only on the installed Android app — the web build
// never loads this plugin and falls through to TextDetector / no-op.
import { getCapacitorPlugin, isNativeCapacitor } from './native-auth.js';

export async function nativeOcrSupported(win) {
  if (!isNativeCapacitor(win)) return false;
  const plugin = getCapacitorPlugin('TextOcr', win);
  if (!plugin?.recognize) return false;
  try {
    if (!plugin.isSupported) return true;
    const { supported } = await plugin.isSupported();
    return !!supported;
  } catch {
    return false;
  }
}

// Returns OCR line strings from a captured data-URL still. Empty on cancel,
// missing plugin, or recognizer failure — the caller then skips OCR.
export async function recognizeTextNative(dataUrl, win) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return [];
  const plugin = getCapacitorPlugin('TextOcr', win);
  if (!plugin?.recognize) return [];
  try {
    if (plugin.isSupported) {
      const { supported } = await plugin.isSupported();
      if (supported === false) return [];
    }
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
