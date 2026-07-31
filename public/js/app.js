import { $, $$, haptic, toast, fetchExchangeRates, bvIDB, installImageFallback, track } from './utils.js';
import { state, invalidatePortfolio } from './state.js';
import { nextOfflineBannerState, shouldUseKeyboardShell } from './lib/pure-core.js';
import { loadSession, saveSession, setSupabaseConfig, drainOutbox, getSessionUserId, snapshotGuestVault, migrateGuestVault, isGuestMode, backfillGuestVault } from './api.js';
import { I } from './icons.js';
import { route } from './router.js';
import { getThemePref, applyTheme, getModePref, applyMode } from './theme.js';
import { initLocale, t as translate, onLocaleChange } from './lib/i18n.js';
import { toggleAdvisor } from './components/advisor-lazy.js';
import { openScan, closeScan, capturePhoto } from './components/scanner-lazy.js';
import { installMethodologySheet } from './components/methodology.js';
import { closeNativeAuthBrowser, getCapacitorPlugin, isNativeCapacitor, nativeOAuthCallbackFromWebBridge, oauthHashFromCallbackUrl } from './lib/native-auth.js';
// onboarding (welcome carousel) is lazy-loaded at the end of boot (see below).

// Setup gestures: swipe-back
// An overlay (bottom sheet, scanner, app-lock) captures the gesture — swiping
// near an overlay edge must never navigate the page underneath.
function overlayOpen() {
  const b = document.body.classList;
  return b.contains("sheet-open") || b.contains("scan-active") || b.contains("app-locked")
    || $("#scanOverlay")?.classList.contains("open");
}
function setupGestures() {
  // swipe-back from left edge (disabled while an overlay owns the gesture, so
  // dragging a sheet near the edge can't navigate back underneath it).
  let edgeSx = 0;
  document.addEventListener("touchstart", e => {
    if (e.touches[0].clientX < 44 && !overlayOpen()) edgeSx = e.touches[0].clientX;
    else edgeSx = 0;
  }, { passive: true });
  document.addEventListener("touchend", e => {
    if (edgeSx > 0 && !overlayOpen() && e.changedTouches[0].clientX - edgeSx > 60) {
      if (history.length > 1) history.back();
    }
  });
}

// Hydrate from IndexedDB
async function hydrateFromIDB() {
  const MAX_AGE = 604_800_000; // 7 days — show last-known data offline; online stale-while-revalidate keeps it fresh
  const now = Date.now();
  const currentUid = getSessionUserId();
  if (!currentUid) return;
  try {
    const [p, c, b, h, w] = await Promise.all([
      bvIDB.get('portfolio'), bvIDB.get('catalog'), bvIDB.get('blind'),
      bvIDB.get('history'), bvIDB.get('wishlist'),
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
    if (h?.ts && now - h.ts < MAX_AGE && h.userId === currentUid && Array.isArray(h.data)) {
      state.portfolioHistory = h.data;
    }
    if (w?.ts && now - w.ts < MAX_AGE && w.userId === currentUid && w.data) {
      state.wishlist = w.data.wishlist || [];
      state.wishlistAlerts = w.data.alerts || [];
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
    if (!(img instanceof HTMLImageElement)) return;
    // installImageFallback runs first and may have just swapped the failed
    // transformations URL for the Worker proxy or source CDN. Keep the element
    // alive until that retry succeeds or reaches the final `failed` stage.
    if (img.dataset.imgFb === "worker" || img.dataset.imgFb === "cdn") return;
    if (img.classList.contains("set-photo")) {
      // Drop the broken photo so the brick-tile placeholder shows through
      // instead of a broken-image glyph.
      img.remove();
    }
    if (img.classList.contains("fig-photo")) {
      img.remove();
    }
  }, true);
}

// When Android opens the software keyboard, fixed bottom controls otherwise
// remain pinned above it and cover the focused field. Collapse that shell while
// editing, then restore it as soon as focus leaves the control.
function setupKeyboardAwareShell() {
  const editableSelector = 'input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea, select, [contenteditable="true"]';
  const isEditable = (el) => el instanceof Element && el.matches(editableSelector);
  const compactLayout = () => window.matchMedia?.('(max-width: 700px), (pointer: coarse)')?.matches ?? false;

  const update = () => {
    const active = document.activeElement;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const open = shouldUseKeyboardShell({
      editable: isEditable(active),
      compact: compactLayout(),
      innerHeight: window.innerHeight,
      viewportHeight,
    });
    document.body.classList.toggle('keyboard-open', open);
    if (open) {
      requestAnimationFrame(() => active?.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'smooth' }));
    }
  };

  document.addEventListener('focusin', update);
  document.addEventListener('focusout', () => setTimeout(update, 120));
  window.visualViewport?.addEventListener('resize', update);
  window.visualViewport?.addEventListener('scroll', update);
}

