// Lightweight, dependency-free first-run coach-mark tour. Spotlights the main
// nav targets with a tooltip card. Shows once (localStorage flag); replayable
// from the You tab via startOnboarding(). Fully self-contained — if anything
// throws it never breaks app boot (maybeStartOnboarding swallows errors).
import { haptic, activateFocusTrap, soundEnabled, advisorEnabled, celebrateChime, bvIDB } from '../utils.js';
import { I } from '../icons.js';
import { getThemePref, setThemePref, getSkinPref, setSkinPref, getModePref, setModePref } from '../theme.js';
import { api } from '../api.js';
import { state, invalidatePortfolio } from '../state.js';
import { route } from '../router.js';

const FLAG = 'bv_onboarded_v1';

const STEPS = [
  { target: null, title: 'Welcome to BricksVault', body: 'Swipe through to see where everything lives.' },
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
let _tourTrapRelease = null;

function isLaunchSurface() {
  const hashPath = (location.hash || '#/').replace(/^#/, '').split('?')[0] || '/';
  return hashPath === '/';
}

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
  if (_tourTrapRelease) { _tourTrapRelease(); _tourTrapRelease = null; }
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
    // Modal-dialog semantics + Tab focus trap (keyboard users can't tab into the
    // dimmed page behind the tour); Escape still closes via onKey. Mirrors the
    // welcome carousel. release() (in finish) restores focus to the invoker.
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Product tour');
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
    _tourTrapRelease = activateFocusTrap(root);
    onResize = () => render();
    window.addEventListener('resize', onResize);
    // Wait a frame so freshly-rendered nav targets have measurable rects, then
    // move focus into the tour card so keyboard users start inside the dialog.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      render();
      root?.querySelector('.bv-tour-card button, .bv-tour-card [tabindex]')?.focus();
    }));
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
const SETUP_SKINS = [
  { id: 'retro',   label: 'Retro',   grad: 'linear-gradient(135deg,#F5F1E8 50%,#DA291C 50%)' },
  { id: 'modular', label: 'Modular', grad: 'linear-gradient(135deg,#FBF8F1 50%,#2E7D32 50%)' },
  { id: 'vivid',   label: 'Vivid',   grad: 'linear-gradient(135deg,#15141C 50%,#7C3AED 50%)' },
];
const SETUP_CURRENCIES = ['USD', 'GBP', 'EUR', 'CAD', 'AUD'];

let suRoot = null, suTrap = null, suIdx = 0;

