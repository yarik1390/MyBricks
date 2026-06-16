import { $, $$, haptic, toast, fetchExchangeRates, prefersReducedMotion, bvIDB } from './utils.js';
import { state, invalidatePortfolio } from './state.js';
import { loadSession, saveSession, setSupabaseConfig, drainOutbox, api, _authSession, getSessionUserId, snapshotGuestVault, migrateGuestVault } from './api.js';
import { I } from './icons.js';
import { route } from './router.js';
import { getThemePref, applyTheme } from './theme.js';
import { toggleAdvisor } from './components/advisor.js';
import { openScan, closeScan, capturePhoto } from './components/scanner.js';
import { maybeShowWelcome } from './components/onboarding.js';

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

// Hydrate from IndexedDB
async function hydrateFromIDB() {
  const MAX_AGE = 3_600_000; // 1 hour
  const now = Date.now();
  const currentUid = getSessionUserId();
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
    if (img instanceof HTMLImageElement && (img.classList.contains("set-photo") || img.classList.contains("fig-photo"))) {
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
    if (img instanceof HTMLImageElement && img.classList.contains("fig-photo")) {
      img.remove();
    }
  }, true);
}

// Detect a Supabase OAuth return in the URL hash (#access_token=...&refresh_token=...
// or #error=...). Returns true if an auth token was consumed. Safe to call on both
// the initial load (DOMContentLoaded) and on later hashchanges — an installed PWA
// can deliver the redirect to a live window without a full reload, which only fires
// hashchange. Idempotent: strips the hash after handling.
async function consumeOAuthHash() {
  if (location.hash.includes('access_token=')) {
    try {
      const hp = new URLSearchParams(location.hash.slice(1));
      if (hp.has('access_token')) {
        let guestSnapshot = snapshotGuestVault();
        try {
          const pending = JSON.parse(sessionStorage.getItem("bv_pending_guest_migration") || "null");
          if (pending) guestSnapshot = pending;
        } catch {}
        const oauthSess = {
          access_token: hp.get('access_token'),
          refresh_token: hp.get('refresh_token'),
          expires_at: Date.now() / 1000 + parseInt(hp.get('expires_in') || '3600'),
        };
        saveSession(oauthSess, { preserveGuestFigs: true });
        const migrated = await migrateGuestVault(guestSnapshot);
        try { sessionStorage.removeItem("bv_pending_guest_migration"); } catch {}
        if (migrated.migrated) toast(`Synced ${migrated.migrated} local item${migrated.migrated === 1 ? "" : "s"}`, "success");
        if (migrated.errors?.length) toast("Some local items couldn't sync", "error");
        // Force a clean slate for the freshly-authenticated account so a prior
        // account's profile/portfolio can never linger in memory (saveSession
        // also clears on user change, but this guards non-reload returns too).
        state.me = null;
        invalidatePortfolio();
        state.portfolioHistory = null;
        history.replaceState(null, '', location.pathname + location.search);
        return true;
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
  return false;
}

document.addEventListener("DOMContentLoaded", async () => {
  // Load session and Supabase config before any routing.
  let session = loadSession();
  // Fetch /api/config with a few retries. If it never comes back, the most
  // common cause (the app runs on *.workers.dev) is an ad-blocker / privacy
  // extension or a network blocking the API — surface that honestly instead
  // of letting login fail later with a misleading "Auth not configured" or an
  // "Unexpected end of JSON input" from an empty response.
  state.configError = false;
  {
    const configUrl = (window.WORKER_BASE || '') + "/api/config";
    let cfg = null;
    for (let attempt = 0; attempt < 3 && !cfg; attempt++) {
      if (attempt) await new Promise(r => setTimeout(r, 400 * attempt));
      try {
        const res = await fetch(configUrl, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        cfg = await res.json();
      } catch (e) {
        console.warn("[config] attempt " + (attempt + 1) + " failed:", (e && e.message) || e);
      }
    }
    if (cfg) {
      state.config = cfg;
      setSupabaseConfig(cfg.supabase_url || "", cfg.supabase_anon_key || "");
    } else {
      state.configError = true;
      toast("Can't reach the server — an ad-blocker or privacy extension may be blocking it. Disable it for this site, or try another browser.", "error");
    }
  }

  await consumeOAuthHash();

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

  // Offline indicator. navigator.onLine is unreliable — it reports false
  // negatives (desktop Chrome can claim "offline" while connected) and false
  // positives (claims "online" when the API is blocked). Confirm reachability
  // with a lightweight probe before stranding the user in cached/demo mode.
  let offlineProbeBusy = false;
  async function refreshOfflineState() {
    if (offlineProbeBusy) return;
    offlineProbeBusy = true;
    try {
      let online = navigator.onLine;
      if (online) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 4000);
          const res = await fetch((window.WORKER_BASE || '') + "/api/config", { cache: "no-store", signal: ctrl.signal });
          clearTimeout(timer);
          online = res.ok;
        } catch { online = false; }
      }
      document.body.classList.toggle("offline", !online);
    } finally {
      offlineProbeBusy = false;
    }
  }
  // Seed the initial banner from the config load we just did (no extra probe).
  document.body.classList.toggle("offline", state.configError);
  window.addEventListener("online", () => { refreshOfflineState(); drainOutbox(); });
  window.addEventListener("offline", () => document.body.classList.toggle("offline", true));

  setupGestures();
  setupImageHydration();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js")
      .then(reg => reg.update())
      .catch(() => {});
    navigator.serviceWorker.addEventListener("controllerchange", () => location.reload());
    // Push notification clicks focus an open window and ask it to navigate.
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data?.type === "navigate" && typeof e.data.url === "string") {
        location.hash = e.data.url.startsWith("#") ? e.data.url : "#/";
      }
    });
  }

  // Hydrate in-memory state from IDB so first tab visit is instant.
  if (session) await hydrateFromIDB();

  await fetchExchangeRates();

  // Initial route — after config and session are loaded.
  await route();

  // First-run welcome carousel (self-contained; no-op after the first time or
  // on the login screen, and never throws into boot). The coach-mark tour
  // remains replayable from the You tab and from the carousel's last slide.
  maybeShowWelcome();

  // If the user has the Gemma model and is online, load MediaPipe + wasm into
  // the SW cache while idle so offline scanning works after next visit.
  (window.requestIdleCallback || (fn => setTimeout(fn, 3000)))(() => {
    if (localStorage.getItem('bv_ai_engine') === 'local' && navigator.onLine) {
      import('./lib/local-ai.js').then(({ checkGemma3Downloaded, prewarmMediaPipeCache }) => {
        checkGemma3Downloaded().then(ready => { if (ready) prewarmMediaPipeCache(); }).catch(() => {});
      }).catch(() => {});
    }
  });
});

window.addEventListener("hashchange", async () => {
  // An OAuth redirect can land on an already-open window (no reload), arriving
  // as a hashchange. Consume the token first so we render the new session, not
  // a "route not found" bounce on the raw #access_token=... fragment.
  await consumeOAuthHash();
  route();
});
window.bv = { openScan, closeScan, capturePhoto };
