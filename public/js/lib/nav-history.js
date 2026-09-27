// In-app history depth: how many BricksVault screens sit behind this one.
//
// Back arrows used `history.length > 1` to decide between history.back() and a
// fallback screen. history.length also counts forward entries and whatever
// the tab showed before the app (a search result, an OAuth page), so back
// could leave the app or land somewhere unexpected. Each entry instead carries
// `bvDepth` in history.state: 0 for the entry the app started on, +1 for every
// entry pushed after it. The history methods are wrapped so the many
// replaceState(null, …) calls that keep the URL in sync don't wipe it.

let depth = 0;

function depthOf(state) {
  return state && typeof state === 'object' && Number.isInteger(state.bvDepth) ? state.bvDepth : null;
}

function withDepth(state, d) {
  if (depthOf(state) !== null) return state;
  if (state == null) return { bvDepth: d };
  return typeof state === 'object' && !Array.isArray(state) ? { ...state, bvDepth: d } : state;
}

/** Depth of the current entry (0 = where the app started). */
export function navDepth() {
  return depthOf(history.state) ?? depth;
}

/** True when history.back() stays inside the app. */
export function canGoBackInApp() {
  return navDepth() > 0;
}

/**
 * Step back inside the app, or — with nothing behind this screen (a cold deep
 * link) — swap it for `fallback` without adding an entry. The swap goes
 * through replaceState (depth kept) plus a hashchange for the router:
 * location.replace would hand the new entry an empty state.
 */
export function goBackOr(fallback = '#/') {
  if (canGoBackInApp()) { history.back(); return; }
  if (location.hash === fallback) return;
  const from = location.href;
  history.replaceState(null, '', fallback);
  window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL: from, newURL: location.href }));
}

// Android back with nothing open. Roots leave the app. The other bottom-bar
// tabs (Kids Mode has its own bar) return to the home tab — Android's
// bottom-navigation rule — instead of retracing every tab and page visited
// before them, which is where back used to land "on the wrong page".
const ROOTS = new Set(['', '/', '/kids']);
const TABS = new Set(['/add', '/wishlist', '/me']);
const KIDS_TABS = new Set(['/add', '/pile', '/kids/badges']);

/** Where back goes from `hash`: 'exit', 'home' or 'history'. */
export function backTarget(hash, { kids = false } = {}) {
  if (ROOTS.has(hash)) return 'exit';
  return (kids ? KIDS_TABS : TABS).has(hash) ? 'home' : 'history';
}

let installed = false;
export function installNavHistory(win = window) {
  if (installed) return;
  installed = true;
  const h = win.history;
  const push = h.pushState.bind(h);
  const replace = h.replaceState.bind(h);
  h.pushState = (state, title, url) => {
    depth = navDepth() + 1;
    return push(withDepth(state, depth), title, url);
  };
  h.replaceState = (state, title, url) => replace(withDepth(state, navDepth()), title, url);

  // A reload or a return from another site restores the entry's own depth.
  depth = depthOf(h.state) ?? 0;
  if (depthOf(h.state) === null) replace(withDepth(h.state, depth), '');

  // Links and `location.hash = …` create entries without state: number them
  // one past the entry they were pushed from. Back/forward land on entries
  // that already carry their depth.
  const sync = () => {
    const d = depthOf(h.state);
    if (d === null) {
      depth += 1;
      replace(withDepth(h.state, depth), '');
    } else {
      depth = d;
    }
  };
  win.addEventListener('popstate', sync);
  win.addEventListener('hashchange', sync);
}
