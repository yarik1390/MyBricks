// "Rate BricksVault" and "Share BricksVault" (Profile > Help), plus the one
// Google Play In-App Review prompt shown at a happy moment.
import { getCapacitorPlugin, isNativeCapacitor } from './native-auth.js';
import { shareContent } from './native-share.js';
import { t } from './i18n.js';

export const PLAY_PACKAGE = 'app.bricksvault';
export const PLAY_URL = `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`;
export const SITE_URL = 'https://bricksvault.app';
const REVIEW_FLAG = 'bv_review_asked_v1';

// Only the Android app can be rated (no App Store build yet).
export function canRateApp(win) {
  return isNativeCapacitor(win);
}

// The row always opens the Play listing: the in-app card has a hidden quota and
// may silently show nothing, which reads as a broken button.
export async function rateApp(win) {
  const w = win || (typeof window !== 'undefined' ? window : undefined);
  const Review = getCapacitorPlugin('AppReview', w);
  if (Review?.openStoreListing) {
    try { await Review.openStoreListing(); return true; } catch {}
  }
  const Browser = getCapacitorPlugin('Browser', w);
  if (Browser?.open) {
    try { await Browser.open({ url: PLAY_URL }); return true; } catch {}
  }
  const opened = w?.open?.(PLAY_URL, '_blank', 'noopener,noreferrer');
  return opened !== null && opened !== undefined;
}

export function shareAppPayload() {
  return { title: 'BricksVault', text: t('bvAccount.shareAppText'), url: SITE_URL, dialogTitle: t('bvAccount.shareApp') };
}

// Returns 'shared' | 'cancelled' | 'copied' | 'failed'.
export async function shareApp(win) {
  const w = win || (typeof window !== 'undefined' ? window : undefined);
  const payload = shareAppPayload();
  const result = await shareContent(payload, w);
  if (result !== 'unsupported') return result;
  try {
    await w.navigator.clipboard.writeText(`${payload.text} ${payload.url}`);
    return 'copied';
  } catch {
    return 'failed';
  }
}

// Ask Play for its review card once, after a collector crosses a real
// milestone (10+ sets). Never from a button, never twice, never on the web.
export async function maybeAskForReview(count, win) {
  const w = win || (typeof window !== 'undefined' ? window : undefined);
  if (!(Number(count) >= 10)) return false;
  const Review = getCapacitorPlugin('AppReview', w);
  if (!Review?.requestReview) return false;
  try {
    if (w.localStorage.getItem(REVIEW_FLAG)) return false;
    w.localStorage.setItem(REVIEW_FLAG, String(Date.now()));
  } catch { return false; }
  try { await Review.requestReview(); return true; } catch { return false; }
}
