// @ts-check
// Non-OAuth deep links into the app: launcher shortcuts (Scan a set,
// Photograph a shelf, Wishlist), notification taps and bricksvault.app links
// opened on a phone with the app installed. Every link resolves to a hash
// route the router already understands; OAuth callbacks are handled first by
// native-auth.js and never reach here.

const APP_ORIGIN = 'https://bricksvault.app';
const MAX_HASH = 300;

// Path-style aliases (bricksvault.app/scan) for links typed or shared without
// a hash — the same targets the launcher shortcuts use.
/** @type {Record<string, string>} */
const PATH_ALIASES = {
  '/scan': '#/pile?scan=barcode',
  '/shelf': '#/pile?scan=shelf',
  '/photo': '#/pile?scan=photo',
  '/wishlist': '#/wishlist',
  '/add': '#/add',
};

/**
 * Hash route for an incoming app URL, or '' when it isn't one of ours.
 * @param {string} url
 * @returns {string}
 */
export function deepLinkHash(url) {
  let parsed;
  try { parsed = new URL(String(url || '')); } catch { return ''; }
  const ours = (parsed.protocol === 'https:' && parsed.origin === APP_ORIGIN)
    || parsed.protocol === 'app.bricksvault:';
  if (!ours) return '';
  const hash = parsed.hash || '';
  if (/(?:^#|&)(?:access_token|error)=/.test(hash)) return ''; // OAuth — not ours
  if (hash.startsWith('#/')) return hash.length <= MAX_HASH ? hash : '';
  const path = parsed.protocol === 'https:' ? parsed.pathname : `/${parsed.host}${parsed.pathname}`;
  const key = path.replace(/\/+$/, '').toLowerCase() || '/';
  if (key === '/') return '#/';
  return PATH_ALIASES[key] || PATH_ALIASES[key.replace(/^\/open/, '')] || '';
}

/**
 * Scanner mode asked for by a #/pile?scan=… route (launcher shortcut / PWA
 * shortcut), or null.
 * @param {string} hash
 * @returns {'barcode'|'photo'|'shelf'|null}
 */
export function scanIntentFromHash(hash) {
  const [route, query = ''] = String(hash || '').replace(/^#/, '').split('?');
  if (route !== '/pile') return null;
  const mode = new URLSearchParams(query).get('scan');
  return mode === 'barcode' || mode === 'photo' || mode === 'shelf' ? mode : null;
}
