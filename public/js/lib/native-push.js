import { api, isGuestMode } from '../api.js';
import { getCapacitorPlugin, isNativeCapacitor } from './native-auth.js';

const ENABLED_KEY = 'bv_native_push_enabled';
const TOKEN_KEY = 'bv_native_push_token';
let actionListenerReady = false;

function plugin() {
  return getCapacitorPlugin('PushNotifications');
}

export function nativePushSupported() {
  return isNativeCapacitor() && !!plugin();
}

export function nativePushEnabled() {
  try { return localStorage.getItem(ENABLED_KEY) === '1'; } catch { return false; }
}

function storedToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

function saveRegistration(token) {
  try {
    localStorage.setItem(ENABLED_KEY, '1');
    localStorage.setItem(TOKEN_KEY, token);
  } catch {}
}

function clearRegistration() {
  try {
    localStorage.removeItem(ENABLED_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export async function installNativePushActionListener() {
  if (actionListenerReady || !nativePushSupported()) return;
  actionListenerReady = true;
  try {
    await plugin().addListener('pushNotificationActionPerformed', event => {
      const url = event?.notification?.data?.url;
      if (typeof url === 'string' && url.startsWith('#/')) location.hash = url;
    });
  } catch {
    actionListenerReady = false;
  }
}

async function requestToken({ askPermission }) {
  const PushNotifications = plugin();
  if (!PushNotifications) throw new Error('Native notifications are unavailable');
  let permission = await PushNotifications.checkPermissions();
  if (permission.receive !== 'granted' && askPermission) {
    permission = await PushNotifications.requestPermissions();
  }
  if (permission.receive !== 'granted') {
    throw new Error(askPermission ? 'Notification permission was not granted' : 'Notification permission is not active');
  }

  let timer;
  let registrationHandle;
  let errorHandle;
  try {
    const registration = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Notification registration timed out')), 15_000);
      Promise.resolve(PushNotifications.addListener('registration', result => resolve(result?.value || '')))
        .then(handle => { registrationHandle = handle; })
        .catch(reject);
      Promise.resolve(PushNotifications.addListener('registrationError', error => {
        reject(new Error(error?.error || 'Notification registration failed'));
      })).then(handle => { errorHandle = handle; }).catch(reject);
    });
    await PushNotifications.register();
    const token = String(await registration);
    if (token.length < 20) throw new Error('Firebase returned an invalid device token');
    return token;
  } finally {
    clearTimeout(timer);
    await registrationHandle?.remove?.().catch?.(() => {});
    await errorHandle?.remove?.().catch?.(() => {});
  }
}

export async function enableNativePush({ askPermission = true } = {}) {
  if (isGuestMode()) throw new Error('Sign in before enabling notifications');
  await installNativePushActionListener();
  const token = await requestToken({ askPermission });
  await api('/api/push/native', {
    method: 'POST',
    body: { token, platform: window.Capacitor?.getPlatform?.() || 'android' },
  });
  saveRegistration(token);
  return true;
}

export async function disableNativePush() {
  const token = storedToken();
  await api('/api/push/native', {
    method: 'DELETE',
    body: token ? { token } : {},
  }).catch(() => {});
  try { await plugin()?.unregister?.(); } catch {}
  clearRegistration();
}

export async function restoreNativePush() {
  if (!nativePushSupported() || !nativePushEnabled() || isGuestMode()) return false;
  await installNativePushActionListener();
  try {
    return await enableNativePush({ askPermission: false });
  } catch {
    return false;
  }
}
