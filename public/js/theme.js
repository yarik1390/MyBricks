// Centralized theme + skin management.
// Two orthogonal axes on <html>:
//   data-theme="light|dark"         — color scheme, pref "light|dark|auto" in localStorage bv_theme
//   data-skin="retro|modular|vivid|premium|gold|kids" — visual skin, pref in localStorage bv_skin (default retro)
// theme-init.js applies both pre-paint; this module owns runtime changes.

const SKINS = ['retro', 'modular', 'vivid', 'premium', 'gold', 'kids'];

const META_THEME_COLORS = {
  retro:   { light: '#F5F1E8', dark: '#16161C' },
  modular: { light: '#FBF8F1', dark: '#16151A' },
  vivid:   { light: '#15141C', dark: '#100F16' },
  premium: { light: '#FAFAF7', dark: '#0E1014' },
  gold:    { light: '#FAF6EC', dark: '#14110A' },
  kids:    { light: '#FFF7E6', dark: '#FFF7E6' },
};

export function getThemePref() {
  try { return localStorage.getItem('bv_theme') || 'auto'; } catch { return 'auto'; }
}

export function resolveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getSkinPref() {
  try {
    const s = localStorage.getItem('bv_skin');
    return SKINS.includes(s) ? s : 'retro';
  } catch { return 'retro'; }
}

function updateMetaThemeColor() {
  const scheme = resolveTheme(getThemePref());
  const skin = getSkinPref();
  const color = (META_THEME_COLORS[skin] || META_THEME_COLORS.retro)[scheme];
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', color));
}

export function applyTheme(pref) {
  document.documentElement.dataset.theme = resolveTheme(pref);
  updateMetaThemeColor();
}

export function setThemePref(pref) {
  try { localStorage.setItem('bv_theme', pref); } catch {}
  applyTheme(pref);
}

// Load the given skin's stylesheet into the single #bvSkin <link>. theme-init
// loads only the active skin at boot (avoiding 5 render-blocking sheets), so a
// runtime switch must load the target on demand — served instantly from the SW
// precache. retro/default has no skin file, so the href is cleared.
function loadSkinCss(skin) {
  const sk = document.getElementById('bvSkin');
  if (!sk) return;
  if (skin && skin !== 'retro' && SKINS.includes(skin)) {
    const href = '/skin-' + skin + '.css';
    if (sk.getAttribute('href') !== href) sk.href = href;
  } else {
    sk.removeAttribute('href');
  }
}

export function applySkin(skin) {
  if (SKINS.includes(skin) && skin !== 'retro') document.documentElement.dataset.skin = skin;
  else delete document.documentElement.dataset.skin;
  loadSkinCss(skin);
  updateMetaThemeColor();
}

export function setSkinPref(skin) {
  try { localStorage.setItem('bv_skin', SKINS.includes(skin) ? skin : 'retro'); } catch {}
  applySkin(skin);
}

// Mode — third orthogonal axis (data-mode on <html>).
// 'pro' (default) = full investor view; 'simple' = value + list only; 'kids' = gamified price-free.
export function getModePref() {
  try {
    const m = localStorage.getItem('bv_mode');
    return m === 'simple' ? 'simple' : m === 'kids' ? 'kids' : 'pro';
  } catch { return 'pro'; }
}

export function applyMode(mode) {
  if (mode === 'simple') {
    document.documentElement.dataset.mode = 'simple';
  } else if (mode === 'kids') {
    document.documentElement.dataset.mode = 'kids';
    document.documentElement.dataset.skin = 'kids';
    loadSkinCss('kids');
  } else {
    delete document.documentElement.dataset.mode;
  }
}

export function setModePref(mode) {
  try {
    const m = mode === 'simple' ? 'simple' : mode === 'kids' ? 'kids' : 'pro';
    localStorage.setItem('bv_mode', m);
    if (mode === 'kids') localStorage.setItem('bv_skin', 'kids');
  } catch {}
  applyMode(mode);
}