// Detect a Supabase OAuth return in the URL hash (#access_token=...&refresh_token=...
// or #error=...). Returns true if an auth token was consumed. Safe to call on both
// the initial load (DOMContentLoaded) and on later hashchanges — an installed PWA
// can deliver the redirect to a live window without a full reload, which only fires
// hashchange. Idempotent: strips the hash after handling.
// Web Share Target (manifest share_target): another app shared text/a URL into
// BricksVault via GET params on "/". Turn it into a catalog search and clean
// the URL. Runs before the first route() so the shared query lands directly.
function consumeShareTarget() {
  try {
    if (!location.search) return;
    const sp = new URLSearchParams(location.search);
    const shared = sp.get('text') || sp.get('title') || sp.get('url') || '';
    if (!shared) return;
    // Strip URLs — a set number or name is searchable, a link is not.
    const q = shared.replace(/https?:\/\/\S+/g, ' ').trim().slice(0, 80);
    history.replaceState(null, '', location.pathname);
    if (q) location.hash = '#/add?q=' + encodeURIComponent(q);
  } catch { /* never break boot over a malformed share */ }
}

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
        if (migrated.errors?.length) {
          // Keep the snapshot so the user can retry from You → Data instead of
          // silently losing whichever local items didn't make it across.
          try { localStorage.setItem("bv_failed_guest_migration", JSON.stringify(guestSnapshot)); } catch {}
          toast("Some local items couldn't sync — retry from You → Data", "error");
        }
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

let nativeAuthBridgeReady = false;

async function consumeNativeOAuthCallback(url, { reroute = false } = {}) {
  const hash = oauthHashFromCallbackUrl(url);
  if (!hash) return false;
  try { await closeNativeAuthBrowser(); } catch {}
  history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
  const consumed = await consumeOAuthHash();
  if (consumed && reroute) await route();
  return consumed;
}

async function setupNativeAuthBridge() {
  if (nativeAuthBridgeReady || !isNativeCapacitor()) return false;
  nativeAuthBridgeReady = true;
  const App = getCapacitorPlugin('App');
  if (!App) return false;
  try {
    App.addListener?.('appUrlOpen', event => {
      consumeNativeOAuthCallback(event?.url, { reroute: true }).catch(err => {
        console.warn('[native-auth] failed to consume OAuth callback:', err);
      });
    });
  } catch (err) {
    console.warn('[native-auth] appUrlOpen listener unavailable:', err);
  }
  try {
    const launch = await App.getLaunchUrl?.();
    if (launch?.url) return await consumeNativeOAuthCallback(launch.url, { reroute: false });
  } catch (err) {
    console.warn('[native-auth] launch URL unavailable:', err);
  }
  return false;
}

// Service-worker update prompt: surface a tappable "Update ready" toast instead
// of silently reloading mid-session. Reload only happens after the user opts in.
function showUpdatePrompt(worker) {
  if (!worker || document.getElementById("swUpdateBar")) return;
  const bar = document.createElement("div");
  bar.id = "swUpdateBar";
  bar.setAttribute("role", "status");
  // Anchored to the TOP (below the status bar) so it never collides with the
  // bottom nav or a page's sticky bottom sort/filter chips.
  bar.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);top:calc(12px + var(--safe-top, 0px));z-index:1200;display:flex;align-items:center;gap:12px;background:var(--ink,#1C1C1E);color:var(--bg,#fff);padding:10px 14px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.28);font-size:14px;max-width:92vw;";
  const msg = document.createElement("span");
  msg.textContent = "Update ready";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Refresh";
  btn.style.cssText = "min-height:36px;background:var(--accent,#FFD700);color:#1C1C1E;border:none;border-radius:8px;padding:6px 14px;font-weight:700;cursor:pointer;";
  btn.addEventListener("click", () => {
    navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
    try { worker.postMessage("SKIP_WAITING"); } catch {}
    bar.remove();
  });
  bar.append(msg, btn);
  document.body.appendChild(bar);
}

