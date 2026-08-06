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
let localeGeneration = 0;

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

/** Format a kid reward while preserving optional localized level/badge copy. */
export function kidsXpMessage(xp, { level, badge } = {}) {
  const details = [
    level ? t('common.kidsXpLevel', { level }) : '',
    badge ? t('common.kidsXpBadge', { badge }) : '',
  ].filter(Boolean).join('');
  return t('common.kidsXp', { xp, details });
}

// Reward payloads carry stable slugs, rather than display copy. Centralizing
// their presentation keeps XP toasts and celebrations consistent in every UI.
const KIDS_BADGE_KEYS = {
  first_brick: 'kids.badgeFirstBrick',
  junior_builder: 'kids.badgeJuniorBuilder',
  architect: 'kids.badgeArchitect',
  master: 'kids.badgeMaster',
  grand_master: 'kids.badgeGrandMaster',
  legend: 'kids.badgeLegend',
};

export function kidsBadgeLabel(slug) {
  const normalized = String(slug || '').trim().toLowerCase();
  if (!normalized) return '';
  const key = KIDS_BADGE_KEYS[normalized];
  if (key) {
    const localized = lookup(catalogues[active], key) ?? lookup(catalogues[FALLBACK], key);
    if (localized) return localized.replace(/[!！]+$/u, '');
  }
  // A server can add a badge before a client update. Preserve a safe, readable
  // fallback instead of exposing its implementation slug verbatim.
  return normalized.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Translate a count-aware message. Locale plural categories are intentionally
 * selected before lookup: Ukrainian needs one/few/many (1, 3, 5, 21), while
 * English only uses one/other. Locales may share wording by repeating a form.
 */
export function tPlural(baseKey, count, vars = {}) {
  const n = Number(count);
  let category = 'other';
  if (Number.isFinite(n)) {
    try { category = new Intl.PluralRules(active).select(n); } catch { /* other is safe */ }
  }
  const suffix = category.charAt(0).toUpperCase() + category.slice(1);
  const forms = [`${baseKey}${suffix}`, `${baseKey}Other`, `${baseKey}Many`, `${baseKey}One`];
  // Prefer a locale's established base copy over an English plural fallback.
  // That keeps a partially translated catalogue native while its forms land.
  const key = forms.find((candidate) => lookup(catalogues[active], candidate) != null)
    || (lookup(catalogues[active], baseKey) != null ? baseKey : '')
    || forms.find((candidate) => lookup(catalogues[FALLBACK], candidate) != null)
    || baseKey;
  const resolvedCount = Number.isFinite(n) ? n : count;
  return t(key, { ...vars, n: resolvedCount, count: vars.count ?? resolvedCount });
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
  const generation = ++localeGeneration;
  const next = normalizeLocale(code) || FALLBACK;
  if (next !== FALLBACK) await loadCatalogue(next);
  // A slower, older module import must never overwrite a newer Settings pick.
  // Its caller still resolves with the actual active locale, which makes rapid
  // selection safe for both UI handlers and programmatic callers.
  if (generation !== localeGeneration) return active;
  active = catalogues[next] ? next : FALLBACK;
  if (remember) {
    try { localStorage.setItem(STORAGE_KEY, active); } catch { /* storage disabled */ }
  }
  applyDocumentLocale();
  // Settings re-renders immediately after this resolves. Await listeners so
  // the exact dictionary for the new locale is installed before that render
  // can add English nodes (and before callers inspect the visible shell).
  for (const fn of listeners) {
    try { await fn(active); } catch { /* a bad listener must not block the rest */ }
    if (generation !== localeGeneration) return active;
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
// A rendered node loses its English key after exact translation. Keep the
// original source and the last value we wrote so uk -> de -> en can always
// start from English rather than trying to translate an already-translated
// string. WeakMaps make the bookkeeping disappear with detached DOM nodes.
const textRenderState = new WeakMap();
const attributeRenderState = new WeakMap();

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
  if (!root) return 0;
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
    const previous = textRenderState.get(node);
    // A different value is an application mutation, not one of our own
    // translations. Adopt it as fresh English source before translating.
    const source = !previous || raw !== previous.rendered ? raw : previous.source;
    const key = source.replace(/\s+/g, ' ').trim();
    const hit = uiDict?.[key];
    hits.push([node, raw, source, hit]);
  }
  for (const [node, raw, source, hit] of hits) {
    // Keep the original leading/trailing whitespace so inline layout (spacing
    // between adjacent inline elements) is not silently changed.
    const lead = source.match(/^\s*/)[0];
    const tail = source.match(/\s*$/)[0];
    const next = hit ? lead + hit + tail : source;
    // NEVER write a value equal to what is already there. Some dictionary
    // entries map a string to itself (brand names, strings a translator left
    // as-is), and assigning nodeValue still queues a characterData record even
    // when the text is unchanged. With characterData observed, that record
    // would re-queue the same node forever.
    textRenderState.set(node, { source, rendered: next });
    if (next !== raw) { node.nodeValue = next; n++; }
  }
  // User-visible attributes carry copy too. querySelectorAll() deliberately
  // excludes its receiver, so include an element root explicitly: callers
  // commonly translate a newly-mounted button/input before it has children.
  for (const attr of ['placeholder', 'aria-label', 'title']) {
    const elements = root.nodeType === 1 && root.hasAttribute(attr)
      ? [root, ...root.querySelectorAll(`[${attr}]`)]
      : root.querySelectorAll(`[${attr}]`);
    for (const el of elements) {
      if (el.closest('[data-no-i18n]')) continue;
      const current = el.getAttribute(attr);
      const all = attributeRenderState.get(el) || {};
      const previous = all[attr];
      const source = !previous || current !== previous.rendered ? current : previous.source;
      const hit = uiDict?.[source.replace(/\s+/g, ' ').trim()];
      const next = hit || source;
      all[attr] = { source, rendered: next };
      attributeRenderState.set(el, all);
      if (next !== current) { el.setAttribute(attr, next); n++; }
    }
  }
  return n;
}

/** Load the active language's UI dictionary and apply it to what is on screen. */
export async function applyUiDictionary() {
  const requested = active;
  const nextDict = await loadUiDict(requested);
  // applyUiDictionary can be called by overlapping locale listeners. Only the
  // dictionary belonging to the still-current language may commit.
  if (requested !== active) return false;
  uiDict = nextDict;
  // Even English must run this pass: it restores sources retained in the
  // WeakMaps after a non-English locale was active.
  translateDOM(document.body);
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

// Keep the smallest useful set of pending subtrees. A parent covers every
// descendant, so retaining both only repeats a full walk; conversely, replacing
// a parent with a child would drop siblings. This works across observer batches
// as well as within one callback, which is essential for morphdom renders.
function queueTranslationRoot(root) {
  if (!root || !root.isConnected) return;
  for (const existing of queued) {
    if (existing === root || existing.contains(root)) return;
  }
  for (let i = queued.length - 1; i >= 0; i--) {
    if (root.contains(queued[i])) queued.splice(i, 1);
  }
  queued.push(root);
}

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
        if (rec.target.parentElement) queueTranslationRoot(rec.target.parentElement);
        continue;
      }
      if (rec.type === 'attributes') {
        queueTranslationRoot(rec.target);
        continue;
      }
      for (const node of rec.addedNodes) {
        if (node.nodeType === 1) queueTranslationRoot(node);
        else if (node.nodeType === 3 && node.parentElement) queueTranslationRoot(node.parentElement);
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
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['placeholder', 'aria-label', 'title'],
  });
}
