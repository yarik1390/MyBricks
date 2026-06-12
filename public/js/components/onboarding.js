// Lightweight, dependency-free first-run coach-mark tour. Spotlights the main
// nav targets with a tooltip card. Shows once (localStorage flag); replayable
// from the You tab via startOnboarding(). Fully self-contained — if anything
// throws it never breaks app boot (maybeStartOnboarding swallows errors).
import { haptic } from '../utils.js';

const FLAG = 'bv_onboarded_v1';

const STEPS = [
  { target: null, title: 'Welcome to MyBricks', body: 'Track your LEGO collection’s value, ROI, and price forecasts in real time. Here’s a 30-second tour.' },
  { target: '#nav .nav-tab[data-route="/"]', title: 'Your Vault', body: 'Everything you own — live values, ROI, and trend sparklines. Your portfolio at a glance.' },
  { target: '#nav .nav-tab[data-route="/add"]', title: 'Catalog', body: 'Search ~20,000 sets, filter by theme, year, or value, and add them to your vault or wishlist.' },
  { target: '#nav .scan-tab', title: 'Scan', body: 'Snap a box barcode or a photo and AI identifies the set — then add it in one tap.' },
  { target: '#nav .nav-tab[data-route="/minifigs"]', title: 'Minifigs', body: 'Track your minifigure collection and blind-bag finds separately from sets.' },
  { target: '#nav .nav-tab[data-route="/me"]', title: 'You', body: 'Profile, currency, your public Trophy Shelf, CSV / Google Sheets sync, and AI settings live here.' },
  { target: '#advisorFab', title: 'AI Advisor', body: 'Ask what to buy or sell, why a set is worth what it is, or anything about your portfolio.' },
  { target: null, title: 'You’re all set!', body: 'Add your first set from the Catalog or Scan tab. You can replay this tour anytime from the You tab.' },
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
