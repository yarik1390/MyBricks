import { $, $$, prefersReducedMotion } from './utils.js';
import { state } from './state.js';
import { api } from './api.js';
import { I } from './icons.js';
import { routeMetaFor } from './route-meta.js';
// View modules load on demand via dynamic import() in the route dispatch below,
// so the initial bundle no longer eagerly pulls every page's code up front.
// Each view is still pre-cached by the service worker (STATIC_ASSETS) so offline
// navigation resolves the import from cache. import() memoizes per module, so
// revisiting a route doesn't re-fetch or re-evaluate it.
import { hideSheet } from './components/sheet.js';
import { closeScan } from './components/scanner-lazy.js';
import { cancelActiveStream } from './components/advisor-lazy.js';

let _routeBusy = false;
let _routeQueued = false;

export { routeMetaFor };

export async function route() {
  if (_routeBusy) { _routeQueued = true; return; }
  _routeBusy = true;
  try {
    await _routeImpl();
  } finally {
    _routeBusy = false;
    if (_routeQueued) { _routeQueued = false; route(); }
  }
}

async function _routeImpl() {
  hideSheet();
  closeScan();
  cancelActiveStream();
  // Strip query params from the fragment (e.g. #/me?google_sync=success → /me).
  // Views that need the query string read location.hash directly.
  let hash = (location.hash.replace("#", "") || "/").split("?")[0];
  if (hash === "/blind") { location.hash = "#/minifigs"; return; }
  const meta = routeMetaFor(hash);
  document.body.dataset.route = meta.key;
  $("#advisorDrawer")?.classList.remove("open");
  document.body.classList.remove("advisor-open");
  document.body.style.overflow = "";

  // Login is optional; guests can use the app with local-only data.
  if (hash === "/login") {
    const { renderLogin } = await import('./views/login.js');
    await withViewTransition(() => renderLogin());
    return;
  }

  if (!state.me) {
    try {
      state.me = await api("/api/me");
    } catch (e) {
      console.error("Failed to load user profile", e);
      state.me = { display_name: "Guest Collector", handle: null, notify_price_drops: true, currency: "USD", is_guest: true, portfolio_stats: {} };
    }
  }

  if (hash !== "/" && hash !== "") {
    if (state.selectionMode) {
      state.selectionMode = false;
      state.selectedSets.clear();
      $("#selectionBar")?.remove();
    }
  }

  // Restore nav if it was hidden by the login screen.
  const nav = document.getElementById("nav");
  if (nav) nav.style.display = "";

  const fab = document.getElementById("advisorFab");
  if (fab) {
    // Show the AI assistant on every screen except the Scan camera (/pile),
    // where a floating button would fight the full-screen capture UI, and the
    // login screen. It's now available on Catalog (/add), Minifigs and Build
    // too (users asked for it there), plus Vault, set-detail and You.
    const fabHidden = hash === "/login" || hash === "/pile";
    fab.style.display = fabHidden ? "none" : "flex";
  }
  $$("#nav .nav-tab").forEach(t => {
    const r = t.dataset.route;
    const active = r === meta.nav;
    t.classList.toggle("active", active);
  });

  const render = async () => {
    if (hash === "/" || hash === "") await (await import('./views/portfolio.js')).renderPortfolio();
    else if (hash === "/add") await (await import('./views/catalog.js')).renderAdd();
    else if (hash === "/pile") (await import('./views/catalog.js')).renderPile();
    else if (hash === "/minifigs") await (await import('./views/minifigs.js')).renderBlind();
    else if (hash === "/build") await (await import('./views/build.js')).renderBuild();
    else if (hash === "/me") await (await import('./views/me.js')).renderMe();
    else if (hash === "/me/integrations") await (await import('./views/me-integrations.js')).renderMeIntegrations();
    else if (hash === "/me/data") await (await import('./views/me-data.js')).renderMeData();
    else if (hash === "/me/contributions") await (await import('./views/me-contributions.js')).renderMeContributions();
    else if (hash === "/me/admin") await (await import('./views/me-admin.js')).renderMeAdmin();
    else if (hash === "/wishlist") await (await import('./views/portfolio-wishlist.js')).renderWishlist();
    else if (hash === "/leaderboard") await (await import('./views/portfolio-social.js')).renderLeaderboard();
    else if (hash.startsWith("/set/")) {
      const parts = hash.split("/");
      const setNum = decodeURIComponent(parts[2]);
      state.detail.tab = parts[3] || "info";
      await (await import('./views/portfolio-detail.js')).renderSetDetail(setNum);
    } else if (hash.startsWith("/u/")) {
      const handle = hash.slice(3);
      await (await import('./views/portfolio-social.js')).renderPublicProfile(handle);
    } else {
      location.hash = "#/";
      throw { __redirect: true };
    }
  };

  try {
    const cached = hasCachedView(hash);
    if (!cached) showNavProgress();
    await withViewTransition(() => render());
    hideNavProgress();
    if (!cached) {
      document.querySelector('#root .page')?.setAttribute('data-fresh', '1');
    }
  } catch (e) {
    hideNavProgress();
    if (e && e.__redirect) return;
    const root = $("#root");
    if (root) {
      root.innerHTML = errorStateHTML();
      $("#errorRetry")?.addEventListener("click", () => route());
    }
  }
  window.scrollTo({ top: 0, behavior: "instant" });
}

// Navigate + render deterministically. Unlike assigning `location.hash`
// (which only re-renders if the browser fires `hashchange`), this always
// drives a single route() — critical for auth transitions (login/logout)
// where the view must refresh immediately regardless of hashchange timing.
export function go(hash) {
  if (location.hash !== hash) {
    history.pushState(null, '', hash);
  }
  route();
}

export function showNavProgress() {
  const el = document.getElementById('navProgress');
  if (el) {
    el.classList.remove('done');
    el.style.width = '0';
    el.offsetWidth;
    el.classList.add('loading');
  }
  const root = document.getElementById('root');
  if (root) {
    root.classList.add('route-loading');
  }
}

export function hideNavProgress() {
  const el = document.getElementById('navProgress');
  if (el) {
    el.classList.remove('loading');
    el.classList.add('done');
    setTimeout(() => { el.classList.remove('done'); }, 500);
  }
  const root = document.getElementById('root');
  if (root) {
    root.classList.remove('route-loading');
  }
}

export function hasCachedView(hash) {
  if (hash === "/" || hash === "") return !!state.portfolio;
  if (hash === "/add") return state.catalog.items.length > 0;
  if (hash === "/minifigs") return state.blind.items.length > 0;
  return false;
}

export async function withViewTransition(fn) {
  await fn();
  if (prefersReducedMotion()) return;
  const root = document.getElementById('root');
  if (!root) return;
  root.classList.remove('route-fade');
  void root.offsetWidth;
  root.classList.add('route-fade');
}

export function errorStateHTML() {
  return `
    <div class="page">
      <div class="empty card">
        <div class="empty-icon">${I.info()}</div>
        <h3>Something went wrong</h3>
        <p>We couldn't load this page. Check your connection and try again.</p>
        <button class="btn-primary" id="errorRetry">${I.refresh()}<span>Retry</span></button>
      </div>
    </div>`;
}
