// Lightweight, dependency-free first-run app tour. Visits the main screens and
// spotlights what matters on each with a tooltip card. Shows once (localStorage
// flag); replayable from Profile via startOnboarding(). Fully self-contained — if anything
// throws it never breaks app boot (maybeStartOnboarding swallows errors).
import { haptic, toast, activateFocusTrap, soundEnabled, advisorEnabled, celebrateChime, bvIDB, escapeHtml } from '../utils.js';
import { I } from '../icons.js';
import { getThemePref, setThemePref, getSkinPref, setSkinPref, getModePref, setModePref } from '../theme.js';
import { api, isGuestMode } from '../api.js';
import { state, invalidatePortfolio } from '../state.js';
import { route } from '../router.js';
import { SUPPORTED, getLocale, setLocale, applyUiDictionary, translateDOM, t } from '../lib/i18n.js';
import { isNativeBilling, proPurchaseReady, presentProPaywall } from '../lib/revenuecat-native.js';

const FLAG = 'bv_onboarded_v1';

// Each step can visit a screen (`route`) and spotlight something on it
// (`target`). A step whose screen isn't in the nav (Kids mode hides Wishlist),
// or whose target never renders (no Scan button on that layout), is skipped.
// The dial in the card header turns one notch per step, like opening the vault.
const STEPS = [
  { kind: 'intro', title: 'Welcome to BricksVault', body: 'Take a one-minute look around your new vault.', chips: ['Track value', 'Scan boxes', 'Price alerts'] },
  { route: '/', target: '#vaultHero', icon: 'trend', eyebrow: 'Vault', title: 'What your collection is worth', body: 'Every set is valued from market prices and updated daily. Open Insights for top movers and retirement risk.' },
  { route: '/', target: '.vault-layout', icon: 'grid', eyebrow: 'Vault', title: 'List, grid or 3D room', body: 'Switch views anytime, or walk through your shelves in the 3D collection room.' },
  { route: '/', target: '#bvFab:not([hidden])', icon: 'scan', eyebrow: 'Vault', title: 'Scan to add', body: 'Scan a box barcode or photograph a whole shelf, and the sets land in your vault.' },
  { route: '/add', target: '#discoverPage .bv-search', icon: 'search', eyebrow: 'Discover', title: 'Find any set', body: 'Search 27,000+ sets by name, set number or barcode.' },
  { route: '/add', target: '.bv-discover__shortcuts', icon: 'bell', eyebrow: 'Discover', title: 'Retiring soon and Coming soon', body: 'Catch sets before they leave the shelves, and see what launches next.' },
  { route: '/wishlist', target: '#nav .nav-tab[data-route="/wishlist"]', icon: 'heart', eyebrow: 'Wishlist', title: 'Price alerts', body: 'Add the sets you want and set a target price. We alert you when a deal drops below it.' },
  { route: '/me', target: '#nav .nav-tab[data-route="/me"]', icon: 'user', eyebrow: 'Profile', title: 'Make it yours', body: 'Your public profile, Brick Wrapped, family vault, currency and Pro all live here.' },
  { kind: 'outro', title: 'You’re all set', body: 'Add a set to see it valued, or replay this tour anytime from Profile.' },
];

let idx = 0;
let dir = 1;
let root = null;
let onResize = null;
let _tourTrapRelease = null;
let renderToken = 0;
let startHash = '';
let swipeX = null;

