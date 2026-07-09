export const NATIVE_AUTH_CALLBACK_URL = 'app.bricksvault://auth/callback';
export const NATIVE_AUTH_BRIDGE_PARAM = 'native_oauth';
export const NATIVE_AUTH_APP_LINK_ORIGIN = 'https://brickvault-5ub.pages.dev';

function currentWindow(win) {
  if (win) return win;
  return typeof window !== 'undefined' ? window : undefined;
}

export function isNativeCapacitor(win) {
  const w = currentWindow(win);
  const cap = w?.Capacitor;
  if (!cap) return false;
  try {
    if (typeof cap.isNativePlatform === 'function') return !!cap.isNativePlatform();
    if (typeof cap.getPlatform === 'function') return cap.getPlatform() !== 'web';
  } catch {}
  return false;
}

export function getCapacitorPlugin(name, win) {
  const w = currentWindow(win);
  const cap = w?.Capacitor;
  if (!cap || !isNativeCapacitor(w)) return null;
  return cap.Plugins?.[name] || cap.registerPlugin?.(name) || null;
}

export function authRedirectUrlForPlatform(win) {
  const w = currentWindow(win);
  const origin = w?.location?.origin || '';
  const pathname = w?.location?.pathname || '/';
  // The Supabase site URL is already allow-listed. Android verifies this Pages
  // origin as an App Link and returns its final OAuth URL to the native app.
  return `${origin}${pathname}`;
}

export function nativeOAuthCallbackFromWebBridge(url) {
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch {
    return '';
  }
  if (parsed.searchParams.get(NATIVE_AUTH_BRIDGE_PARAM) !== '1') return '';

  const hash = parsed.hash || '';
  if (!/(?:^#|&)access_token=|(?:^#|&)error=/.test(hash)) return '';
  return `${NATIVE_AUTH_CALLBACK_URL}${hash}`;
}

export function buildSupabaseProviderAuthUrl(sbUrl, provider, redirectTo) {
  const url = new URL(`${String(sbUrl || '').replace(/\/+$/, '')}/auth/v1/authorize`);
  const params = new URLSearchParams({
    provider,
    redirect_to: redirectTo,
  });
  if (provider === 'google') params.set('prompt', 'select_account');
  url.search = params.toString();
  return url.toString();
}

export function oauthHashFromCallbackUrl(url) {
  const raw = String(url || '');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return '';
  }
  const isCustomSchemeCallback = parsed.protocol === 'app.bricksvault:'
    && parsed.host === 'auth'
    && parsed.pathname === '/callback';
  const isVerifiedAppLinkCallback = parsed.origin === NATIVE_AUTH_APP_LINK_ORIGIN
    && parsed.protocol === 'https:';
  if (!isCustomSchemeCallback && !isVerifiedAppLinkCallback) return '';

  const hash = parsed.hash || (raw.includes('#') ? raw.slice(raw.indexOf('#')) : '');
  if (hash && /(?:^#|&)access_token=|(?:^#|&)error=/.test(hash)) return hash;

  const queryAsHash = parsed.search ? `#${parsed.search.slice(1)}` : '';
  if (/(?:^#|&)access_token=|(?:^#|&)error=/.test(queryAsHash)) return queryAsHash;
  return '';
}

export async function openNativeAuthUrl(url, win) {
  const Browser = getCapacitorPlugin('Browser', win);
  if (!Browser?.open) return false;
  await Browser.open({ url, presentationStyle: 'fullscreen' });
  return true;
}

export async function closeNativeAuthBrowser(win) {
  const Browser = getCapacitorPlugin('Browser', win);
  if (!Browser?.close) return;
  await Browser.close();
}