// Client error telemetry: message + source only (no stacks, no user data),
// sampled so an error loop can't flood the endpoint.
window.addEventListener("error", (e) => {
  track("client_error", `${String(e.message || "").slice(0, 80)} @${String(e.filename || "").split("/").pop()}:${e.lineno || 0}`, 0.25);
});
window.addEventListener("unhandledrejection", (e) => {
  track("client_error", `unhandled: ${String(e.reason?.message || e.reason || "").slice(0, 90)}`, 0.25);
});

document.addEventListener("DOMContentLoaded", async () => {
  // Resolve the language BEFORE anything renders, so the UI never paints in
  // English and then flips. Non-fatal: a failure here leaves the bundled
  // English catalogue active rather than blocking boot.
  await initLocale().catch((e) => console.warn("[i18n] init failed:", e && e.message));
  installMethodologySheet();
  // Native OAuth returns through the allow-listed Pages URL first, then this
  // one-time bridge immediately opens the app callback before Chrome persists a
  // browser-only session.
  const nativeOAuthCallback = nativeOAuthCallbackFromWebBridge(location.href);
  if (nativeOAuthCallback) {
    location.replace(nativeOAuthCallback);
    return;
  }

  // Biometric app-lock: if enabled, cover the app and require a fingerprint
  // before anything is visible. Native + opt-in only; no-op otherwise.
  import('./lib/app-lock.js').then(({ initAppLock }) => initAppLock(window)).catch(() => {});

  // Grid thumbnails route through img.bricksvault.app; if that host fails to
  // load an <img> on a device, transparently fall back to the Worker proxy so
  // cards never sit on bare placeholders.
  installImageFallback(window);

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
    const CONFIG_CACHE_KEY = "bv_config_cache";
    const applyCfg = (c) => {
      state.config = c;
      setSupabaseConfig(c.supabase_url || "", c.supabase_anon_key || "");
    };
    const fetchConfig = async (attempts) => {
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (attempt) await new Promise(r => setTimeout(r, 400 * attempt));
        try {
          const res = await fetch(configUrl, { cache: "no-store" });
          if (!res.ok) throw new Error("HTTP " + res.status);
          return await res.json();
        } catch (e) {
          console.warn("[config] attempt " + (attempt + 1) + " failed:", (e && e.message) || e);
        }
      }
      return null;
    };
    const saveCfg = (c) => { try { localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(c)); } catch {} };
    let cachedCfg = null;
    try { cachedCfg = JSON.parse(localStorage.getItem(CONFIG_CACHE_KEY) || "null"); } catch {}
    if (cachedCfg && cachedCfg.supabase_url) {
      // Stale-while-revalidate: boot instantly on the cached copy (config
      // rarely changes) and refresh in the background for the NEXT launch.
      // This removes a full network round trip from every cold start.
      applyCfg(cachedCfg);
      fetchConfig(1).then((fresh) => { if (fresh) { saveCfg(fresh); applyCfg(fresh); } });
    } else {
      const cfg = await fetchConfig(3);
      if (cfg) {
        saveCfg(cfg);
        applyCfg(cfg);
      } else {
        state.configError = true;
        toast("Can't reach the server — an ad-blocker or privacy extension may be blocking it. Disable it for this site, or try another browser.", "error");
      }
    }
  }

  const consumedNativeOAuth = await setupNativeAuthBridge();
  if (!consumedNativeOAuth) await consumeOAuthHash();
  consumeShareTarget();

  // Nav labels come from the active language. The markup ships English so the
  // shell is readable before this runs (and if i18n ever fails to load).
  const navKeys = { "/": "vault", "/add": "catalog", "/pile": "scan", "/minifigs": "minifigs", "/kids/badges": "badges", "/me": "me" };
  const paintNavLabels = () => {
    $$("#nav .nav-tab").forEach(tab => {
      const key = navKeys[tab.dataset.route];
      if (!key) return;
      const label = tab.querySelector(".nav-label");
      const text = translate(`nav.${key}`);
      if (label) label.textContent = text;
      tab.setAttribute("aria-label", text);
    });
  };
  paintNavLabels();
  onLocaleChange(paintNavLabels);

  // Wire nav icons using icon library
  const icons = { "/": I.home, "/add": I.search, "/minifigs": I.figure, "/kids/badges": I.star, "/me": I.user };
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
  applyMode(getModePref());

  // OS theme change listener
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (getThemePref() === "auto") applyTheme("auto");
    });
  }

  // PWA install prompt — preventDefault so we can surface our own install card.
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); state.pwa.deferredPrompt = e; });

  // Offline indicator. navigator.onLine is unreliable — a cold page load / PWA
  // launch can momentarily read "offline" while actually connected, and it
  // claims "online" when the API is merely blocked. So we (a) treat a real
  // reachability probe as the source of truth — assuming online until a probe
  // proves otherwise, so a transient navigator.onLine=false at boot can't strand
  // the user — and (b) DEBOUNCE *showing* the banner: a sub-second offline blip
  // (the boot quirk, or a brief flap) must never paint. Clearing is immediate.
  let offlineProbeBusy = false;
  let offlineUiState = "online";
  let offlineShowTimer = null;
  let offlineRetryTimer = null;
  const OFFLINE_GRACE_MS = 1200;
  const OFFLINE_REPROBE_MS = 5000;
  // Decision logic is nextOfflineBannerState() (lib/pure.js, unit-tested); this
  // layer maps the reducer's state onto the grace timer + the body.offline class.
  function dispatchOffline(event) {
    const prev = offlineUiState;
    offlineUiState = nextOfflineBannerState(prev, event);
    if (offlineUiState === "pending" && prev !== "pending") {
      // Debounced show: paint only if still offline when the grace window elapses.
      offlineShowTimer = setTimeout(() => dispatchOffline("grace"), OFFLINE_GRACE_MS);
    } else if (offlineUiState !== "pending" && offlineShowTimer) {
      clearTimeout(offlineShowTimer);
      offlineShowTimer = null;
    }
    document.body.classList.toggle("offline", offlineUiState === "offline");
    // Self-heal: while we believe we're offline (or pending), keep re-probing so a
    // transient boot/SW race that stranded the banner recovers on its own — the
    // boot probe is one-shot and only re-checks on the browser "online" event,
    // which never fires when navigator.onLine was already true at a failed probe.
    if (offlineUiState === "online") {
      if (offlineRetryTimer) { clearInterval(offlineRetryTimer); offlineRetryTimer = null; }
    } else if (!offlineRetryTimer) {
      offlineRetryTimer = setInterval(() => refreshOfflineState(), OFFLINE_REPROBE_MS);
    }
  }
  const applyOfflineState = (isOffline) => dispatchOffline(isOffline ? "offline" : "online");
  async function refreshOfflineState() {
    if (offlineProbeBusy) return;
    offlineProbeBusy = true;
    try {
      // Source of truth = the probe, not navigator.onLine. Same-origin
      // /manifest.json is fast and (on first load) not intercepted by the SW.
      let online = true;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch("/manifest.json?_=" + Date.now(), { cache: "no-store", signal: ctrl.signal });
        clearTimeout(timer);
        online = res.ok;
      } catch { online = false; }
      applyOfflineState(!online);
    } finally {
      offlineProbeBusy = false;
    }
  }
  // Seed from a real connectivity probe — assume online until proven otherwise.
  refreshOfflineState();
  window.addEventListener("online", () => { refreshOfflineState(); drainOutbox(); });
  // A browser-reported disconnect shows the banner (debounced, so a flap that
  // immediately recovers never flashes).
  window.addEventListener("offline", () => applyOfflineState(true));
  // A successful API response is definitive proof of connectivity — clear any
  // banner the one-shot boot probe stranded (e.g. a cold-load SW/network race).
  // An API network-failure triggers a confirming probe rather than showing the
  // banner directly, so a single failed request can't flash it on its own.
  window.addEventListener("bv:api-ok", () => { if (offlineUiState !== "online") applyOfflineState(false); });
  window.addEventListener("bv:api-fail", () => { refreshOfflineState(); });

  setupGestures();
  setupImageHydration();
  setupKeyboardAwareShell();

  if ("serviceWorker" in navigator && !isNativeCapacitor()) {
    navigator.serviceWorker.register("/sw.js")
      .then(reg => {
        reg.update();
        if (reg.waiting && navigator.serviceWorker.controller) showUpdatePrompt(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", () => {
            if (nw.state === "installed" && navigator.serviceWorker.controller) showUpdatePrompt(nw);
          });
        });
      })
      .catch(() => {});
    // Push notification clicks focus an open window and ask it to navigate.
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data?.type === "navigate" && typeof e.data.url === "string") {
        location.hash = e.data.url.startsWith("#") ? e.data.url : "#/";
      }
    });
  } else if ("serviceWorker" in navigator && isNativeCapacitor()) {
    // The installed app is versioned by Play/App Store and serves assets from
    // its APK bundle. A Web service worker can survive an in-place APK update,
    // show a meaningless "Update ready" prompt, and serve an older shell.
    navigator.serviceWorker.getRegistrations?.()
      .then(registrations => Promise.all(registrations.map(reg => reg.unregister())))
      .catch(() => {});
  }

  // Hydrate in-memory state from IDB so first tab visit is instant.
  if (session) await hydrateFromIDB();

  await fetchExchangeRates();

  // Initial route — after config and session are loaded.
  await route();

  // Re-register an opted-in native device after app/Firebase token rotation and
  // install the notification-tap route handler. This never prompts by itself.
  if (state.config?.status?.native_push) {
    import('./lib/native-push.js').then(m => m.restoreNativePush()).catch(() => {});
  }

  // First-run welcome carousel (self-contained; no-op after the first time or
  // on the login screen, and never throws into boot). The coach-mark tour
  // remains replayable from the You tab and from the carousel's last slide.
  // Lazy-loaded so its code stays out of the initial bundle.
  import('./components/onboarding.js').then(m => m.maybeShowWelcome()).catch(() => {});

  // One-time heal for guest vaults saved before the blended market value was
  // stored locally: re-hydrate values (and assign missing ids) in the
  // background, then repaint the vault if it's the current view.
  if (isGuestMode()) {
    (window.requestIdleCallback || (fn => setTimeout(fn, 3000)))(() => {
      backfillGuestVault().then(changed => {
        const h = location.hash;
        if (changed && (h === '' || h === '#' || h === '#/')) route();
      }).catch(() => {});
    });
  }

  // If the user has the Gemma model and is online, load MediaPipe + wasm into
  // the SW cache while idle so offline scanning works after next visit.
  (window.requestIdleCallback || (fn => setTimeout(fn, 3000)))(() => {
    if (localStorage.getItem('bv_ai_engine') === 'local' && navigator.onLine) {
      import('./lib/local-ai.js').then(({ checkGemma3Downloaded, prewarmMediaPipeCache }) => {
        checkGemma3Downloaded().then(ready => { if (ready) prewarmMediaPipeCache(); }).catch(() => {});
      }).catch(() => {});
    }
  });

  // First-launch (once, wifi-gated): warm the top sets' images into the SW
  // cache so the catalog shows pictures offline even before you've browsed to
  // them. Gentle + best-effort — see lib/image-prewarm.js.
  (window.requestIdleCallback || (fn => setTimeout(fn, 4000)))(() => {
    import('./lib/image-prewarm.js').then(({ prewarmTopImages }) => prewarmTopImages()).catch(() => {});
  });

  // Android hardware back button: dismiss overlays / step back through the SPA
  // instead of Capacitor's default (walk history → exit the app). Native only.
  import('./lib/native-back.js').then(({ initNativeBack }) => initNativeBack(window)).catch(() => {});
});

window.addEventListener("hashchange", async () => {
  // An OAuth redirect can land on an already-open window (no reload), arriving
  // as a hashchange. Consume the token first so we render the new session, not
  // a "route not found" bounce on the raw #access_token=... fragment.
  await consumeOAuthHash();
  route();
});
window.bv = { openScan, closeScan, capturePhoto };
