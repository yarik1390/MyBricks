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

// ---------------------------------------------------------------------------
// Exact-match UI dictionary.
//
// The keyed catalogue above is for new code. This covers the ~776 English
// strings already hard-coded across 31 view/component files, WITHOUT rewriting
// every call site — a refactor that size is far more likely to break the app
// than to translate it.
//
// It works by replacing rendered text nodes whose EXACT trimmed content matches
// a known English UI string. That exactness is the safety property:
//   - a LEGO set name ("Millennium Falcon") is not in the dictionary, so it is
//     never touched;
//   - user-entered text and numbers never match;
//   - anything we did not harvest simply stays English, exactly as today.
// The harvester (scripts/harvest-ui-strings.mjs) only collects hole-free
// strings, which is precisely the set that CAN match a rendered node — a
// template with a ${hole} renders as one node the dictionary cannot know.
// ---------------------------------------------------------------------------

const uiDicts = {};   // code -> { english: translated }
let uiDict = null;    // the active one, or null for English

/** Elements whose text is data, not UI copy, or where rewriting is unsafe. */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE']);

async function loadUiDict(code) {
  if (code === FALLBACK) return null;
  if (uiDicts[code] !== undefined) return uiDicts[code];
  try {
    const mod = await import(`../locales/ui-${code}.js`);
    uiDicts[code] = mod.ui || mod.default || null;
  } catch {
    uiDicts[code] = null; // no dictionary for this language yet — stay English
  }
  return uiDicts[code];
}

/**
 * Translate a rendered subtree in place. Safe to call repeatedly: replacements
 * are English->target, and a target string is not itself a key, so a second
 * pass finds nothing to do.
 */
export function translateDOM(root = document.body) {
  if (!uiDict || !root) return 0;
  let n = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (parent.closest('[data-no-i18n]')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const hits = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const raw = node.nodeValue;
    const key = raw.replace(/\s+/g, ' ').trim();
    const hit = uiDict[key];
    if (hit) hits.push([node, raw, hit]);
  }
  for (const [node, raw, hit] of hits) {
    // Keep the original leading/trailing whitespace so inline layout (spacing
    // between adjacent inline elements) is not silently changed.
    const lead = raw.match(/^\s*/)[0];
    const tail = raw.match(/\s*$/)[0];
    const next = lead + hit + tail;
    // NEVER write a value equal to what is already there. Some dictionary
    // entries map a string to itself (brand names, strings a translator left
    // as-is), and assigning nodeValue still queues a characterData record even
    // when the text is unchanged. With characterData observed, that record
    // would re-queue the same node forever.
    if (next === raw) continue;
    node.nodeValue = next;
    n++;
  }
  // User-visible attributes carry copy too.
  for (const attr of ['placeholder', 'aria-label', 'title']) {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      if (el.closest('[data-no-i18n]')) continue;
      const current = el.getAttribute(attr);
      const hit = uiDict[current.replace(/\s+/g, ' ').trim()];
      if (hit && hit !== current) { el.setAttribute(attr, hit); n++; }
    }
  }
  return n;
}

/** Load the active language's UI dictionary and apply it to what is on screen. */
export async function applyUiDictionary() {
  uiDict = await loadUiDict(active);
  if (uiDict) translateDOM(document.body);
  return !!uiDict;
}

/** True when the active language has an exact-match dictionary loaded. */
export function hasUiDictionary() {
  return !!uiDict;
}

let observer = null;
let pending = null;
// Subtrees awaiting a pass, accumulated ACROSS observer batches. This has to
// outlive a single callback: a route render fires many batches inside one
// frame, and anything collected in an earlier batch must still be translated.
const queued = [];

/**
 * Keep the dictionary applied as the app re-renders.
 *
 * A hook on route() alone is not enough: views also repaint through morphdom,
 * and sheets/toasts/drawers are injected outside the router entirely. Observing
 * the tree catches every path without threading a call through 31 files.
 *
 * Added subtrees AND changed text are both re-scanned, and the work is coalesced
 * into one animation frame, so a chatty render loop costs one pass rather than
 * one per mutation.
 *
 * characterData has to be observed because mount() renders through morphdom,
 * which PATCHES existing text nodes rather than replacing elements. A view that
 * re-renders in place (the catalog after a filter change, a count that ticks)
 * therefore produced no childList records at all, and its new English text sat
 * untranslated until a full page reload rebuilt the tree — the reason strings
 * "only translated after a refresh".
 *
 * Observing our own writes is safe because the pass is idempotent: a translated
 * string is not itself a key, so the extra pass our writes schedule finds
 * nothing and writes nothing, and the loop stops after one no-op. translateDOM
 * additionally refuses to write a value identical to the current one, which is
 * what keeps self-mapping dictionary entries from cycling forever.
 *
 * The coalescing QUEUES subtrees rather than replacing them. An earlier version
 * kept `roots` local to the callback and did cancelAnimationFrame + reschedule
 * on each batch, which silently dropped every subtree collected before the last
 * batch of the frame. A route render is many batches, so most of a freshly
 * rendered page was never visited — strings sat untranslated in English while
 * the dictionary held a perfectly good entry for them, and a manual
 * translateDOM(document.body) fixed them instantly. Rescheduling also risked
 * starving the pass entirely under a continuous mutation stream, since each new
 * batch pushed the frame back. Now the frame is scheduled once and drains
 * whatever accumulated.
 */
export function startAutoTranslate() {
  if (observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver((records) => {
    if (!uiDict) return;
    for (const rec of records) {
      if (rec.type === 'characterData') {
        // Re-walk from the parent, not the text node: a TreeWalker rooted at a
        // text node visits nothing.
        if (rec.target.parentElement) queued.push(rec.target.parentElement);
        continue;
      }
      for (const node of rec.addedNodes) {
        if (node.nodeType === 1) queued.push(node);
        else if (node.nodeType === 3 && node.parentElement) queued.push(node.parentElement);
      }
    }
    if (!queued.length || pending) return;
    pending = requestAnimationFrame(() => {
      pending = null;
      for (const r of queued.splice(0)) {
        // A queued subtree can be replaced again before the frame runs; walking
        // a detached tree is wasted work that changes nothing on screen.
        if (!r.isConnected) continue;
        try { translateDOM(r); } catch { /* one bad subtree must not stop the rest */ }
      }
    });
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}