function currentPath() {
  return (location.hash || '#/').replace(/^#/, '').split('?')[0] || '/';
}

function isLaunchSurface() {
  return currentPath() === '/';
}

// The Vault Dial from the app icon, drawn inline so it can turn per step.
function dialSVG() {
  const ticks = [0, 90, 180, 270].map(a => `<rect x="38" y="9" width="4" height="9" rx="2" transform="rotate(${a + 45} 40 40)"/>`).join('');
  return `<svg class="bv-tour-dial" viewBox="0 0 80 80" aria-hidden="true">
    <rect class="tile" width="80" height="80" rx="22"/>
    <circle class="ring" cx="40" cy="40" r="29"/>
    <g class="turn">${ticks}<circle class="track" cx="40" cy="40" r="19"/></g>
    <circle class="knob" cx="40" cy="40" r="12"/>
    <ellipse class="shine" cx="36" cy="35.5" rx="5" ry="3"/>
  </svg>`;
}

function ensureStyles() {
  if (document.getElementById('bv-tour-style')) return;
  const css = `
    .bv-tour{position:fixed;inset:0;z-index:9999;touch-action:none;}
    .bv-tour-spot{position:fixed;border-radius:18px;box-shadow:0 0 0 9999px rgba(10,11,8,.66);transition:border-radius .35s cubic-bezier(.2,.8,.2,1),top .35s cubic-bezier(.2,.8,.2,1),left .35s cubic-bezier(.2,.8,.2,1),width .35s cubic-bezier(.2,.8,.2,1),height .35s cubic-bezier(.2,.8,.2,1);pointer-events:none;}
    .bv-tour-spot.ring{outline:2px solid var(--accent,#ffda47);outline-offset:2px;}
    .bv-tour-spot.ring::after{content:"";position:absolute;inset:-2px;border-radius:inherit;animation:bvtourpulse 1.8s ease-out infinite;}
    @keyframes bvtourpulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--accent,#ffda47) 70%,transparent)}100%{box-shadow:0 0 0 14px transparent}}
    .bv-tour-card{position:fixed;left:50%;transform:translateX(-50%);width:min(360px,calc(100vw - 32px));box-sizing:border-box;background:var(--surface,#fff);color:var(--ink,#252820);border:1px solid var(--line-soft,#dadcd1);border-radius:24px;padding:18px 18px 14px;box-shadow:0 24px 60px -18px rgba(0,0,0,.5),0 2px 8px rgba(0,0,0,.08);transition:top .35s cubic-bezier(.2,.8,.2,1),bottom .35s cubic-bezier(.2,.8,.2,1);}
    .bv-tour-card.center{top:50%;transform:translate(-50%,-50%);text-align:center;padding:28px 22px 16px;}
    .bv-tour-caret{position:absolute;width:14px;height:14px;background:inherit;border:inherit;transform:rotate(45deg);left:var(--caret-x,50%);margin-left:-7px;}
    .bv-tour-caret.down{bottom:-8px;border-top:0;border-left:0;}
    .bv-tour-caret.up{top:-8px;border-bottom:0;border-right:0;}
    .bv-tour-content{animation:bvtourin .32s cubic-bezier(.2,.8,.2,1);}
    .bv-tour-content.back{animation-name:bvtourback;}
    @keyframes bvtourin{from{opacity:0;transform:translateX(18px)}to{opacity:1;transform:none}}
    @keyframes bvtourback{from{opacity:0;transform:translateX(-18px)}to{opacity:1;transform:none}}
    .bv-tour-head{display:flex;align-items:center;gap:12px;margin-bottom:12px;}
    .bv-tour-ic{width:40px;height:40px;border-radius:13px;background:var(--accent,#ffda47);color:#1d1a0c;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
    .bv-tour-ic svg{width:21px;height:21px;}
    .bv-tour-eyebrow{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent-text,#705400);}
    .bv-tour-count{margin-left:auto;font-size:12px;font-weight:600;color:var(--ink-mute,#606458);font-variant-numeric:tabular-nums;}
    .bv-tour-dial{display:block;width:76px;height:76px;margin:0 auto 16px;filter:drop-shadow(0 12px 22px rgba(242,187,18,.45));}
    .bv-tour-dial .tile{fill:#ffd23a;}
    .bv-tour-dial .ring{fill:#1f2025;}
    .bv-tour-dial .turn{fill:#ffd23a;transform-origin:40px 40px;transition:transform .6s cubic-bezier(.3,1.4,.5,1);}
    .bv-tour-dial .track{fill:none;stroke:#ffd23a;stroke-opacity:.45;stroke-width:1.5;}
    .bv-tour-dial .knob{fill:#ffd23a;}
    .bv-tour-dial .shine{fill:#fff;opacity:.55;}
    .bv-tour-card h4{margin:0 0 6px;font-family:var(--sans,inherit);font-size:19px;line-height:1.25;font-weight:750;letter-spacing:-.02em;}
    .bv-tour-card.center h4{font-size:23px;}
    .bv-tour-card p{margin:0;font-size:14.5px;line-height:1.5;color:var(--ink-soft,#35382f);}
    .bv-tour-chips{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin-top:14px;}
    .bv-tour-chips span{font-size:12.5px;font-weight:600;padding:6px 11px;border-radius:999px;background:color-mix(in srgb,var(--accent,#ffda47) 22%,var(--surface-2,#efede4));color:var(--ink,#252820);}
    .bv-tour-bar{display:flex;gap:4px;margin:16px 0 10px;}
    .bv-tour-bar i{flex:1;height:4px;border-radius:2px;background:var(--surface-3,#e5e2d5);transition:background .3s;}
    .bv-tour-bar i.on{background:var(--accent,#ffda47);}
    .bv-tour-row{display:flex;align-items:center;justify-content:space-between;gap:10px;}
    .bv-tour-skip{background:none;border:none;color:var(--ink-mute,#606458);font-size:14px;font-weight:600;cursor:pointer;padding:8px 6px;min-width:44px;min-height:44px;}
    .bv-tour-nav{display:flex;gap:8px;margin-left:auto;}
    .bv-tour-btn{border:1px solid var(--line-soft,#dadcd1);background:var(--surface-2,#efede4);color:var(--ink,#252820);border-radius:14px;padding:10px 16px;min-height:44px;font-size:14px;font-weight:700;cursor:pointer;}
    .bv-tour-btn.primary{background:var(--accent,#ffda47);border-color:var(--accent,#ffda47);color:#1d1a0c;padding-inline:20px;}
    .bv-tour button:focus-visible{outline:3px solid var(--accent,#ffda47);outline-offset:3px;}
    @media (prefers-reduced-motion: reduce){.bv-tour-spot,.bv-tour-card,.bv-tour-dial .turn{transition:none;}.bv-tour-content,.bv-tour-spot.ring::after{animation:none;}}
  `;
  const el = document.createElement('style');
  el.id = 'bv-tour-style';
  el.textContent = css;
  document.head.appendChild(el);
}

function finish(dest) {
  try { localStorage.setItem(FLAG, '1'); } catch {}
  renderToken++;
  if (onResize) { window.removeEventListener('resize', onResize); onResize = null; }
  document.removeEventListener('keydown', onKey);
  if (_tourTrapRelease) { _tourTrapRelease(); _tourTrapRelease = null; }
  root?.remove();
  root = null;
  // Leave the user where they started (or where the last button points), not
  // on whichever screen the tour last visited.
  try {
    if (dest) location.hash = dest;
    else if (startHash && location.hash !== startHash) location.hash = startHash;
  } catch {}
}

function onKey(e) {
  if (e.key === 'Escape') finish();
  else if (e.key === 'ArrowRight') go(1);
  else if (e.key === 'ArrowLeft') go(-1);
}

function visible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && (el.offsetParent !== null || getComputedStyle(el).position === 'fixed');
}

function stepAvailable(step) {
  if (!step.route) return true;
  // The screen must be reachable from the nav in the current mode.
  return visible(document.querySelector(`#nav .nav-tab[data-route="${step.route}"]`));
}

// Wait for a freshly routed screen to paint its target. Resolves null if it
// never appears, so the step is skipped instead of pointing at nothing.
function waitForTarget(sel, token, timeout = 1600) {
  return new Promise(resolve => {
    const t0 = performance.now();
    const tick = () => {
      if (token !== renderToken) return resolve(null);
      const el = document.querySelector(sel);
      if (visible(el)) return resolve(el);
      if (performance.now() - t0 > timeout) return resolve(null);
      setTimeout(tick, 60);
    };
    tick();
  });
}

function visibleSteps() {
  return STEPS.filter(stepAvailable);
}

