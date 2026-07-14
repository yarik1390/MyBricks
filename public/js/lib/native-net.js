// Reliable connectivity via @capacitor/network on the native app. The Android
// WebView doesn't expose navigator.connection, and navigator.onLine is
// famously unreliable there — so features that need to know "are we on wifi?"
// or "are we truly offline?" get a trustworthy answer here, falling back to the
// web APIs on the web build.
import { getCapacitorPlugin, isNativeCapacitor } from './native-auth.js';

// Returns { connected, type } where type is 'wifi' | 'cellular' | 'none' |
// 'unknown'. Async because the native plugin call is async.
export async function getConnection(win) {
  const Network = getCapacitorPlugin('Network', win);
  if (Network?.getStatus) {
    try {
      const s = await Network.getStatus();
      return { connected: !!s.connected, type: s.connectionType || 'unknown' };
    } catch { /* fall through to web APIs */ }
  }
  const w = win || (typeof window !== 'undefined' ? window : undefined);
  const online = w?.navigator ? w.navigator.onLine !== false : true;
  const c = w?.navigator?.connection || w?.navigator?.webkitConnection;
  let type = 'unknown';
  if (c?.type) type = c.type;
  else if (c?.effectiveType) type = /wifi/i.test(c.effectiveType) ? 'wifi' : 'cellular';
  return { connected: online, type };
}

// True when it's safe to pull non-essential bytes (prewarm): connected, not a
// metered/cellular link, and not data-saver.
export async function isUnmetered(win) {
  const w = win || (typeof window !== 'undefined' ? window : undefined);
  const c = w?.navigator?.connection || w?.navigator?.webkitConnection;
  if (c?.saveData) return false;
  const { connected, type } = await getConnection(win);
  if (!connected) return false;
  if (type === 'cellular') return false;
  // 'wifi' | 'unknown' | 'none'(unreachable here) → allow when connected.
  return true;
}
