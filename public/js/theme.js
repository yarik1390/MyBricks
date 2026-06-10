// Centralized theme + skin management.
// Two orthogonal axes on <html>:
//   data-theme="light|dark"   — color scheme, pref "light|dark|auto" in localStorage bv_theme
//   data-skin="retro|premium" — visual skin, pref in localStorage bv_skin (default retro)
// theme-init.js applies both pre-paint; this module owns runtime changes.

const META_THEME_COLORS = {
  retro:   { light: "#F5F1E8", dark: "#16161C" },
  premium: { light: "#FAFAF7", dark: "#0E1014" },
};

export function getThemePref() {
  try { return localStorage.getItem("bv_theme") || "auto"; } catch { return "auto"; }
}

export function resolveTheme(pref) {
  if (pref === "light" || pref === "dark") return pref;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getSkinPref() {
  try { return localStorage.getItem("bv_skin") === "premium" ? "premium" : "retro"; } catch { return "retro"; }
}

function updateMetaThemeColor() {
  const scheme = resolveTheme(getThemePref());
  const skin = getSkinPref();
  const color = (META_THEME_COLORS[skin] || META_THEME_COLORS.retro)[scheme];
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute("content", color));
}

export function applyTheme(pref) {
  document.documentElement.dataset.theme = resolveTheme(pref);
  updateMetaThemeColor();
}

export function setThemePref(pref) {
  try { localStorage.setItem("bv_theme", pref); } catch {}
  applyTheme(pref);
}

export function applySkin(skin) {
  if (skin === "premium") document.documentElement.dataset.skin = "premium";
  else delete document.documentElement.dataset.skin;
  updateMetaThemeColor();
}

export function setSkinPref(skin) {
  try { localStorage.setItem("bv_skin", skin === "premium" ? "premium" : "retro"); } catch {}
  applySkin(skin);
}
