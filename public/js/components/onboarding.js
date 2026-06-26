// Lightweight, dependency-free first-run coach-mark tour. Spotlights the main
// nav targets with a tooltip card. Shows once (localStorage flag); replayable
// from the You tab via startOnboarding(). Fully self-contained — if anything
// throws it never breaks app boot (maybeStartOnboarding swallows errors).
import { haptic, activateFocusTrap } from '../utils.js';
import { I } from '../icons.js';

const FLAG = 'bv_onboarded_v1';

const STEPS = [
  { target: null, title: 'Welcome to Brickvault', body: 'Swipe through to see where everything lives.' },
  { target: '#nav .nav-tab[data-route="/"]', title: 'Your Vault', body: 'Tap any set to see its full value history.' },
  { target: '#nav .nav-tab[data-route="/add"]', title: 'Catalog', body: 'Search 27,000+ sets and add them to your vault.' },
  { target: '#nav .scan-tab', title: 'Scan', body: 'Point it at a box barcode — instant match.' },
  { target: '#nav .nav-tab[data-route="/minifigs"]', title: 'Minifigs', body: 'Track minifigs separately from your sets.' },
  { target: '#nav .nav-tab[data-route="/me"]', title: 'You', body: 'Set your currency, sync, and AI options here.' },
  { target: '#advisorFab', title: 'AI Advisor', body: 'Ask what to buy, sell, or hold — anytime.' },
  { target: null, title: 'You’re all set!', body: 'Add your first set from Catalog or Scan.' },
];

let idx = 0;
let root = null;
let onResize = null;

function ensureStyles() {
  if (document.getElementById('bv-tour-style')) return;
  const css = `
    .bv-tour{position:fixed;inset:0;z-index:9999;}
    .bv-tour-spot{position:fixed;border-radius:14px;box-shadow:0 0 0 9999px rgba(8,10,14,.72);transition:all .25s cubic-bezier(.4,0,.2,1);pointer-events:none;}
    .bv-tour-spot.ring{outline:2px solid var(--accent,#e23b3b);outline-offset:3px;}
    .bv-tour-card{position:fixed;left:50%;transform:translateX(-50%);width:min(340px,90vw);background:var(--surface,#fff);color:var(--ink,#16181d);border:1px solid var(--line,#e5e7eb);border-radius:16px;padding:16px 18px;box-shadow:0 12px 40px rgba(0,0,0,.28);}
    .bv-tour-card h4{margin:0 0 6px;font-family:var(--font-heading,inherit);font-size:17px;font-weight:700;}
    .bv-tour-card p{margin:0 0 14px;font-size:13.5px;line-height:1.5;color:var(--ink-soft,#3f4654);}
    .bv-tour-dots{display:flex;gap:5px;margin-bottom:12px;}
    .bv-tour-dots i{width:6px;height:6px;border-radius:50%;background:var(--line,#d6d9e0);transition:background .2s;}
    .bv-tour-dots i.on{background:var(--accent,#e23b3b);}
    .bv-tour-row{display:flex;align-items:center;justify-content:space-between;gap:10px;}
    .bv-tour-skip{background:none;border:none;color:var(--ink-mute,#8b91a0);font-size:13px;cursor:pointer;padding:6px 2px;}
    .bv-tour-nav{display:flex;gap:8px;}
    .bv-tour-btn{border:1px solid var(--line,#e5e7eb);background:var(--surface-2,#f6f7f9);color:var(--ink,#16181d);border-radius:10px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;}
    .bv-tour-btn.primary{background:var(--accent,#e23b3b);border-color:var(--accent,#e23b3b);color:#fff;}
  `;
  const el = document.createElement('style');
  el.id = 'bv-tour-style';
  el.textContent = css;
  document.head.appendChild(el);
}

function finish() {
  try { localStorage.setItem(FLAG, '1'); } catch {}
  if (onResize) { window.removeEventListener('resize', onResize); onResize = null; }
  document.removeEventListener('keydown', onKey);
  root?.remove();
  root = null;
}

