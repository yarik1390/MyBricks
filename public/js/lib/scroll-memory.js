// Where a page opens: at the top, or where it was left.
//
// Bottom-bar destinations (and Vault sections) come back where they were left
// on any visit. Every other page (a set, Retiring soon, a profile) opens at
// the top when it is opened from somewhere (history depth grows) and keeps its
// spot only when it is returned to with Back. Restoring by route alone
// reopened a set page halfway down the second time it was tapped.
const KEEP_SCROLL_ROUTES = new Set(['/', '', '/add', '/wishlist', '/me', '/minifigs', '/build', '/collections', '/kids', '/kids/badges']);

/** A set page rewrites its own hash per section (#/set/<num>/<tab>): key it by set. */
export function scrollKeyFor(hash) {
  const h = String(hash || '/');
  return h.startsWith('/set/') ? h.split('/').slice(0, 3).join('/') : h;
}

/** True: go back to where `hash` was left. False: open it at the top. */
export function shouldRestoreScroll(hash, { fromDepth, toDepth } = {}) {
  if (KEEP_SCROLL_ROUTES.has(hash)) return true;
  if (fromDepth == null || toDepth == null) return true; // a re-render in place
  return toDepth <= fromDepth;
}
