// App-wide motion helpers (design pass 2026-11).
//
// - Page changes know their direction: going deeper slides in from the right,
//   going back from the left, bottom tabs do a short sideways fade toward the
//   tab that was tapped. The router's existing `route-fade` class still drives
//   the animation; this module only says which way (html[data-nav]).
// - Swipe back from the left edge moves the page with the finger.
// - Set page sections slide the way they were swiped and the tab underline
//   glides to the new section.
//
// Everything animates transform/opacity on the live page. The View Transitions
// API is deliberately not used: its snapshot overlay could stay stuck over the
// page in the Android WebView (see lib/list-detail.js).
import { navDepth } from './nav-history.js';

const reduced = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};
const routeOf = (hash = location.hash) => (String(hash).replace(/^#/, '') || '/').split('?')[0];

/** Direction of a navigation: 'fwd' | 'back' | 'tab-l' | 'tab-r' | ''. */
export function navDirection({ fromRoute, toRoute, fromDepth, toDepth, tabs = [] }) {
  const a = tabs.indexOf(fromRoute), b = tabs.indexOf(toRoute);
  const side = Math.sign(b - a);
  if (a !== -1 && b !== -1 && side) return side === 1 ? 'tab-r' : 'tab-l';
  const depth = Math.sign(toDepth - fromDepth);
  return depth === 1 ? 'fwd' : depth === -1 ? 'back' : '';
}

function bottomTabs() {
  return [...document.querySelectorAll('#nav .nav-tab[data-route]')]
    .filter((el) => el.offsetParent !== null)
    .map((el) => el.dataset.route);
}

/** Tag every hash navigation with its direction before the router paints. */
export function installNavDirection() {
  let lastRoute = routeOf();
  let lastDepth = navDepth();
  window.addEventListener('hashchange', () => {
    const toRoute = routeOf();
    const toDepth = navDepth();
    const dir = reduced() ? '' : navDirection({ fromRoute: lastRoute, toRoute, fromDepth: lastDepth, toDepth, tabs: bottomTabs() });
    if (dir) document.documentElement.dataset.nav = dir;
    else delete document.documentElement.dataset.nav;
    lastRoute = toRoute;
    lastDepth = toDepth;
  }, true);
}

/* ------------------------------------------------------------ swipe back */
const COMMIT_PX = 96;
let drag = null;

function pageIsFixed(root) {
  const page = root?.firstElementChild;
  try { return !page || getComputedStyle(page).position === 'fixed'; } catch { return true; }
}

function edgeHint() {
  let el = document.getElementById('dpBackHint');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dpBackHint';
    el.className = 'dp-edge';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<span><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></span>';
    document.body.insertBefore(el, document.body.firstChild);
  }
  return el;
}

/** The page starts following the finger. Returns false when it should not. */
export function backDragStart() {
  const root = document.getElementById('root');
  if (reduced() || !root || pageIsFixed(root)) { drag = null; return false; }
  drag = { root, hint: edgeHint(), armed: false };
  return true;
}

/** Move the page by `dx` px; `onArm` fires once when release would go back. */
export function backDragMove(dx, onArm) {
  if (!drag) return;
  const x = Math.max(0, dx);
  drag.root.classList.add('dp-drag');
  drag.root.classList.remove('dp-drag-end');
  drag.root.style.transform = `translateX(${x.toFixed(1)}px)`;
  drag.hint.style.opacity = String(Math.min(1, x / 90));
  drag.hint.style.setProperty('--s', String(Math.min(1, 0.6 + x / 220)));
  const armed = x > COMMIT_PX;
  if (armed && !drag.armed && onArm) onArm();
  drag.armed = armed;
}

/**
 * Finger lifted. `commit` runs `go` after the page has slid away; otherwise
 * the page springs back. Safe to call when no drag is active (runs `go`).
 */
export function backDragEnd(commit, go) {
  const d = drag;
  drag = null;
  if (!d) { if (commit && go) go(); return; }
  const { root, hint } = d;
  const reset = () => {
    root.classList.remove('dp-drag', 'dp-drag-end');
    root.style.transform = '';
    root.style.opacity = '';
    hint.style.opacity = '0';
  };
  root.classList.add('dp-drag-end');
  if (commit) {
    root.style.transform = `translateX(${window.innerWidth}px)`;
    root.style.opacity = '.4';
    setTimeout(() => { reset(); if (go) go(); }, 200);
  } else {
    root.style.transform = '';
    hint.style.opacity = '0';
    setTimeout(reset, 240);
  }
}

export const BACK_COMMIT_PX = COMMIT_PX;

/* ------------------------------------------------------------ tab strips */
/** Glide the underline of a `.bv-tabs` strip to its selected tab. */
export function syncTabInk(bar) {
  if (!bar) return;
  const sel = bar.querySelector('[aria-selected="true"]');
  if (!sel) return;
  let ink = bar.querySelector(':scope > .dp-ink');
  const fresh = !ink;
  if (fresh) {
    ink = document.createElement('span');
    ink.className = 'dp-ink';
    ink.setAttribute('aria-hidden', 'true');
    ink.style.transition = 'none';
    bar.appendChild(ink);
    bar.classList.add('dp-hasink');
  }
  ink.style.left = `${sel.offsetLeft}px`;
  ink.style.width = `${sel.offsetWidth}px`;
  if (fresh) requestAnimationFrame(() => { ink.style.transition = ''; });
}

/** Slide freshly painted panel content in from the side it was swiped from. */
export function slidePanel(panel, dir) {
  if (!panel || reduced() || !dir) return;
  panel.classList.remove('dp-tab-l', 'dp-tab-r');
  void panel.offsetWidth;
  panel.classList.add(dir > 0 ? 'dp-tab-r' : 'dp-tab-l');
}
