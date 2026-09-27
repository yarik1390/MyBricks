// Android back (button and predictive back gesture).
//
// Android 16 dispatches back through OnBackInvokedCallback, and the system's
// "back to home" preview only plays when the app does NOT intercept back. So
// the app's handler is enabled only while there is something in-app to go
// back from: an overlay (sheet, scanner, advisor, image viewer, selection) or
// any screen other than a root. At the Vault root the handler is switched off
// and Android runs its own back-to-home animation — no "press back again".
import { getCapacitorPlugin, isNativeCapacitor } from './native-auth.js';
import { hideSheet } from '../components/sheet.js';
import { closeScan } from '../components/scanner-lazy.js';
import { cancelActiveStream } from '../components/advisor-lazy.js';
import { goBackOr } from './nav-history.js';
import { getModePref } from '../theme.js';

let wired = false;

// Route hashes that are "home": back from here leaves the app.
const ROOTS = new Set(['', '/', '/kids']);
// The other bottom-bar tabs. Android's bottom-navigation rule: back from one
// of them returns to the home tab, instead of retracing every tab and page
// visited before it (which is where back used to land "on the wrong page").
const TABS = new Set(['/add', '/wishlist', '/me']);

/** Where back goes from `hash` with nothing open: 'exit', 'home' or 'history'. */
export function backTarget(hash) {
  if (ROOTS.has(hash)) return 'exit';
  return TABS.has(hash) ? 'home' : 'history';
}

function currentHash() {
  return (location.hash.replace('#', '') || '/').split('?')[0];
}

function overlayOpen(doc = document) {
  const body = doc.body;
  if (!body) return false;
  const c = body.classList;
  return c.contains('lightbox-open')
    || c.contains('advisor-open')
    || !!doc.getElementById('advisorDrawer')?.classList.contains('open')
    || c.contains('sheet-open')
    || !!doc.getElementById('scanOverlay')?.classList.contains('open')
    || c.contains('selection-mode');
}

/** Pure decision used by the toggle and covered by unit tests. */
export function appShouldHandleBack({ hash, overlay }) {
  return !!overlay || !ROOTS.has(hash);
}

export function initNativeBack(win) {
  if (wired || !isNativeCapacitor(win)) return;
  const App = getCapacitorPlugin('App', win);
  if (!App?.addListener) return;
  wired = true;

  App.addListener('backButton', () => {
    // 1. Fullscreen image viewer owns a history entry — let it close itself.
    if (document.body.classList.contains('lightbox-open')) { history.back(); return; }

    // 2. Advisor chat drawer.
    const drawer = document.getElementById('advisorDrawer');
    if (drawer?.classList.contains('open') || document.body.classList.contains('advisor-open')) {
      drawer?.classList.remove('open');
      document.body.classList.remove('advisor-open');
      try { cancelActiveStream(); } catch { /* no active stream */ }
      return;
    }

    // 3. Bottom sheet — back closes only the sheet, never the page beneath.
    if (document.body.classList.contains('sheet-open')) { hideSheet(); return; }

    // 4. Camera / scanner overlay.
    if (document.getElementById('scanOverlay')?.classList.contains('open')) { closeScan(); return; }

    // 5. Vault multi-select toolbar.
    if (document.body.classList.contains('selection-mode')) {
      document.getElementById('selCancel')?.click();
      return;
    }

    // 6. Another tab → the home tab. Any other screen → one step back (or
    // home when the app was opened straight onto it).
    const home = getModePref() === 'kids' ? '#/kids' : '#/';
    const target = backTarget(currentHash());
    if (target === 'home') {
      const from = location.href;
      history.replaceState(null, '', home);
      window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL: from, newURL: location.href }));
      return;
    }
    if (target === 'history') { goBackOr(home); return; }

    // 7. A root with nothing open: the handler should already be off. If a
    // press raced the toggle, leave the app the way Android would.
    if (App.minimizeApp) App.minimizeApp();
    else App.exitApp?.();
  });

  // Keep the handler's enabled state in step with the UI.
  let enabled = null;
  const sync = () => {
    const want = appShouldHandleBack({ hash: currentHash(), overlay: overlayOpen() });
    if (want === enabled) return;
    enabled = want;
    try { App.toggleBackButtonHandler?.({ enabled: want })?.catch?.(() => {}); } catch { /* older plugin: always on */ }
  };
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; sync(); });
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  for (const id of ['scanOverlay', 'advisorDrawer']) {
    const el = document.getElementById(id);
    if (el) observer.observe(el, { attributes: true, attributeFilter: ['class'] });
  }
  window.addEventListener('hashchange', schedule);
  window.addEventListener('popstate', schedule);
  sync();
}
