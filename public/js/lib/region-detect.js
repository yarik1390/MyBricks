// First-launch regional defaults: which retail market and currency a new vault
// starts on. No GPS and no location permission. The signals, best first:
//   Android app: the SIM / mobile network country (TelephonyManager, needs no
//                permission), then the phone's region setting, then the
//                country Cloudflare saw the request come from.
//   Web:         the country Cloudflare saw the request come from (the
//                browser's language is en-US on most machines worldwide),
//                then the browser's region.
// Only countries Settings > Currency & region offers are returned; anything
// else gives null and the caller keeps its default.
import { getCapacitorPlugin, isNativeCapacitor } from './native-auth.js';

export const MARKETS = ['FR', 'US', 'GB', 'DE', 'CA', 'AU', 'NL'];
const EURO = new Set(['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK']);

/** Two-letter country code, uppercase, or '' (UK → GB; XX/T1/EU are not countries). */
export function normCountry(code) {
  let c = String(code || '').trim().toUpperCase();
  if (c === 'UK') c = 'GB';
  if (!/^[A-Z]{2}$/.test(c) || c === 'XX' || c === 'T1' || c === 'EU' || c === 'ZZ') return '';
  return c;
}

/** Region part of a BCP-47 tag ('en-GB' → 'GB'); '' when the tag has none. */
export function regionOfTag(tag) {
  const s = String(tag || '');
  if (!s) return '';
  try {
    const r = new Intl.Locale(s).maximize().region;   // 'fr' → FR
    if (r) return normCountry(r);
  } catch { /* fall through to the plain split */ }
  const part = s.split(/[-_]/).find((p, i) => i > 0 && /^[A-Za-z]{2}$/.test(p));
  return normCountry(part);
}

/** Currency for a country, or null when it isn't one of ours. */
export function currencyForCountry(country) {
  const c = normCountry(country);
  if (c === 'GB') return 'GBP';
  if (c === 'CA') return 'CAD';
  if (c === 'AU') return 'AUD';
  if (c === 'US') return 'USD';
  if (EURO.has(c)) return 'EUR';
  return null;
}

/**
 * Pick the country from the signals (pure: exported for tests).
 * { native, sim, locale, ip } → { country, source }. Returns the first signal
 * that gives a real country, even an unsupported one, so a Belgian phone gets
 * EUR without being moved to another country's shop.
 */
export function pickCountry({ native = false, sim = '', locale = '', ip = '' } = {}) {
  const order = native
    ? [['sim', sim], ['locale', regionOfTag(locale)], ['ip', ip]]
    : [['ip', ip], ['locale', regionOfTag(locale)]];
  for (const [source, value] of order) {
    const country = normCountry(value);
    if (country) return { country, source };
  }
  return { country: '', source: '' };
}

/** Currency and retail market for a picked country (null = keep the default). */
export function defaultsForCountry(country) {
  const c = normCountry(country);
  return { country: c, currency: currencyForCountry(c), market: MARKETS.includes(c) ? c : null };
}

/** SIM / network country from the Android app ('' on the web or on failure). */
export async function nativeSimCountry(win) {
  const w = win || (typeof window !== 'undefined' ? window : undefined);
  if (!isNativeCapacitor(w)) return '';
  const Region = getCapacitorPlugin('PhoneRegion', w);
  if (!Region?.getCountry) return '';
  let timer;
  try {
    const r = await Promise.race([Region.getCountry(), new Promise((res) => { timer = setTimeout(() => res(null), 1500); })]);
    return normCountry(r?.sim) || normCountry(r?.network) || '';
  } catch { return ''; } finally { clearTimeout(timer); }
}

/**
 * All signals gathered and picked: { country, source, currency, market }.
 * ipCountry is a string or an async function; the function is only called
 * when the phone's own signals don't settle it.
 */
export async function detectRegion({ win, ipCountry = '' } = {}) {
  const w = win || (typeof window !== 'undefined' ? window : undefined);
  const native = isNativeCapacitor(w);
  const sim = native ? await nativeSimCountry(w) : '';
  const locale = w?.navigator?.language || '';
  const settled = native && (normCountry(sim) || regionOfTag(locale));
  let ip = '';
  if (!settled) {
    try { ip = typeof ipCountry === 'function' ? await ipCountry() : ipCountry; } catch { ip = ''; }
  }
  const picked = pickCountry({ native, sim, locale, ip });
  return { ...defaultsForCountry(picked.country), source: picked.source };
}
