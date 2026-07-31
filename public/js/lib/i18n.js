/**
 * Multi-language support.
 *
 * DEVICE-FIRST. The default language is the one the device is already set to:
 * in the Capacitor WebView `navigator.languages` reflects the Android/iOS system
 * locale, so no plugin is needed to read it and no first-run prompt is needed to
 * ask. An explicit choice in Settings wins and is remembered; clearing it hands
 * control back to the device.
 *
 * Strings live in `public/js/locales/<code>.js`, loaded on demand — a user on
 * English never downloads the German catalogue.
 *
 * MISSING KEYS FALL BACK TO ENGLISH, never to a blank or a raw key. A partially
 * translated locale therefore degrades to mixed-language text rather than to
 * holes in the UI, which is what makes it safe to ship a locale before it is
 * complete.
 */

import { en } from '../locales/en.js';

/** Languages offered in Settings. `native` is the name in that language —
 *  a picker that says "German" to someone who only reads German is useless. */
export const SUPPORTED = [
  { code: 'en', native: 'English', english: 'English' },
  { code: 'de', native: 'Deutsch', english: 'German' },
  { code: 'fr', native: 'Français', english: 'French' },
  { code: 'es', native: 'Español', english: 'Spanish' },
  { code: 'nl', native: 'Nederlands', english: 'Dutch' },
  { code: 'uk', native: 'Українська', english: 'Ukrainian' },
  { code: 'zh', native: '简体中文', english: 'Chinese (Simplified)' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi' },
  { code: 'ja', native: '日本語', english: 'Japanese' },
];

const SUPPORTED_CODES = SUPPORTED.map((l) => l.code);
const STORAGE_KEY = 'bv.lang';
const FALLBACK = 'en';

/** Catalogues keyed by code. English is bundled (it is the fallback for every
 *  other locale, so it must always be present and must never be async). */
const catalogues = { en };
let active = FALLBACK;
const listeners = new Set();

/**
 * Narrow a BCP-47 tag to a supported code: "de-AT" -> "de", "en-GB" -> "en".
 * Region is dropped deliberately — the app has one German catalogue, and
 * pretending otherwise would silently drop de-AT users to English.
 * Exported for tests.
 */
export function normalizeLocale(tag) {
  const base = String(tag || '').toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_CODES.includes(base) ? base : null;
}

/**
 * The device's preferred supported language. Walks `navigator.languages` in
 * order, so a device set to [pl, de, en] gets German rather than English.
 * Returns the fallback when nothing matches. Exported for tests.
 */
export function pickDeviceLocale(languages) {
  const list = Array.isArray(languages) ? languages : [];
  for (const tag of list) {
    const code = normalizeLocale(tag);
    if (code) return code;
  }
  return FALLBACK;
}

/** The user's saved choice, or null when they have never chosen. */
export function savedLocale() {
  try {
    return normalizeLocale(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null; // private mode / storage disabled
  }
}

export function getLocale() {
  return active;
}

/**
 * Resolve a dotted key against a catalogue. Returns undefined (not null, not
 * the key) when absent, so callers can tell "missing" from "deliberately empty".
 * Exported for tests.
 */
export function lookup(catalogue, key) {
  let node = catalogue;
  for (const part of String(key).split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/**
 * Fill {placeholders} from `vars`. An absent var leaves the placeholder text
 * visible rather than printing "undefined" — a visible {count} is a bug report,
 * "undefined sets" looks like a product that is broken.
 * Exported for tests.
 */
export function interpolate(template, vars) {
  if (!vars) return template;
  return String(template).replace(/\{(\w+)\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole);
}

/**
 * Translate. `t('nav.vault')`, `t('catalog.results', { count: 12 })`.
 *
 * Resolution: active catalogue -> English -> the key itself. Returning the key
 * (rather than an empty string) means an untranslated surface still shows
 * SOMETHING identifiable, which is far easier to spot and fix than blank space.
 */
export function t(key, vars) {
  const hit = lookup(catalogues[active], key) ?? lookup(catalogues[FALLBACK], key) ?? key;
  return interpolate(hit, vars);
}

/** Subscribe to language changes; returns an unsubscribe. */
export function onLocaleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function loadCatalogue(code) {
  if (catalogues[code]) return true;
  try {
    const mod = await import(`../locales/${code}.js`);
    catalogues[code] = mod[code] || mod.default || {};
    return true;
  } catch (e) {
    // A missing/broken catalogue must not break the app — English still works.
    console.warn('[i18n] could not load locale', code, e && e.message);
    return false;
  }
}

/**
 * Switch language. `remember: false` is used at boot for the device-derived
 * locale, so that following the device is not silently recorded as an explicit
 * user choice (which would then survive the user changing their phone's
 * language — the exact bug this flag exists to prevent).
 */
export async function setLocale(code, { remember = true } = {}) {
  const next = normalizeLocale(code) || FALLBACK;
  if (next !== FALLBACK) await loadCatalogue(next);
  active = catalogues[next] ? next : FALLBACK;
  if (remember) {
    try { localStorage.setItem(STORAGE_KEY, active); } catch { /* storage disabled */ }
  }
  applyDocumentLocale();
  for (const fn of listeners) {
    try { fn(active); } catch { /* a bad listener must not block the rest */ }
  }
  return active;
}

/** Forget the explicit choice and follow the device again. */
export async function clearLocale() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage disabled */ }
  return setLocale(pickDeviceLocale(navigator.languages || [navigator.language]), { remember: false });
}

/** Keep <html lang> honest — screen readers and Chrome's translate prompt
 *  both key off it, and a wrong value is worse than none. */
function applyDocumentLocale() {
  try { document.documentElement.setAttribute('lang', active); } catch { /* no DOM */ }
}

/**
 * Resolve and apply the startup language. Call BEFORE the first render, so the
 * UI never paints in English and then flips.
 */
export async function initLocale() {
  const saved = savedLocale();
  if (saved) return setLocale(saved, { remember: false });
  const device = pickDeviceLocale(navigator.languages || [navigator.language]);
  return setLocale(device, { remember: false });
}

/**
 * Intl locale tag for number/date formatting. Uses the ACTIVE language, so a
 * German UI gets "1.234,50" rather than "1,234.50" — formatting and wording
 * have to move together or the result reads like a bad machine translation.
 */
export function intlLocale() {
  return active;
}