function onKey(e) { if (e.key === 'Escape') finish(); }

function visible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && el.offsetParent !== null;
}

function render() {
  // Auto-skip steps whose target isn't present/visible (e.g. advisor FAB when
  // logged out). Walk forward; if we run past the end, finish.
  while (idx < STEPS.length && STEPS[idx].target && !visible(document.querySelector(STEPS[idx].target))) {
    idx++;
  }
  if (idx >= STEPS.length) { finish(); return; }

  const step = STEPS[idx];
  const target = step.target ? document.querySelector(step.target) : null;
  const spot = root.querySelector('.bv-tour-spot');
  const card = root.querySelector('.bv-tour-card');

  if (target) {
    const r = target.getBoundingClientRect();
    const pad = 6;
    spot.style.width = `${r.width + pad * 2}px`;
    spot.style.height = `${r.height + pad * 2}px`;
    spot.style.top = `${r.top - pad}px`;
    spot.style.left = `${r.left - pad}px`;
    spot.classList.add('ring');
  } else {
    // Center, zero-size spot => full dim with no visible hole.
    spot.style.width = '0px';
    spot.style.height = '0px';
    spot.style.top = '50%';
    spot.style.left = '50%';
    spot.classList.remove('ring');
  }

  const isLast = idx === STEPS.length - 1;
  const dots = STEPS.map((_, i) => `<i class="${i === idx ? 'on' : ''}"></i>`).join('');
  card.innerHTML = `
    <div class="bv-tour-dots">${dots}</div>
    <h4>${step.title}</h4>
    <p>${step.body}</p>
    <div class="bv-tour-row">
      <button class="bv-tour-skip" data-act="skip">${isLast ? '' : 'Skip'}</button>
      <div class="bv-tour-nav">
        ${idx > 0 ? '<button class="bv-tour-btn" data-act="back">Back</button>' : ''}
        <button class="bv-tour-btn primary" data-act="next">${isLast ? 'Done' : 'Next'}</button>
      </div>
    </div>`;

  // Position the card: above the target when it's in the lower half (the nav is
  // bottom-docked), below when upper, centered when there's no target.
  const vh = window.innerHeight;
  card.style.transform = 'translateX(-50%)';
  if (!target) {
    card.style.top = '50%';
    card.style.transform = 'translate(-50%,-50%)';
  } else {
    const r = target.getBoundingClientRect();
    if (r.top > vh / 2) {
      card.style.top = 'auto';
      card.style.bottom = `${vh - r.top + 14}px`;
    } else {
      card.style.bottom = 'auto';
      card.style.top = `${r.bottom + 14}px`;
    }
  }
}

function go(delta) {
  idx += delta;
  if (idx < 0) idx = 0;
  if (idx >= STEPS.length) { finish(); return; }
  render();
}

export function startOnboarding() {
  try {
    if (root) return;
    ensureStyles();
    idx = 0;
    root = document.createElement('div');
    root.className = 'bv-tour';
    root.innerHTML = `<div class="bv-tour-spot"></div><div class="bv-tour-card"></div>`;
    root.addEventListener('click', (e) => {
      const act = e.target?.dataset?.act;
      if (!act) return;
      haptic('light');
      if (act === 'next') go(1);
      else if (act === 'back') go(-1);
      else if (act === 'skip') finish();
    });
    document.body.appendChild(root);
    document.addEventListener('keydown', onKey);
    onResize = () => render();
    window.addEventListener('resize', onResize);
    // Wait a frame so freshly-rendered nav targets have measurable rects.
    requestAnimationFrame(() => requestAnimationFrame(render));
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
    const nav = document.getElementById('nav');
    if (!nav || getComputedStyle(nav).display === 'none') return;
    startOnboarding();
  } catch {}
}