function cardHTML(step) {
  const steps = visibleSteps();
  const pos = Math.max(0, steps.indexOf(step));
  const isFirst = idx === 0;
  const isLast = idx === STEPS.length - 1;
  const bar = steps.map((_, i) => `<i class="${i <= pos ? 'on' : ''}"></i>`).join('');
  const center = step.kind === 'intro' || step.kind === 'outro';
  const head = center
    ? dialSVG()
    : `<div class="bv-tour-head"><span class="bv-tour-ic">${I[step.icon] ? I[step.icon]() : ''}</span><span class="bv-tour-eyebrow">${escapeHtml(step.eyebrow)}</span><span class="bv-tour-count" aria-hidden="true">${pos + 1}/${steps.length}</span></div>`;
  const chips = step.chips ? `<div class="bv-tour-chips">${step.chips.map(c => `<span>${escapeHtml(c)}</span>`).join('')}</div>` : '';
  let buttons;
  if (isLast) {
    buttons = `<button class="bv-tour-btn" data-act="add">${escapeHtml('Add a set')}</button>
      <button class="bv-tour-btn primary" data-act="next">${escapeHtml('Done')}</button>`;
  } else if (isFirst) {
    buttons = `<button class="bv-tour-btn primary" data-act="next">${escapeHtml('Start tour')}</button>`;
  } else {
    buttons = `<button class="bv-tour-btn" data-act="back">${escapeHtml('Back')}</button>
      <button class="bv-tour-btn primary" data-act="next">${escapeHtml('Next')}</button>`;
  }
  return `<span class="bv-tour-caret" hidden></span>
    <div class="bv-tour-content${dir < 0 ? ' back' : ''}">
      ${head}
      <h4 id="bv-tour-title">${escapeHtml(step.title)}</h4>
      <p>${escapeHtml(step.body)}</p>
      ${chips}
    </div>
    <div class="bv-tour-bar" role="progressbar" aria-label="Tour progress" aria-valuemin="1" aria-valuemax="${steps.length}" aria-valuenow="${pos + 1}">${bar}</div>
    <div class="bv-tour-row">
      ${isLast ? '' : `<button class="bv-tour-skip" data-act="skip">${escapeHtml(isFirst ? 'Not now' : 'Skip')}</button>`}
      <div class="bv-tour-nav">${buttons}</div>
    </div>`;
}

