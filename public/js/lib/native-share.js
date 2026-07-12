import { getCapacitorPlugin, isNativeCapacitor } from './native-auth.js';

function currentWindow(win) {
  if (win) return win;
  return typeof window !== 'undefined' ? window : undefined;
}

function wasCancelled(error) {
  return error?.name === 'AbortError' || /cancel|abort/i.test(String(error?.message || error || ''));
}

// Prefer Capacitor Share in the installed app. Android WebView does not
// consistently expose navigator.share even though the OS share sheet exists.
export async function shareContent(content, win) {
  const w = currentWindow(win);
  if (isNativeCapacitor(w)) {
    const Share = getCapacitorPlugin('Share', w);
    if (Share?.share) {
      try {
        await Share.share(content);
        return 'shared';
      } catch (error) {
        if (wasCancelled(error)) return 'cancelled';
      }
    }
  }

  if (w?.navigator?.share) {
    try {
      await w.navigator.share(content);
      return 'shared';
    } catch (error) {
      if (wasCancelled(error)) return 'cancelled';
    }
  }
  return 'unsupported';
}
