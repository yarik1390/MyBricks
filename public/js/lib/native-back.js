// Android hardware back button. Without this, Capacitor's default is to walk
// web history and then EXIT the app — so a user deep in a set page, or with the
// scanner / a bottom sheet / the advisor drawer open, gets bounced out instead
// of just closing what's in front of them. This registers one prioritized
// handler: dismiss the top-most overlay first, then step back through the SPA,
// and only exit (with a confirm tap) from the home screen.
import { getCapacitorPlugin, isNativeCapacitor } from './native-auth.js';
import { hideSheet } from '../components/sheet.js';
import { closeScan } from '../components/scanner-lazy.js';
import { cancelActiveStream } from '../components/advisor-lazy.js';
import { toast } from '../utils.js';

let wired = false;
let exitArmed = false;

// Route hashes that count as "home" — a back press here exits the app (with a
// confirm), rather than navigating. /kids is the locked kids-mode home.
const ROOTS = new Set(['', '/', '/kids']);

export function initNativeBack(win) {
  if (wired || !isNativeCapacitor(win)) return;
  const App = getCapacitorPlugin('App', win);
  if (!App?.addListener) return;
  wired = true;

  App.addListener('backButton', ({ canGoBack } = {}) => {
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

    // 3. Bottom sheet (confirm / prompt / detail sheets).
    if (document.body.classList.contains('sheet-open')) { hideSheet(); return; }

    // 4. Camera / scanner overlay.
    if (document.getElementById('scanOverlay')?.classList.contains('open')) { closeScan(); return; }

    // 5. Vault multi-select toolbar.
    if (document.body.classList.contains('selection-mode')) {
      document.getElementById('selCancel')?.click();
      return;
    }

    // 6. Not on a home screen → step back one view.
    const hash = (location.hash.replace('#', '') || '/').split('?')[0];
    if (!ROOTS.has(hash)) {
      if (canGoBack) history.back();
      else location.hash = '#/';
      return;
    }

    // 7. On home → require a second press within 2s to actually leave.
    if (exitArmed) { App.exitApp?.(); return; }
    exitArmed = true;
    try { toast('Press back again to exit'); } catch { /* toast unavailable */ }
    setTimeout(() => { exitArmed = false; }, 2000);
  });
}