function ensureSetupStyles() {
  if (document.getElementById('bv-setup-style')) return;
  const css = `
    .bv-setup{position:fixed;inset:0;z-index:10000;background:var(--surface,#fff);color:var(--ink,#16181d);display:flex;flex-direction:column;animation:bvsufade .3s ease;}
    @keyframes bvsufade{from{opacity:0}to{opacity:1}}
    .bv-setup-top{display:flex;justify-content:flex-end;padding:12px 16px 0;min-height:20px;}
    .bv-setup-skip{background:none;border:none;color:var(--ink-mute,#8b91a0);font-size:14px;font-weight:600;cursor:pointer;padding:6px 8px;}
    .bv-setup-body{flex:1;overflow-y:auto;padding:6px 24px 12px;}
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
    .bv-skins{display:flex;gap:12px;}
    .bv-skin{cursor:pointer;background:none;border:none;padding:0;}
    .bv-skin i{display:block;width:60px;height:46px;border-radius:12px;border:2px solid var(--line,#e5e7eb);margin-bottom:5px;}
    .bv-skin.sel i{border-color:var(--accent,#e23b3b);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent,#e23b3b) 30%,transparent);}
    .bv-skin span{font-size:11.5px;color:var(--ink-soft);font-weight:600;}
    .bv-note{font-size:12.5px;color:var(--ink-soft);line-height:1.45;background:var(--surface-2,#f6f7f9);border-radius:12px;padding:11px 13px;}
    .bv-preview{margin:0 0 20px;}
    .bv-preview-card{display:flex;align-items:center;gap:12px;padding:12px 14px;border:2px solid var(--line,#e5e7eb);border-radius:14px;background:var(--surface-2,#f6f7f9);box-shadow:3px 3px 0 var(--line-soft,#e5e7eb);}
    .bv-preview-brick{width:38px;height:38px;border-radius:8px;background:var(--accent,#e23b3b);border:2px solid var(--line,#e5e7eb);flex-shrink:0;}
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
    .bv-sel{font-family:var(--mono,monospace);font-weight:700;font-size:14px;border:2px solid var(--line);border-radius:10px;padding:8px 10px;background:var(--surface-2);color:inherit;cursor:pointer;}
    .bv-tgl{width:48px;height:28px;border-radius:999px;border:2px solid var(--line);background:var(--surface-2);position:relative;cursor:pointer;flex-shrink:0;transition:background .2s,border-color .2s;}
    .bv-tgl::after{content:"";position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:var(--ink-mute);transition:transform .2s,background .2s;}
    .bv-tgl.on{background:var(--accent);border-color:var(--accent);}
    .bv-tgl.on::after{transform:translateX(20px);background:#fff;}
    .bv-setup-foot{padding:14px 24px calc(18px + env(safe-area-inset-bottom,0));display:flex;flex-direction:column;gap:14px;border-top:1px solid var(--line-soft,#eee);}
    .bv-setup-dots{display:flex;gap:7px;justify-content:center;}
    .bv-setup-dots i{width:7px;height:7px;border-radius:50%;background:var(--line,#d6d9e0);transition:all .25s;}
    .bv-setup-dots i.on{background:var(--accent,#e23b3b);width:22px;border-radius:4px;}
    .bv-setup-nav{display:flex;gap:10px;}
    .bv-setup-btn{flex:1;border:2px solid var(--line);border-radius:14px;padding:14px;font-size:15px;font-weight:700;cursor:pointer;background:var(--surface-2);color:inherit;}
    .bv-setup-btn.primary{flex:2;background:var(--accent,#e23b3b);border-color:var(--accent,#e23b3b);color:#fff;}
    .bv-setup-ghost{background:none;border:none;color:var(--ink-mute);font-size:13.5px;font-weight:600;cursor:pointer;padding:2px;}
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
    return `${heroHTML('box', 4)}
      <h3>Welcome to BricksVault</h3>
      <p class="sub">Let's make it yours — a few quick choices so the app feels right from the first tap.</p>`;
  }
  if (key === 'mode') {
    const m = getModePref();
    const opt = (id, emoji, title, desc) =>
      `<button class="bv-opt ${m === id ? 'sel' : ''}" data-mode="${id}"><div class="bv-opt-emoji">${emoji}</div><div class="bv-opt-txt"><b>${title}</b><span>${desc}</span></div></button>`;
    return `<h3>How will you use it?</h3>
      <p class="sub">You can change this anytime in Settings.</p>
      <div class="bv-opts">
        ${opt('pro', '📈', 'Pro', 'Full investor view — market value, ROI and 2- & 5-year forecasts.')}
        ${opt('simple', '✨', 'Simple', 'Just your sets and what they\'re worth. No jargon.')}
        ${opt('kids', '🧒', 'Kids', 'Playful, price-free mode with XP and badges. Add a parent PIN later.')}
      </div>`;
  }
  if (key === 'appearance') {
    const t = getThemePref(), kids = getModePref() === 'kids';
    const seg = [['light', 'Light'], ['auto', 'Auto'], ['dark', 'Dark']]
      .map(([v, l]) => `<button class="${t === v ? 'sel' : ''}" data-theme="${v}">${l}</button>`).join('');
    const sk = getSkinPref();
    const skins = SETUP_SKINS.map(s =>
      `<button class="bv-skin ${sk === s.id ? 'sel' : ''}" data-skin="${s.id}"><i style="background:${s.grad};"></i><span>${s.label}</span></button>`).join('');
    return `<h3>Pick your look</h3>
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
    return `<h3>A few extras</h3>
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
      <h3>BricksVault Pro ⭐</h3>
      <p class="sub">BricksVault is independent and ad-free. Going Pro keeps it alive — and unlocks a few extras.</p>
      <ul class="bv-perks">
        <li>Premium &amp; Gold ★ color skins</li>
        <li>Higher AI advisor limits</li>
        <li>⭐ badge on your public profile</li>
      </ul>
      <div class="bv-note">No pressure — everything you need stays free. You can go Pro anytime from Settings.</div>`;
  }
  // done
  return `${heroHTML('sparkles', 36)}
    <h3>You're all set!</h3>
    <p class="sub">Your app is ready. Add your first set to see it valued — or explore around.</p>`;
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
        <button class="bv-setup-btn primary" data-act="next">${key === 'welcome' ? "Let's go" : 'Continue'}</button>
      </div>
      ${key === 'support' ? '<button class="bv-setup-ghost" data-act="support">See Pro options →</button>' : ''}`;
  }
  return `<div class="bv-setup-dots">${dots}</div>${nav}`;
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
  if (key === 'mode') {
    body.querySelectorAll('.bv-opt').forEach(b => b.addEventListener('click', () => {
      haptic('light');
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

function suRender() {
  if (!suRoot) return;
  const key = SETUP_STEPS[suIdx];
  suRoot.querySelector('.bv-setup-body').innerHTML = stepBodyHTML(key);
  suRoot.querySelector('.bv-setup-foot').innerHTML = stepFootHTML(key);
  suRoot.querySelector('.bv-setup-skip').style.visibility = key === 'done' ? 'hidden' : 'visible';
  suWireStep(key);
  suRoot.querySelector('.bv-setup-body').scrollTop = 0;
}

function suGo(delta) {
  suIdx = Math.max(0, Math.min(SETUP_STEPS.length - 1, suIdx + delta));
  suRender();
}

function suFinish(dest) {
  try { localStorage.setItem(SETUP_FLAG, '1'); } catch {}
  document.removeEventListener('keydown', suKey);
  suTrap?.(); suTrap = null;
  suRoot?.remove(); suRoot = null;
  // Re-render so mode/currency changes take effect on the live view underneath.
  try {
    if (dest === 'tour') route();
    else if (dest === 'support') location.hash = '#/me';
    else if (dest === 'add') location.hash = '#/add';
    else if (getModePref() === 'kids') location.hash = '#/kids';
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
    suRoot.setAttribute('aria-label', 'Set up BricksVault');
    suRoot.innerHTML = `
      <div class="bv-setup-top"><button class="bv-setup-skip" data-act="skip">Skip</button></div>
      <div class="bv-setup-body"></div>
      <div class="bv-setup-foot"></div>`;
    suRoot.addEventListener('click', (e) => {
      const act = e.target?.closest('[data-act]')?.dataset?.act;
      if (!act) return;
      haptic('light');
      if (act === 'skip') suFinish(null);
      else if (act === 'back') suGo(-1);
      else if (act === 'next') suGo(1);
      else if (act === 'add') suFinish('add');
      else if (act === 'explore') suFinish(null);
      else if (act === 'support') suFinish('support');
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
  }
}

// First-run trigger for the setup wizard. Defensive: only when not yet seen, the
// main nav is visible (i.e. not the login screen), and never throws into boot.
export function maybeShowWelcome() {
  try {
    if (localStorage.getItem(SETUP_FLAG)) return;
    if (!isLaunchSurface()) return;
    const nav = document.getElementById('nav');
    if (!nav || getComputedStyle(nav).display === 'none') return;
    showSetup();
  } catch {}
}
