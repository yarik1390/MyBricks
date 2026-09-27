// Large screens and motion for the 2026 redesign (canvas: Tablet, Foldable,
// CardMotion).
//
// List–detail: on a wide window (tablet, unfolded foldable, desktop), opening a
// set from the Vault or Discover keeps that list beside the set page. The pane
// is a snapshot of the rows (plain links), so tapping another set just opens it
// and nothing in the list can re-render over the page. Any non-set route
// closes the pane.
//
// Card → detail: tapping a set row grows its thumbnail into the set page's
// photo. The link navigates as usual; the photo is animated on the live page
// afterwards (FLIP), and only when the set page is ready quickly. It must never
// use document.startViewTransition: in the Android WebView its snapshot overlay
// can stay stuck over the live page, so a tap looked like it did nothing (the
// same failure 7b27cf1 removed from route changes). Reduced motion skips it.
const WIDE = '(min-width: 1024px)';
const MORPH_WAIT_MS = 600;

let pane = null;          // { html, title, from, nav }
let wired = false;

const isWide = () => { try { return matchMedia(WIDE).matches; } catch { return false; } };
const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return true; } };
const setHash = (h) => h.split('?')[0].startsWith('#/set/');

function rowTarget(e) {
  const el = e.target?.closest?.('a.bv-setrow[data-set-num], .vault-row[data-set-num] a.vault-row__link, .bv-tile[data-set-num] a.bv-tile__link');
  if (!el || e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  // Selecting sets in the Vault: taps toggle selection, they don't open.
  if (document.body.classList.contains('selection-mode')) return null;
  const host = el.closest('[data-set-num]');
  const href = el.getAttribute('href') || '';
  if (!host || !setHash(href)) return null;
  return { el, host, href, setNum: host.dataset.setNum };
}

// Snapshot the list the row belongs to (rows only, no toolbars).
function captureList(host) {
  if (host.closest('#bvListPane')) return;
  const list = host.parentElement;
  const page = host.closest('.bv-page');
  if (!list || !page) { pane = null; return; }
  const clone = list.cloneNode(true);
  clone.removeAttribute('id');
  clone.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  clone.querySelectorAll('button, [role="button"], input, select').forEach((n) => n.remove());
  pane = {
    html: clone.outerHTML,
    title: page.querySelector('.bv-topbar h1, h1')?.textContent?.trim() || '',
    from: location.hash || '#/',
    nav: document.querySelector('#nav .nav-tab.active')?.dataset.route || null,
  };
}

function paneEl() {
  let el = document.getElementById('bvListPane');
  if (!el) {
    el = document.createElement('aside');
    el.id = 'bvListPane';
    el.className = 'bv-listpane';
    document.body.appendChild(el);
  }
  return el;
}

/** Called by the router after every route: show, update or drop the pane. */
export function syncListPane(hash = location.hash) {
  const h = String(hash || '').startsWith('#') ? hash : `#${hash}`;
  if (!pane || !setHash(h) || !isWide()) {
    document.getElementById('bvListPane')?.remove();
    document.body.classList.remove('bv-two-pane');
    if (!setHash(h)) pane = null;
    return;
  }
  const el = paneEl();
  if (el.dataset.from !== pane.from) {
    el.dataset.from = pane.from;
    el.innerHTML = `<div class="bv-listpane__head"><a class="bv-listpane__title" href="${pane.from.replace(/"/g, '&quot;')}">${pane.title.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])}</a></div>${pane.html}`;
    el.setAttribute('aria-label', pane.title);
  }
  const current = decodeURIComponent(h.split('?')[0].split('/')[2] || '');
  el.querySelectorAll('[data-set-num]').forEach((n) => {
    const on = n.dataset.setNum === current;
    n.classList.toggle('is-current', on);
    const link = n.matches('a') ? n : n.querySelector('a');
    if (link) { if (on) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); }
  });
  document.body.classList.add('bv-two-pane');
  if (pane.nav) document.querySelectorAll('#nav .nav-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.route === pane.nav));
}

function morphFrom(t) {
  const thumb = t.host.querySelector('.bv-thumb, .bv-tile__media');
  if (!thumb || reducedMotion() || typeof thumb.animate !== 'function') return;
  const from = thumb.getBoundingClientRect();
  if (!from.width || !from.height) return;
  const started = Date.now();
  const run = () => {
    window.removeEventListener('bv:routed', run);
    if (Date.now() - started > MORPH_WAIT_MS || !setHash(location.hash)) return;
    const hero = document.querySelector('#root .bv-sethero__media');
    const to = hero?.getBoundingClientRect();
    if (!to?.width || !to.height) return;
    try {
      hero.animate([
        { transformOrigin: '0 0', transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`, opacity: 0.5 },
        { transformOrigin: '0 0', transform: 'none', opacity: 1 },
      ], { duration: 300, easing: 'cubic-bezier(.2, 0, 0, 1)' });
    } catch { /* decoration only */ }
  };
  window.addEventListener('bv:routed', run);
  setTimeout(() => window.removeEventListener('bv:routed', run), MORPH_WAIT_MS);
}

export function initListDetail() {
  if (wired) return;
  wired = true;
  document.addEventListener('click', (e) => {
    const t = rowTarget(e);
    if (!t) return;
    if (isWide()) captureList(t.host);
    if (location.hash === t.href) return;
    morphFrom(t);
  }, true);
  window.addEventListener('resize', () => syncListPane(location.hash));
}
