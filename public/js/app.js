import { $, $$, haptic, toast, fetchExchangeRates, prefersReducedMotion, bvIDB } from './utils.js';
import { state, invalidatePortfolio } from './state.js';
import { loadSession, saveSession, setSupabaseConfig, drainOutbox, api, _authSession } from './api.js';
import { I } from './icons.js';
import { route } from './router.js';
import { toggleAdvisor } from './components/advisor.js';
import { openScan, closeScan, capturePhoto } from './components/scanner.js';

// Setup gestures: Pull-to-refresh + swipe-back
function setupGestures() {
  let sy = 0, pulling = false;
  document.addEventListener("touchstart", e => {
    if (window.scrollY <= 0) { sy = e.touches[0].clientY; pulling = true; }
  }, { passive: true });
  document.addEventListener("touchmove", e => {
    if (!pulling) return;
    if (e.touches[0].clientY - sy > 30) $("#ptrIndicator")?.classList.add("show");
  }, { passive: true });
  document.addEventListener("touchend", e => {
    if (!pulling) return;
    const dy = (e.changedTouches[0]?.clientY ?? sy) - sy;
    if (dy > 80) {
      haptic("medium");
      invalidatePortfolio();
      state.portfolioHistory = null;
      state.me = null;
      toast("Refreshed", "success");
      route();
    }
    pulling = false;
    setTimeout(() => $("#ptrIndicator")?.classList.remove("show"), 300);
  });

  // swipe-back from left edge
  let edgeSx = 0;
  document.addEventListener("touchstart", e => {
    if (e.touches[0].clientX < 44) edgeSx = e.touches[0].clientX;
    else edgeSx = 0;
  }, { passive: true });
  document.addEventListener("touchend", e => {
    if (edgeSx > 0 && e.changedTouches[0].clientX - edgeSx > 60) {
      if (history.length > 1) history.back();
    }
  });
}

// Helpers for theme (light / dark / auto)
function getThemePref() {
  try { return localStorage.getItem("bv_theme") || "auto"; } catch { return "auto"; }
}

function resolveTheme(pref) {
  if (pref === "light" || pref === "dark") return pref;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(pref) {
  const resolved = resolveTheme(pref);
  document.documentElement.dataset.theme = resolved;
  const color = resolved === "dark" ? "#16161C" : "#F5F1E8";
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute("content", color));
}

// Hydrate from IndexedDB
async function hydrateFromIDB() {
  const MAX_AGE = 3_600_000; // 1 hour
  const now = Date.now();
  const currentUid = state.me?.id || null;
  if (!currentUid) return;
  try {
    const [p, c, b] = await Promise.all([
      bvIDB.get('portfolio'), bvIDB.get('catalog'), bvIDB.get('blind'),
    ]);
    if (p?.ts && now - p.ts < MAX_AGE && p.userId === currentUid) state.portfolio = p.data;
    if (c?.ts && now - c.ts < MAX_AGE && c.data?.items?.length && c.userId === currentUid) {
      Object.assign(state.catalog, c.data);
      state.catalog._stale = true;
    }
    if (b?.ts && now - b.ts < MAX_AGE && b.data?.items?.length && b.userId === currentUid) {
      Object.assign(state.blind, b.data);
      state.blind._stale = true;
    }
  } catch {}
}

// Set photos are layered over a brick-tile placeholder. The CSS only reveals the
// photo (hiding the tile and making the frame transparent) once `.photo-loaded`
// is on the container — and the CSP (`script-src 'self'`) forbids inline
// onload/onerror attributes. So wire load/error here via capture-phase
// delegation (these events don't bubble). Registered before the first route()
// so it catches every set photo, including cache-fast loads.
function setupImageHydration() {
  document.addEventListener("load", (e) => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.classList.contains("set-photo")) {
      img.parentElement?.classList.add("photo-loaded");
    }
  }, true);
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.classList.contains("set-photo")) {
      // Drop the broken photo so the brick-tile placeholder shows through
      // instead of a broken-image glyph.
      img.remove();
    }
  }, true);
}

document.addEventListener("DOMContentLoaded", async () => {
  // Load session and Supabase config before any routing.
  let session = loadSession();
  try {
    const cfg = await fetch((window.WORKER_BASE || '') + "/api/config").then(r => r.json());
    state.config = cfg;
    setSupabaseConfig(cfg.supabase_url || "", cfg.supabase_anon_key || "");
  } catch {}

  // Detect Supabase OAuth return (hash fragment: #access_token=... &refresh_token=... &expires_in=...)
  if (location.hash.includes('access_token=')) {
    try {
      const hp = new URLSearchParams(location.hash.slice(1));
      if (hp.has('access_token')) {
        const oauthSess = {
          access_token: hp.get('access_token'),
          refresh_token: hp.get('refresh_token'),
          expires_at: Date.now() / 1000 + parseInt(hp.get('expires_in') || '3600'),
        };
        saveSession(oauthSess);
        history.replaceState(null, '', location.pathname + location.search);
      }
    } catch {}
  } else if (location.hash.includes('error=')) {
    try {
      const hp = new URLSearchParams(location.hash.slice(1));
      const errorMsg = hp.get('error_description')?.replace(/\+/g, ' ') || hp.get('error') || "Authentication failed";
      toast(errorMsg, "error");
      history.replaceState(null, '', location.pathname + location.search);
    } catch {}
  }

  // Wire nav icons using icon library
  const icons = { "/": I.home, "/add": I.search, "/minifigs": I.figure, "/me": I.user };
  $$("#nav .nav-tab").forEach(t => {
    const r = t.dataset.route;
    const iconFn = icons[r];
    const iconEl = t.querySelector(".nav-icon");
    if (iconFn && iconEl) iconEl.innerHTML = iconFn();
    const orb = t.querySelector(".scan-orb");
    if (orb) orb.innerHTML = I.scan();
    t.addEventListener("click", () => {
      haptic("light");
      if (t.classList.contains("active")) window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  $("#advisorFab")?.addEventListener("click", toggleAdvisor);

  // Re-assert the stored theme (the inline bootstrap set it pre-paint; this
  // wires up meta theme-color + keeps state consistent after hydration).
  applyTheme(getThemePref());

  // OS theme change listener
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (getThemePref() === "auto") applyTheme("auto");
    });
  }

  // PWA install prompt — preventDefault so we can surface our own install card.
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); state.pwa.deferredPrompt = e; });

  // Offline indicator
  const offlineHandler = () => document.body.classList.toggle("offline", !navigator.onLine);
  window.addEventListener("online", () => { offlineHandler(); drainOutbox(); });
  window.addEventListener("offline", offlineHandler);
  offlineHandler();

  setupGestures();
  setupImageHydration();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js")
      .then(reg => reg.update())
      .catch(() => {});
    navigator.serviceWorker.addEventListener("controllerchange", () => location.reload());
  }

  // Hydrate in-memory state from IDB so first tab visit is instant.
  if (session) await hydrateFromIDB();

  await fetchExchangeRates();

  // Initial route — after config and session are loaded.
  await route();
});

window.addEventListener("hashchange", route);
window.bv = { openScan, closeScan, capturePhoto };