// ---------------------------------------------------------------------------
// First-run WELCOME CAROUSEL — a full-screen, swipeable brand intro shown once.
// Distinct from the coach-mark tour above (which spotlights the live nav and
// stays replayable from the You tab). Self-contained; never throws into boot.
// ---------------------------------------------------------------------------
const WELCOME_FLAG = 'bv_welcome_v1';

const WELCOME_SLIDES = [
  { icon: 'box',      hue: 4,   title: 'Welcome to Brickvault',  body: 'Your collection, valued like an investment portfolio.' },
  { icon: 'trend',    hue: 152, title: 'Know what it’s worth', body: 'Real market values, ROI, and 2- & 5-year forecasts.' },
  { icon: 'scan',     hue: 212, title: 'Scan to add',          body: 'Point your camera — AI identifies it and adds it in a tap.' },
  { icon: 'advisor',  hue: 276, title: 'Ask the AI advisor',   body: 'Buy, sell, or hold? Get instant, portfolio-aware answers.' },
  { icon: 'sparkles', hue: 36,  title: 'You’re ready',         body: 'Add your first set from Catalog or Scan.' },
];

let wcRoot = null;
let _wcTrapRelease = null;
let wcIdx = 0;

function ensureWelcomeStyles() {
  if (document.getElementById('bv-wc-style')) return;
  const css = `
    .bv-wc{position:fixed;inset:0;z-index:10000;background:var(--surface,#fff);color:var(--ink,#16181d);display:flex;flex-direction:column;animation:bvwcfade .3s ease;}
    @keyframes bvwcfade{from{opacity:0}to{opacity:1}}
    .bv-wc-top{display:flex;justify-content:flex-end;padding:14px 16px;}
    .bv-wc-skip{background:none;border:none;color:var(--ink-mute,#8b91a0);font-size:14px;font-weight:600;cursor:pointer;padding:6px 8px;}
    .bv-wc-view{flex:1;overflow:hidden;}
    .bv-wc-track{display:flex;height:100%;transition:transform .35s cubic-bezier(.4,0,.2,1);}
    .bv-wc-slide{min-width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 32px;box-sizing:border-box;}
    .bv-wc-hero{width:148px;height:148px;border-radius:34px;display:flex;align-items:center;justify-content:center;margin-bottom:34px;color:#fff;box-shadow:0 18px 44px -12px rgba(0,0,0,.35);}
    .bv-wc-hero svg{width:62px;height:62px;}
    .bv-wc-slide h3{margin:0 0 12px;font-family:var(--font-heading,inherit);font-size:25px;font-weight:800;letter-spacing:-.01em;}
    .bv-wc-slide p{margin:0;font-size:15px;line-height:1.55;color:var(--ink-soft,#3f4654);max-width:30ch;}
    .bv-wc-foot{padding:18px 24px calc(24px + env(safe-area-inset-bottom,0));display:flex;flex-direction:column;gap:16px;}
    .bv-wc-dots{display:flex;gap:7px;justify-content:center;}
    .bv-wc-dots i{width:7px;height:7px;border-radius:50%;background:var(--line,#d6d9e0);transition:all .25s;}
    .bv-wc-dots i.on{background:var(--accent,#e23b3b);width:22px;border-radius:4px;}
    .bv-wc-btn{width:100%;border:none;border-radius:14px;padding:15px;font-size:15px;font-weight:700;cursor:pointer;background:var(--accent,#e23b3b);color:#fff;}
    .bv-wc-tour{background:none;border:none;color:var(--ink-mute,#8b91a0);font-size:13.5px;font-weight:600;cursor:pointer;padding:2px;}
  `;
  const el = document.createElement('style');
  el.id = 'bv-wc-style';
  el.textContent = css;
  document.head.appendChild(el);
}

function wcFinish(thenTour) {
  try { localStorage.setItem(WELCOME_FLAG, '1'); } catch {}
  document.removeEventListener('keydown', wcKey);
  _wcTrapRelease?.();
  _wcTrapRelease = null;
  wcRoot?.remove();
  wcRoot = null;
  if (thenTour) { try { startOnboarding(); } catch {} }
}

