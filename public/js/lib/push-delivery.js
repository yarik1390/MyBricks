// Push delivery on this device, whichever channel it uses: the installed
// Android app registers an FCM token (native-push.js); a browser subscribes a
// Web Push endpoint through the service worker. The Notifications screen only
// needs "is push on here, and can it be?", so both paths answer the same shape.
import { api, isGuestMode } from '../api.js';
import { state } from '../state.js';
import { disableNativePush, enableNativePush, nativePushEnabled, nativePushSupported } from './native-push.js';

/**
 * @returns {Promise<'on'|'off'|'blocked'|'unsupported'|'setup'|'guest'>}
 */
export async function pushStatus() {
  if (isGuestMode()) return 'guest';
  if (nativePushSupported()) {
    if (state.config?.status?.native_push === false) return 'setup';
    return nativePushEnabled() ? 'on' : 'off';
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await withTimeout(navigator.serviceWorker.ready, 3000).catch(() => null);
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  return sub ? 'on' : 'off';
}

/** Ask for permission (the caller has already explained why) and register. */
export async function turnOnPush() {
  if (nativePushSupported()) {
    await enableNativePush();
    return true;
  }
  const reg = await withTimeout(navigator.serviceWorker.ready, 5000);
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    const err = new Error('permission');
    err.code = perm === 'denied' ? 'denied' : 'dismissed';
    throw err;
  }
  const { publicKey } = await api('/api/push/vapid-key');
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
  const j = sub.toJSON();
  await api('/api/push/subscribe', { method: 'POST', body: { endpoint: sub.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth } });
  return true;
}

export async function turnOffPush() {
  if (nativePushSupported()) {
    await disableNativePush();
    return;
  }
  const reg = await withTimeout(navigator.serviceWorker.ready, 3000).catch(() => null);
  const current = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  await current?.unsubscribe().catch(() => {});
  await api('/api/push/subscribe', { method: 'DELETE', body: {} }).catch(() => {});
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); }),
  ]).finally(() => clearTimeout(timer));
}
