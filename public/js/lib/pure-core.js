// @ts-check
// Boot-critical pure helpers, split from pure.js so the app-shell boot graph
// (app.js → utils.js/api.js) doesn't parse the full ~800-line helper module
// for four small functions. pure.js re-exports these, so views and tests keep
// importing everything from lib/pure.js unchanged.

/**
 * Extract the `sub` (user id) claim from a JWT access token. Returns null when
 * the token is missing/malformed. JWT segments are base64url with no padding,
 * so normalize before decoding — plain atob() can choke on missing padding,
 * which previously made account-switch detection silently fail (two valid
 * tokens both resolving to null and comparing "equal").
 * @param {string|null|undefined} token
 * @returns {string|null}
 */
export function jwtSub(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    let s = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = s.length % 4;
    if (pad) s += "=".repeat(4 - pad);
    const payload = JSON.parse(atob(s));
    return payload.sub || null;
  } catch {
    return null;
  }
}

// THE single source of a set/collection row's display value on the client:
// the blended market value when present, then the persisted blend column, then
// the formula current_value. Every surface (catalog card, vault row, set
// detail, add button, CSV math) must use this — a second copy of this chain
// once let the catalog show a different number than the vault for the same set.
/** @param {{market_value?: unknown, blended_value?: unknown, current_value?: unknown}} [row] */
export function displayValueOf(row = {}) {
  return Number(row.market_value) > 0 ? Number(row.market_value)
    : Number(row.blended_value) > 0 ? Number(row.blended_value)
    : (Number(row.current_value) || 0);
}

/**
 * Return a shallow copy whose legacy `current_value` points at the canonical
 * display value. This keeps older helpers (target-gap and buy-window math)
 * aligned with cards that already render `market_value`/`blended_value`.
 * @template {Record<string, unknown>} T
 * @param {T} row
 * @returns {T & {current_value: number}}
 */
export function withDisplayValue(row) {
  return { ...row, current_value: displayValueOf(row) };
}

/**
 * Mobile WebViews resize around the software keyboard inconsistently. Treat a
 * focused editable control as keyboard-open on compact/coarse layouts, while a
 * large VisualViewport occlusion is sufficient on every platform.
 * @param {{editable: boolean, compact: boolean, innerHeight?: number, viewportHeight?: number}} input
 */
export function shouldUseKeyboardShell({ editable, compact, innerHeight = 0, viewportHeight = 0 }) {
  const occluded = Number(innerHeight) - Number(viewportHeight) > 120;
  return editable && (compact || occluded);
}

/**
 * Pure state machine for the offline banner's show/cancel debounce. Kept here
 * (and unit-tested) so the "never flash on load" logic has a single source of
 * truth; app.js maps the returned state onto a real grace timer + the
 * `body.offline` class.
 *
 * States: 'online' (hidden), 'pending' (hidden, grace timer running),
 *         'offline' (banner shown).
 * Events: 'offline' (a we-might-be-offline signal), 'online' (confirmed online),
 *         'grace'   (the grace window elapsed).
 *
 * The flash is prevented by 'pending' + 'online' → 'online': a transient offline
 * blip (e.g. a cold-load navigator.onLine=false quirk) is cancelled before the
 * grace window elapses, so the banner never paints. 'pending' + 'grace' →
 * 'offline' promotes a *persistent* offline state to shown. Any state + 'online'
 * clears immediately. An unknown `current` is treated as 'online'.
 * @param {string} current
 * @param {string} event
 * @returns {"online"|"pending"|"offline"}
 */
export function nextOfflineBannerState(current, event) {
  const state = current === "pending" || current === "offline" ? current : "online";
  if (event === "online") return "online";
  if (event === "offline") return state === "offline" ? "offline" : "pending";
  if (event === "grace") return state === "pending" ? "offline" : state;
  return state;
}

/**
 * Bounded LRU upsert for the offline set-detail cache. Pure — no IndexedDB, no
 * DOM — so it can be unit-tested; utils.js wraps it with the bvIDB read/write.
 *
 * The cache is one object: { uid, items: { [setNum]: { set, entry, ts } } }.
 * It is scoped to a single user — `entry` holds that user's purchase data, so a
 * uid change (sign-out / switch) discards the whole map rather than leaking it.
 * When the map exceeds `cap`, the oldest entries (by ts) are evicted.
 *
 * @param {{uid?: string|null, items?: Record<string, {set: object, entry: object|null, ts: number}>}|null|undefined} store  the previous cache object
 * @param {{setNum: string, set: object, entry?: object|null, ts: number, uid?: string|null, cap?: number}} e
 * @returns {{uid: string|null, items: Record<string, {set: object, entry: object|null, ts: number}>}} the next cache object (new ref)
 */
export function upsertDetailCache(store, { setNum, set, entry = null, ts, uid = null, cap = 40 }) {
  const next = (store && store.uid === uid && store.items)
    ? { uid, items: { ...store.items } }
    : { uid, items: {} };
  next.items[setNum] = { set, entry, ts };
  const keys = Object.keys(next.items);
  if (keys.length > cap) {
    keys.sort((a, b) => (next.items[a].ts || 0) - (next.items[b].ts || 0));
    for (const k of keys.slice(0, keys.length - cap)) delete next.items[k];
  }
  return next;
}
