export const APP_LOCK_ENABLED_KEY = 'bv_app_lock';

function isNativeCapacitor(win) {
  const cap = win?.Capacitor;
  if (!cap) return false;
  try {
    if (typeof cap.isNativePlatform === 'function') return !!cap.isNativePlatform();
    if (typeof cap.getPlatform === 'function') return cap.getPlatform() !== 'web';
  } catch {}
  return false;
}

export function appLockShouldPrelock(win = globalThis.window) {
  if (!isNativeCapacitor(win)) return false;
  try {
    return win?.localStorage?.getItem(APP_LOCK_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function applyBootPrivacyLock(win = globalThis.window, doc = globalThis.document) {
  if (!appLockShouldPrelock(win)) return false;
  const root = doc?.documentElement;
  if (!root?.classList) return false;
  root.classList.add('app-lock-pending');
  return true;
}