function place(target) {
  if (!root) return;
  const spot = root.querySelector('.bv-tour-spot');
  const card = root.querySelector('.bv-tour-card');
  const caret = card.querySelector('.bv-tour-caret');
  const dial = card.querySelector('.bv-tour-dial .turn');
  if (dial) dial.style.transform = `rotate(${idx * 45}deg)`;
  card.classList.toggle('center', !target);
  card.style.top = '';
  card.style.bottom = '';
  if (!target) {
    // Zero-size spot in the middle => an even dim with no hole.
    Object.assign(spot.style, { width: '0px', height: '0px', top: '50%', left: '50%' });
    spot.classList.remove('ring');
    return;
  }
  const r = target.getBoundingClientRect();
  const pad = 6;
  Object.assign(spot.style, {
    width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`,
    top: `${r.top - pad}px`, left: `${r.left - pad}px`,
  });
  spot.classList.add('ring');
  // Card above the target when it sits in the lower half (the nav is docked
  // at the bottom), below it otherwise, with a caret pointing at it.
  const vh = window.innerHeight;
  const below = r.top + r.height / 2 < vh / 2;
  if (below) card.style.top = `${Math.min(r.bottom + pad + 14, vh - card.offsetHeight - 12)}px`;
  else card.style.bottom = `${Math.min(vh - r.top + pad + 14, vh - card.offsetHeight - 12)}px`;
  const cr = card.getBoundingClientRect();
  const x = Math.max(24, Math.min(cr.width - 24, r.left + r.width / 2 - cr.left));
  caret.hidden = false;
  caret.className = `bv-tour-caret ${below ? 'up' : 'down'}`;
  card.style.setProperty('--caret-x', `${x}px`);
}

async function render() {
  if (!root) return;
  const token = ++renderToken;
  // Skip steps whose screen isn't reachable in this mode; walk in the
  // direction of travel and finish if we run off the end.
  while (idx >= 0 && idx < STEPS.length && !stepAvailable(STEPS[idx])) idx += dir;
  if (idx < 0) { idx = 0; dir = 1; return render(); }
  if (idx >= STEPS.length) { finish(); return; }
  const step = STEPS[idx];
  if (step.route && currentPath() !== step.route) location.hash = `#${step.route}`;
  let target = null;
  if (step.target) {
    target = await waitForTarget(step.target, token);
    if (token !== renderToken || !root) return;
    if (!target) { idx += dir; return render(); }
    const r = target.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) {
      target.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  }
  const card = root.querySelector('.bv-tour-card');
  card.innerHTML = cardHTML(step);
  place(target);
  translateDOM(card);
  card.querySelector('[data-act="next"]')?.focus({ preventScroll: true });
}

// Re-measure only (resize/rotation) without rebuilding the card.
function reposition() {
  const step = STEPS[idx];
  if (!root || !step) return;
  const target = step.target ? document.querySelector(step.target) : null;
  place(visible(target) ? target : null);
}

function go(delta) {
  if (!root) return;
  dir = delta < 0 ? -1 : 1;
  idx += delta;
  if (idx < 0) { idx = 0; return; }
  if (idx >= STEPS.length) { finish(); return; }
  render();
}

export function startOnboarding() {
  try {
    if (root) return;
    ensureStyles();
    idx = 0;
    dir = 1;
    startHash = location.hash || '#/';
    root = document.createElement('div');
    root.className = 'bv-tour';
    // Modal-dialog semantics + Tab focus trap (keyboard users can't tab into the
    // dimmed page behind the tour); Escape still closes via onKey. Mirrors the
    // welcome carousel. release() (in finish) restores focus to the invoker.
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'bv-tour-title');
    root.innerHTML = `<div class="bv-tour-spot"></div><div class="bv-tour-card" aria-live="polite"></div>`;
    root.addEventListener('click', (e) => {
      const act = e.target?.closest?.('[data-act]')?.dataset?.act;
      if (!act) return;
      haptic('light');
      if (act === 'next') go(1);
      else if (act === 'back') go(-1);
      else if (act === 'skip') finish();
      else if (act === 'add') finish('#/add');
    });
    // Swipe the card left/right to step through, as on any modern carousel.
    root.addEventListener('pointerdown', (e) => { swipeX = e.clientX; });
    root.addEventListener('pointerup', (e) => {
      if (swipeX == null) return;
      const dx = e.clientX - swipeX;
      swipeX = null;
      if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
    });
    document.body.appendChild(root);
    // Paint valid content synchronously before focus trapping or yielding to a
    // frame. If a deferred callback is throttled (notably when replayed from
    // Settings), an empty full-screen overlay would otherwise block the app.
    const card = root.querySelector('.bv-tour-card');
    card.innerHTML = cardHTML(STEPS[0]);
    place(null);
    translateDOM(card);
    if (!root?.querySelector('.bv-tour-card button')) throw new Error('Tour controls failed to render');
    document.addEventListener('keydown', onKey);
    _tourTrapRelease = activateFocusTrap(root);
    onResize = () => reposition();
    window.addEventListener('resize', onResize);
    requestAnimationFrame(() => root?.querySelector('.bv-tour-card [data-act="next"]')?.focus());
  } catch {
    root?.remove();
    root = null;
  }
}

// First-run trigger. Defensive: only when not yet seen, the main nav is
// visible (i.e. not on the login screen), and never throws into app boot.
export function maybeStartOnboarding() {
  try {
    if (localStorage.getItem(FLAG)) return;
    if (!isLaunchSurface()) return;
    const nav = document.getElementById('nav');
    if (!nav || getComputedStyle(nav).display === 'none') return;
    startOnboarding();
  } catch {}
}

// ---------------------------------------------------------------------------
// First-run SETUP WIZARD — pick view mode, appearance and a few options up front
// so the app feels right from the very first view. Shown once (bv_setup_v1).
// Every choice applies LIVE (setModePref/setThemePref/setSkinPref + prefs) so the
// wizard chrome re-themes as you pick. The coach-mark tour (startOnboarding) is
// still offered on the final step. Self-contained; never throws into boot.
// ---------------------------------------------------------------------------
const SETUP_FLAG = 'bv_setup_v1';
const SETUP_STEPS = ['welcome', 'mode', 'appearance', 'extras', 'support', 'done'];
// Swatches are mini-cards styled like the REAL skin (surface + border + shadow +
// radius), not arbitrary colors — Retro is chunky pixel-shadow, Modular is soft &
// rounded, Vivid is dark. That's what actually differs between them.
const SETUP_SKINS = [
  { id: 'retro',   label: 'Retro',   css: 'background:#F5F1E8;border:2px solid #1C1C1E;box-shadow:3px 3px 0 #1C1C1E;border-radius:8px;' },
  { id: 'modular', label: 'Modular', css: 'background:#FFFFFF;border:1.5px solid #E7E0D0;box-shadow:0 6px 14px rgba(33,36,43,.18);border-radius:15px;' },
  { id: 'vivid',   label: 'Vivid',   css: 'background:#211F2C;border:2px solid #FFFFFF;box-shadow:3px 3px 0 #FFFFFF;border-radius:9px;' },
];
const SETUP_CURRENCIES = ['USD', 'GBP', 'EUR', 'CAD', 'AUD'];

let suRoot = null, suTrap = null, suIdx = 0;
let suScrollY = 0, suPageStyles = null;

// Android WebView can chain touch-scroll through a fixed overlay to the page
// behind it. Freeze the page for the setup wizard and restore it exactly on exit.
function suLockPage() {
  if (suPageStyles) return;
  suScrollY = window.scrollY || 0;
  suPageStyles = {
    htmlOverflow: document.documentElement.style.overflow,
    bodyOverflow: document.body.style.overflow,
    bodyPosition: document.body.style.position,
    bodyTop: document.body.style.top,
    bodyWidth: document.body.style.width,
  };
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
  document.body.style.position = 'fixed';
  document.body.style.top = `-${suScrollY}px`;
  document.body.style.width = '100%';
}

function suUnlockPage() {
  if (!suPageStyles) return;
  document.documentElement.style.overflow = suPageStyles.htmlOverflow;
  document.body.style.overflow = suPageStyles.bodyOverflow;
  document.body.style.position = suPageStyles.bodyPosition;
  document.body.style.top = suPageStyles.bodyTop;
  document.body.style.width = suPageStyles.bodyWidth;
  suPageStyles = null;
  window.scrollTo(0, suScrollY);
}

function ensureSetupStyles() {
  if (document.getElementById('bv-setup-style')) return;
  const css = `
    .bv-setup{position:fixed;inset:0;z-index:10000;background:var(--surface,#fff);color:var(--ink,#16181d);display:flex;flex-direction:column;animation:bvsufade .3s ease;}
    @keyframes bvsufade{from{opacity:0}to{opacity:1}}
    .bv-setup-top{display:flex;justify-content:flex-end;padding:12px 16px 0;min-height:20px;}
    .bv-setup-skip{background:none;border:none;color:var(--ink-mute,#8b91a0);font-size:14px;font-weight:600;cursor:pointer;padding:12px 16px;min-height:44px;}
    .bv-setup-body{flex:1;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding:18px 24px;display:flex;flex-direction:column;justify-content:safe center;width:min(100%,520px);margin:0 auto;box-sizing:border-box;}
    .bv-setup-body::-webkit-scrollbar{display:none;}
    .bv-setup-hero{width:92px;height:92px;border-radius:24px;display:flex;align-items:center;justify-content:center;margin:6px auto 20px;color:#fff;box-shadow:0 14px 34px -12px rgba(0,0,0,.35);}
    .bv-setup-hero svg{width:42px;height:42px;}
    .bv-setup-body h3{margin:0 0 8px;text-align:center;font-family:var(--serif,inherit);font-size:23px;font-weight:800;letter-spacing:-.01em;}
    .bv-setup-body .sub{margin:0 auto 20px;text-align:center;font-size:14px;line-height:1.5;color:var(--ink-soft,#3f4654);max-width:32ch;}
    .bv-opts{display:flex;flex-direction:column;gap:12px;}
    .bv-opt{display:flex;align-items:flex-start;gap:13px;text-align:left;width:100%;padding:14px 15px;border:2px solid var(--line,#e5e7eb);border-radius:16px;background:var(--surface-2,#f6f7f9);color:inherit;cursor:pointer;transition:border-color .15s,background .15s;}
    .bv-opt.sel{border-color:var(--accent,#e23b3b);background:color-mix(in srgb,var(--accent,#e23b3b) 9%,var(--surface-2,#f6f7f9));}
    .bv-opt-emoji{font-size:25px;line-height:1.1;flex-shrink:0;}
    .bv-opt-txt b{display:block;font-size:15px;font-weight:700;margin-bottom:3px;}
    .bv-opt-txt span{font-size:12.5px;color:var(--ink-soft,#3f4654);line-height:1.45;}
    .bv-field{margin-bottom:18px;}
    .bv-field-lbl{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-mute,#8b91a0);margin-bottom:9px;}
    .bv-seg{display:flex;gap:8px;}
    .bv-seg button{flex:1;padding:11px 6px;border:2px solid var(--line,#e5e7eb);border-radius:12px;background:var(--surface-2,#f6f7f9);color:inherit;font-size:13.5px;font-weight:600;cursor:pointer;}
    .bv-seg button.sel{border-color:var(--accent,#e23b3b);background:color-mix(in srgb,var(--accent,#e23b3b) 10%,transparent);}
    .bv-skins{display:flex;gap:14px;}
    .bv-skin{cursor:pointer;background:none;border:none;padding:0;}
    .bv-skin i{display:block;width:60px;height:46px;margin:2px auto 7px;}
    .bv-skin.sel i{outline:2.5px solid var(--accent,#e23b3b);outline-offset:3px;}
    .bv-skin span{font-size:11.5px;color:var(--ink-soft);font-weight:600;}
    .bv-note{font-size:12.5px;color:var(--ink-soft);line-height:1.45;background:var(--surface-2,#f6f7f9);border-radius:12px;padding:11px 13px;}
    .bv-langs{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;}
    .bv-lang{padding:9px 14px;min-height:44px;border:2px solid var(--line,#e5e7eb);border-radius:999px;background:var(--surface-2,#f6f7f9);color:inherit;font-size:13.5px;font-weight:600;cursor:pointer;}
    .bv-lang.sel{border-color:var(--accent,#e23b3b);background:color-mix(in srgb,var(--accent,#e23b3b) 10%,transparent);}
    .bv-preview{margin:0 0 20px;}
    /* Uses the skin's own tokens (border weight, shadow, radius, surface, accent)
       so the card visibly takes on each skin — Retro's hard pixel shadow, Modular's
       soft rounded elevation, Vivid's dark surface. */
    .bv-preview-card{display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--surface-2,#f6f7f9);border:var(--bw,2px) solid var(--border-c,var(--line,#e5e7eb));border-radius:var(--r-3,16px);box-shadow:var(--shadow-2,3px 3px 0 var(--line-soft,#e5e7eb));transition:border-radius .15s,box-shadow .15s;}
    .bv-preview-brick{width:38px;height:38px;border-radius:var(--r-1,8px);background:var(--accent,#e23b3b);border:var(--bw,2px) solid var(--border-c,var(--line,#e5e7eb));flex-shrink:0;}
    .bv-preview-txt{flex:1;min-width:0;}
    .bv-preview-txt b{display:block;font-size:14px;font-weight:700;}
    .bv-preview-txt span{font-size:11.5px;color:var(--ink-mute,#8b91a0);}
    .bv-preview-val{font-family:var(--serif,inherit);font-weight:800;font-size:17px;}
    .bv-perks{list-style:none;margin:0 0 16px;padding:0;display:flex;flex-direction:column;gap:10px;}
    .bv-perks li{position:relative;padding-left:26px;font-size:14px;line-height:1.4;}
    .bv-perks li::before{content:"✦";position:absolute;left:4px;top:0;color:var(--accent,#e23b3b);font-weight:700;}
    .bv-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 0;border-top:1px solid var(--line-soft,#eee);}
    .bv-row.first{border-top:none;}
    .bv-row-lbl b{display:block;font-size:14.5px;font-weight:700;}
    .bv-row-lbl span{font-size:12px;color:var(--ink-soft);}
    .bv-sel{font-family:var(--mono,monospace);font-weight:700;font-size:14px;border:2px solid var(--line);border-radius:10px;padding:8px 10px;min-height:44px;background:var(--surface-2);color:inherit;cursor:pointer;}
    .bv-tgl{width:52px;height:44px;border:0;background:transparent;position:relative;cursor:pointer;flex-shrink:0;}
    .bv-tgl::before{content:"";position:absolute;inset:8px 2px;border:2px solid var(--line);border-radius:999px;background:var(--surface-2);transition:background .2s,border-color .2s;}
    .bv-tgl::after{content:"";position:absolute;top:12px;left:6px;width:20px;height:20px;border-radius:50%;background:var(--ink-mute);transition:transform .2s,background .2s;}
    .bv-tgl.on::before{background:var(--accent);border-color:var(--accent);}
    .bv-tgl.on::after{transform:translateX(20px);background:#fff;}
    .bv-setup-foot{padding:14px 24px calc(18px + var(--safe-bottom, 0px));display:flex;flex-direction:column;gap:14px;border-top:1px solid var(--line-soft,#eee);}
    .bv-setup-dots{display:flex;gap:7px;justify-content:center;}
    .bv-setup-dots i{width:7px;height:7px;border-radius:50%;background:var(--line,#d6d9e0);transition:background .25s,width .25s,border-radius .25s;}
    .bv-setup-dots i.on{background:var(--accent,#e23b3b);width:22px;border-radius:4px;}
    .bv-setup-nav{display:flex;gap:10px;}
    .bv-setup-btn{flex:1;border:2px solid var(--line);border-radius:14px;padding:14px;min-height:44px;font-size:15px;font-weight:700;cursor:pointer;background:var(--surface-2);color:inherit;}
    .bv-setup-btn.primary{flex:2;background:var(--accent,#e23b3b);border-color:var(--accent,#e23b3b);color:#111;}
    .bv-setup-ghost{background:none;border:none;color:var(--ink-mute);font-size:13.5px;font-weight:600;cursor:pointer;padding:10px;min-height:44px;}
    .bv-setup-ghost[aria-busy="true"]{opacity:.6;cursor:wait;}
    .bv-setup-note{min-height:1.2em;margin:7px 0 0;color:var(--ink-mute);font-size:12.5px;line-height:1.35;text-align:center;}
    .bv-setup button:focus-visible,.bv-setup select:focus-visible{outline:3px solid var(--accent,#e23b3b);outline-offset:3px;}
    @media (prefers-reduced-motion: reduce){.bv-setup{animation:none;}.bv-opt,.bv-preview-card,.bv-tgl::before,.bv-tgl::after,.bv-setup-dots i{transition:none;}}
  `;
  const el = document.createElement('style');
  el.id = 'bv-setup-style';
  el.textContent = css;
  document.head.appendChild(el);
}

function heroHTML(icon, hue) {
  return `<div class="bv-setup-hero" style="background:linear-gradient(145deg,oklch(.62 .19 ${hue}),oklch(.5 .16 ${(hue + 32) % 360}));">${typeof I[icon] === 'function' ? I[icon]({ w: 42 }) : ''}</div>`;
}

function stepBodyHTML(key) {
  if (key === 'welcome') {
    // Language leads, because every screen after it depends on the answer. The
    // default is the device locale, which is right for most people — but a
    // phone set to a language the user does not read (a shared or second-hand
    // device, a work profile) left them with no way to change it until they
    // found Settings, in a language they could not read to get there.
    // data-no-i18n: these are the names of the languages themselves, each
    // written in its own language. Translating them would make the picker
    // unreadable for the exact person who needs it — someone who cannot read
    // the language the app currently happens to be in.
    const active = getLocale();
    const chips = SUPPORTED.map((l) =>
      `<button type="button" class="bv-lang ${l.code === active ? 'sel' : ''}" data-lang="${l.code}"
        lang="${l.code}" aria-pressed="${l.code === active}" data-no-i18n>${l.native}</button>`).join('');
    return `${heroHTML('box', 4)}
      <h3 id="bv-setup-title">Welcome to BricksVault</h3>
      <p class="sub">Let's make it yours — a few quick choices so the app feels right from the first tap.</p>
      <div class="bv-note">${escapeHtml(t('setup.privacy'))}</div>
      <div class="bv-field">
        <div class="bv-field-lbl">Language</div>
        <div class="bv-langs" id="suLangs" role="group" aria-label="Language">${chips}</div>
      </div>`;
  }
  if (key === 'mode') {
    const m = getModePref();
    const investorDescription = 'Full investor view — market value, ROI and 2-year projections.';
    // Kids Mode needs a signed-in account: the parent PIN that locks it is
    // stored server-side, and a guest who entered Kids would have no PIN and
    // no account to manage it from.
    const kidsLocked = isGuestMode();
    const opt = (id, emoji, title, desc, locked = false) =>
      `<button class="bv-opt ${m === id ? 'sel' : ''}${locked ? ' bv-opt-locked' : ''}" data-mode="${id}" ${locked ? 'data-locked="1" style="opacity:.55;"' : ''}><div class="bv-opt-emoji">${emoji}</div><div class="bv-opt-txt"><b>${title}</b><span>${desc}</span></div></button>`;
    return `<h3 id="bv-setup-title">How will you use it?</h3>
      <p class="sub">You can change this anytime in Settings.</p>
      <div class="bv-opts">
        ${opt('pro', '📈', escapeHtml(t('setup.investor')), investorDescription)}
        ${opt('simple', '✨', 'Simple', escapeHtml(t('setup.simpleDescription')))}
        ${opt('kids', '🧒', 'Kids', kidsLocked ? 'Sign in first — a parent PIN keeps kids from exiting.' : 'Playful, price-free mode with XP and badges.', kidsLocked)}
      </div>`;
  }
  if (key === 'appearance') {
    const t = getThemePref(), kids = getModePref() === 'kids';
    const seg = [['light', 'Light'], ['auto', 'Auto'], ['dark', 'Dark']]
      .map(([v, l]) => `<button class="${t === v ? 'sel' : ''}" data-theme="${v}">${l}</button>`).join('');
    const sk = getSkinPref();
    const skins = SETUP_SKINS.map(s =>
      `<button class="bv-skin ${sk === s.id ? 'sel' : ''}" data-skin="${s.id}"><i style="${s.css}"></i><span>${s.label}</span></button>`).join('');
    return `<h3 id="bv-setup-title">Pick your look</h3>
      <p class="sub">Preview updates instantly.</p>
      <div class="bv-preview"><div class="bv-preview-card"><div class="bv-preview-brick"></div><div class="bv-preview-txt"><b>Cloud City</b><span>10123 · Star Wars</span></div><div class="bv-preview-val">$8,716</div></div></div>
      <div class="bv-field"><div class="bv-field-lbl">Theme</div><div class="bv-seg" id="suTheme">${seg}</div></div>
      ${kids
        ? `<div class="bv-note">🧒 Kids mode uses its own bright, playful colors — you can switch modes in Settings to choose a different look.</div>`
        : `<div class="bv-field"><div class="bv-field-lbl">Color style</div><div class="bv-skins" id="suSkins">${skins}</div></div>`}`;
  }
  if (key === 'extras') {
    const cur = (state.me && state.me.currency) || localStorage.getItem('bv_currency') || 'USD';
    const opts = SETUP_CURRENCIES.map(c => `<option value="${c}" ${c === cur ? 'selected' : ''}>${c}</option>`).join('');
    return `<h3 id="bv-setup-title">A few extras</h3>
      <p class="sub">Optional — tweak later in Settings.</p>
      <div class="bv-row first">
        <div class="bv-row-lbl"><b>Currency</b><span>Show values in your local currency.</span></div>
        <select class="bv-sel" id="suCurrency">${opts}</select>
      </div>
      <div class="bv-row">
        <div class="bv-row-lbl"><b>Celebration sounds</b><span>A chime on milestones and rewards.</span></div>
        <button class="bv-tgl ${soundEnabled() ? 'on' : ''}" id="suSound" role="switch" aria-label="Celebration sounds" aria-checked="${soundEnabled()}"></button>
      </div>
      <div class="bv-row">
        <div class="bv-row-lbl"><b>AI assistant</b><span>Floating button for price help.</span></div>
        <button class="bv-tgl ${advisorEnabled() ? 'on' : ''}" id="suAdvisor" role="switch" aria-label="AI assistant" aria-checked="${advisorEnabled()}"></button>
      </div>`;
  }
  if (key === 'support') {
    return `${heroHTML('sparkles', 45)}
      <h3 id="bv-setup-title">BricksVault Pro ⭐</h3>
      <p class="sub">Tracking your vault is free, forever. Pro unlocks the investor toolkit — and keeps BricksVault independent and ad-free.</p>
      <ul class="bv-perks">
        <li>Investor insights: sell/buy signals, top movers, retirement radar</li>
        <li>Full 1-year portfolio history &amp; ROI export</li>
        <li>Premium &amp; Gold ★ skins + ⭐ profile badge</li>
        <li>5× scan and revaluation limits</li>
        <li>Shelf scans: a whole shelf from one photo</li>
      </ul>
      <div class="bv-note">No pressure — everything you need stays free. You can go Pro anytime from Settings.</div>`;
  }
  // done
  return `${heroHTML('sparkles', 36)}
    <h3 id="bv-setup-title">Your vault is ready</h3>
    <p class="sub">Your app is ready. Add your first set to see it valued — or explore around.</p>
    <div class="bv-note">${escapeHtml(t('setup.privacy'))}</div>`;
}

function stepFootHTML(key) {
  const dots = SETUP_STEPS.map((_, i) => `<i class="${i === suIdx ? 'on' : ''}"></i>`).join('');
  const last = key === 'done';
  let nav;
  if (last) {
    nav = `<div class="bv-setup-nav">
        <button class="bv-setup-btn" data-act="explore">Explore</button>
        <button class="bv-setup-btn primary" data-act="add">Add my first set</button>
      </div>
      <button class="bv-setup-ghost" data-act="tour">Take the guided tour</button>`;
  } else {
    nav = `<div class="bv-setup-nav">
        ${suIdx > 0 ? '<button class="bv-setup-btn" data-act="back">Back</button>' : ''}
        <button class="bv-setup-btn primary" data-act="next">${key === 'welcome' ? escapeHtml(t('setup.letsGo')) : 'Continue'}</button>
      </div>
      ${key === 'support' ? `${isNativeBilling() ? '<button class="bv-setup-ghost" data-act="support">See Pro options →</button>' : ''}<p class="bv-setup-note" data-su-note role="status" aria-live="polite"></p>` : ''}`;
  }
  return `<div class="bv-setup-dots" role="progressbar" aria-label="Setup progress" aria-valuemin="1" aria-valuemax="${SETUP_STEPS.length}" aria-valuenow="${suIdx + 1}">${dots}</div>${nav}`;
}

function suApplyCurrency(val) {
  try {
    localStorage.setItem('bv_currency', val);
    api('/api/me', { method: 'PATCH', body: { currency: val } }).catch(() => {});
    if (state.me) state.me.currency = val;
    bvIDB.del('portfolio').catch(() => {});
    invalidatePortfolio();
    state.portfolioHistory = null;
  } catch {}
}

function suWireStep(key) {
  const body = suRoot.querySelector('.bv-setup-body');
  if (key === 'welcome') {
    body.querySelectorAll('#suLangs .bv-lang').forEach(b => b.addEventListener('click', async () => {
      haptic('light');
      // remember:true — tapping a flag IS an explicit choice, and it has to
      // survive the device staying on its own language.
      await setLocale(b.dataset.lang);
      // onLocaleChange already schedules this, but it is async and suRender()
      // would otherwise repaint the wizard before the dictionary is loaded.
      // Wait for the new dictionary before replacing the body. Otherwise the
      // old locale can translate the freshly-rendered English nodes first,
      // leaving no English key for the new locale to match.
      await applyUiDictionary().catch(() => {});
      suRender({ focusLanguage: b.dataset.lang });
      // The setup body was just replaced, after the app-wide locale listener
      // had its chance to paint. Translate this fresh subtree synchronously so
      // its group label and controls never flash English.
      translateDOM(suRoot);
    }));
  } else if (key === 'mode') {
    body.querySelectorAll('.bv-opt').forEach(b => b.addEventListener('click', () => {
      haptic('light');
      if (b.dataset.locked) {
        toast('Sign in to use Kids Mode — the parent PIN needs an account.', 'info');
        return;
      }
      const mode = b.dataset.mode;
      setModePref(mode);
      // Leaving Kids mode? Its forced 'kids' skin would linger — reset to default.
      if (mode !== 'kids' && getSkinPref() === 'kids') setSkinPref('retro');
      body.querySelectorAll('.bv-opt').forEach(x => x.classList.toggle('sel', x === b));
    }));
  } else if (key === 'appearance') {
    body.querySelectorAll('#suTheme button').forEach(b => b.addEventListener('click', () => {
      haptic('light');
      setThemePref(b.dataset.theme);
      body.querySelectorAll('#suTheme button').forEach(x => x.classList.toggle('sel', x === b));
    }));
    body.querySelectorAll('#suSkins .bv-skin').forEach(b => b.addEventListener('click', () => {
      haptic('light');
      setSkinPref(b.dataset.skin);
      body.querySelectorAll('#suSkins .bv-skin').forEach(x => x.classList.toggle('sel', x === b));
    }));
  } else if (key === 'extras') {
    body.querySelector('#suCurrency')?.addEventListener('change', e => { haptic('light'); suApplyCurrency(e.target.value); });
    body.querySelector('#suSound')?.addEventListener('click', e => {
      const on = localStorage.getItem('bv_sound') === 'off';
      localStorage.setItem('bv_sound', on ? 'on' : 'off');
      e.currentTarget.classList.toggle('on', on);
      e.currentTarget.setAttribute('aria-checked', String(on));
      haptic('medium');
      if (on) celebrateChime();
    });
    body.querySelector('#suAdvisor')?.addEventListener('click', e => {
      const on = localStorage.getItem('bv_advisor') === 'off';
      localStorage.setItem('bv_advisor', on ? 'on' : 'off');
      e.currentTarget.classList.toggle('on', on);
      e.currentTarget.setAttribute('aria-checked', String(on));
      haptic('medium');
    });
  }
}

function suNote(message) {
  const note = suRoot?.querySelector('[data-su-note]');
  if (note) note.textContent = message || '';
}

function suRender({ focusLanguage = null, focusStep = false } = {}) {
  if (!suRoot) return;
  const key = SETUP_STEPS[suIdx];
  suRoot.querySelector('.bv-setup-body').innerHTML = stepBodyHTML(key);
  suRoot.querySelector('.bv-setup-foot').innerHTML = stepFootHTML(key);
  suRoot.querySelector('.bv-setup-skip').style.visibility = key === 'done' ? 'hidden' : 'visible';
  suWireStep(key);
  suRoot.querySelector('.bv-setup-body').scrollTop = 0;
  if (focusLanguage) {
    suRoot.querySelector(`#suLangs .bv-lang[data-lang="${focusLanguage}"]`)
      ?.focus({ preventScroll: true });
  } else if (focusStep) {
    const title = suRoot.querySelector('#bv-setup-title');
    title?.setAttribute('tabindex', '-1');
    title?.focus({ preventScroll: true });
  }
}

function suGo(delta) {
  suIdx = Math.max(0, Math.min(SETUP_STEPS.length - 1, suIdx + delta));
  suRender({ focusStep: true });
}

function suFinish(dest) {
  try { localStorage.setItem(SETUP_FLAG, '1'); } catch {}
  document.removeEventListener('keydown', suKey);
  suTrap?.(); suTrap = null;
  suRoot?.remove(); suRoot = null;
  suUnlockPage();
  // Re-render so mode/currency changes take effect on the live view underneath.
  try {
    if (dest === 'tour') route();
    else if (dest === 'add') location.hash = '#/add';
    else if (getModePref() === 'kids') {
      location.hash = '#/kids';
      // No parent PIN yet → offer setup right away (signed-in only; the wizard
      // gates Kids for guests). Dismissing is safe: until a PIN exists, exiting
      // Kids Mode is free, so this sheet is a lock offer — not a lock-in.
      if (state.me && !state.me.has_kids_pin) {
        import('./kids-pin.js')
          .then(({ showKidsPinSetup }) => showKidsPinSetup({ onSuccess: () => { state.me = null; } }))
          .catch(() => {});
      }
    }
    else route();
  } catch {}
  if (dest === 'tour') { try { startOnboarding(); } catch {} }
}

function suKey(e) {
  if (e.key === 'Escape') suFinish(null);
  else if (e.key === 'ArrowRight') suGo(1);
  else if (e.key === 'ArrowLeft') suGo(-1);
}

export function showSetup() {
  try {
    if (suRoot) return;
    ensureSetupStyles();
    suIdx = 0;
    suRoot = document.createElement('div');
    suRoot.className = 'bv-setup';
    suRoot.setAttribute('role', 'dialog');
    suRoot.setAttribute('aria-modal', 'true');
    suRoot.setAttribute('aria-labelledby', 'bv-setup-title');
    suRoot.innerHTML = `
      <div class="bv-setup-top"><button class="bv-setup-skip" data-act="skip">Skip</button></div>
      <div class="bv-setup-body"></div>
      <div class="bv-setup-foot"></div>`;
    suLockPage();
    suRoot.addEventListener('click', (e) => {
      const act = e.target?.closest('[data-act]')?.dataset?.act;
      if (!act) return;
      haptic('light');
      if (act === 'skip') suFinish(null);
      else if (act === 'back') suGo(-1);
      else if (act === 'next') suGo(1);
      else if (act === 'add') suFinish('add');
      else if (act === 'explore') suFinish(null);
      else if (act === 'support') {
        // Keep onboarding open and incomplete while the native store paywall is
        // presented. The old flow removed the wizard, marked it complete and
        // routed away before the user could see plans or finish setup.
        //
        // Feedback MUST render inside the wizard: #toast sits at z-index 120 and
        // this overlay at 10000, so a toast fired here is painted BEHIND an
        // opaque full-screen panel — the user sees the button do nothing, then
        // gets an out-of-context error the moment onboarding closes.
        const button = e.target.closest('[data-act="support"]');
        if (!isNativeBilling()) {
          suNote('Pro options are available from Settings once setup is done.');
          return;
        }
        if (!proPurchaseReady()) {
          suNote('The store is not ready. You can continue setup and try again from Settings.');
          return;
        }
        if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
        suNote('');
        presentProPaywall().then((result) => {
          if (result?.active) {
            state.me = null;
            suNote('Pro unlocked — thank you! ⭐');
          } else if (!result?.ok && result?.reason !== 'cancelled') {
            suNote("The store didn't open. You can continue setup and try again from Settings.");
          }
        }).finally(() => {
          if (button?.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); }
        });
      }
      else if (act === 'tour') suFinish('tour');
    });
    document.body.appendChild(suRoot);
    document.addEventListener('keydown', suKey);
    suTrap = activateFocusTrap(suRoot);
    suRender();
    suRoot.querySelector('.bv-setup-foot .primary')?.focus();
  } catch {
    suRoot?.remove();
    suRoot = null;
    suUnlockPage();
  }
}

// First-run trigger. The 2026 redesign replaces the overlay wizard with the
// Welcome flow (#/welcome → fill → import → ready); showSetup() stays for the
// admin "replay setup" tool. Defensive: only when not yet done, only from the
// Vault (never over the login screen or a deep link), never throws into boot.
export function maybeShowWelcome() {
  try {
    if (localStorage.getItem(SETUP_FLAG)) return;
    if (!isLaunchSurface()) return;
    const nav = document.getElementById('nav');
    if (!nav || getComputedStyle(nav).display === 'none') return;
    location.hash = '#/welcome';
  } catch {}
}