function wcKey(e) {
  if (e.key === 'Escape') wcFinish(false);
  else if (e.key === 'ArrowRight') wcGo(1);
  else if (e.key === 'ArrowLeft') wcGo(-1);
}

function wcRender() {
  if (!wcRoot) return;
  const track = wcRoot.querySelector('.bv-wc-track');
  track.style.transform = `translateX(-${wcIdx * 100}%)`;
  wcRoot.querySelectorAll('.bv-wc-dots i').forEach((d, i) => d.classList.toggle('on', i === wcIdx));
  const last = wcIdx === WELCOME_SLIDES.length - 1;
  wcRoot.querySelector('.bv-wc-btn').textContent = last ? 'Get started' : 'Next';
  wcRoot.querySelector('.bv-wc-tour').style.display = last ? 'block' : 'none';
  wcRoot.querySelector('.bv-wc-skip').style.visibility = last ? 'hidden' : 'visible';
}

function wcGo(delta) {
  wcIdx = Math.max(0, Math.min(WELCOME_SLIDES.length - 1, wcIdx + delta));
  wcRender();
}

export function showWelcome() {
  try {
    if (wcRoot) return;
    ensureWelcomeStyles();
    wcIdx = 0;
    wcRoot = document.createElement('div');
    wcRoot.className = 'bv-wc';
    wcRoot.setAttribute('role', 'dialog');
    wcRoot.setAttribute('aria-modal', 'true');
    wcRoot.setAttribute('aria-label', 'Welcome to Brickvault');
    const slides = WELCOME_SLIDES.map(s => `
      <div class="bv-wc-slide">
        <div class="bv-wc-hero" style="background:linear-gradient(145deg,oklch(.62 .19 ${s.hue}),oklch(.5 .16 ${(s.hue + 32) % 360}));">${typeof I[s.icon] === 'function' ? I[s.icon]({ w: 62 }) : ''}</div>
        <h3>${s.title}</h3>
        <p>${s.body}</p>
      </div>`).join('');
    const dots = WELCOME_SLIDES.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('');
    wcRoot.innerHTML = `
      <div class="bv-wc-top"><button class="bv-wc-skip" data-act="skip">Skip</button></div>
      <div class="bv-wc-view"><div class="bv-wc-track">${slides}</div></div>
      <div class="bv-wc-foot">
        <div class="bv-wc-dots">${dots}</div>
        <button class="bv-wc-btn" data-act="next">Next</button>
        <button class="bv-wc-tour" data-act="tour" style="display:none;">Take the guided tour</button>
      </div>`;
    wcRoot.addEventListener('click', (e) => {
      const act = e.target?.closest('[data-act]')?.dataset?.act;
      if (!act) return;
      haptic('light');
      if (act === 'skip') wcFinish(false);
      else if (act === 'tour') wcFinish(true);
      else if (act === 'next') {
        if (wcIdx === WELCOME_SLIDES.length - 1) wcFinish(false);
        else wcGo(1);
      }
    });
    // Touch swipe between slides.
    let x0 = null;
    const view = wcRoot.querySelector('.bv-wc-view');
    view.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    view.addEventListener('touchend', (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 45) wcGo(dx < 0 ? 1 : -1);
      x0 = null;
    }, { passive: true });
    document.body.appendChild(wcRoot);
    document.addEventListener('keydown', wcKey);
    _wcTrapRelease = activateFocusTrap(wcRoot);
    wcRoot.querySelector('.bv-wc-btn')?.focus();
    wcRender();
  } catch {
    wcRoot?.remove();
    wcRoot = null;
  }
}

// First-run trigger for the welcome carousel. Defensive: only when not yet seen,
// the main nav is visible (i.e. not the login screen), and never throws.
export function maybeShowWelcome() {
  try {
    if (localStorage.getItem(WELCOME_FLAG)) return;
    const nav = document.getElementById('nav');
    if (!nav || getComputedStyle(nav).display === 'none') return;
    showWelcome();
  } catch {}
}
