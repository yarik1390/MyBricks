import { I } from './icons.js';
import { state } from './state.js';
import morphdom from './lib/morphdom.js';
import { upsertDetailCache } from './lib/pure-core.js';
import { t, getLocale } from './lib/i18n.js';

/* ---------- DOM helpers ---------- */
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ---------- IndexedDB cache ---------- */
export const bvIDB = (() => {
  function open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('brickvault', 1);
      r.onupgradeneeded = e => { if (!e.target.result.objectStoreNames.contains('kv')) e.target.result.createObjectStore('kv'); };
      r.onsuccess = e => res(e.target.result);
      r.onerror = e => rej(e.target.error);
    });
  }
  async function get(k) { const db = await open(); return new Promise((res, rej) => { const r = db.transaction('kv','readonly').objectStore('kv').get(k); r.onsuccess=()=>res(r.result); r.onerror=e=>rej(e.target.error); }); }
  async function set(k, v) { const db = await open(); return new Promise((res, rej) => { const r = db.transaction('kv','readwrite').objectStore('kv').put(v,k); r.onsuccess=()=>res(); r.onerror=e=>rej(e.target.error); }); }
  async function del(k) { const db = await open(); return new Promise((res, rej) => { const r = db.transaction('kv','readwrite').objectStore('kv').delete(k); r.onsuccess=()=>res(); r.onerror=e=>rej(e.target.error); }); }
  return { get, set, del };
})();

/* ---------- Offline set-detail cache ----------
 * Persists the last ~40 viewed set-detail payloads under a single bvIDB key so a
 * previously-opened set still renders offline (instead of "Set not found"). The
 * LRU/eviction/uid-isolation logic is the pure upsertDetailCache() (lib/pure.js);
 * these wrappers only do the IDB read/write. uid is passed in (not imported from
 * api.js) to avoid a utils<->api import cycle. All failures are swallowed —
 * caching is best-effort and must never break a render. */
const DETAIL_CACHE_KEY = 'detail';
export async function cacheSetDetail(setNum, set, entry, uid) {
  if (!setNum || !set) return;
  try {
    const prev = await bvIDB.get(DETAIL_CACHE_KEY);
    const next = upsertDetailCache(prev, { setNum, set, entry: entry ?? null, ts: Date.now(), uid: uid ?? null });
    await bvIDB.set(DETAIL_CACHE_KEY, next);
  } catch {}
}
export async function getCachedSetDetail(setNum, uid) {
  try {
    const store = await bvIDB.get(DETAIL_CACHE_KEY);
    if (!store || store.uid !== (uid ?? null)) return null;
    return store.items?.[setNum] || null;
  } catch { return null; }
}

/* ---------- Formatters ---------- */
export const CURRENCY_SYMBOLS = {
  USD: "$",
  GBP: "£",
  EUR: "€",
  CAD: "CA$",
  AUD: "A$"
};

let exchangeRates = { USD: 1 };
// True when the rates fetch failed and no fresh cache exists — non-USD users
// are then silently seeing USD numbers, so views can surface a small notice.
let _ratesUnavailable = false;
// Share/permalink origin: inside the native app the WebView origin is
// https://localhost (bundled assets) — useless in a shared link. Always build
// outward-facing URLs on the public site origin.
export function publicOrigin() {
  const o = (typeof location !== "undefined" && location.origin) || "";
  return /^https?:\/\/localhost|^capacitor:/.test(o) ? "https://brickvault-5ub.pages.dev" : o;
}

export const ratesUnavailable = () => _ratesUnavailable;

export async function fetchExchangeRates() {
  const cached = localStorage.getItem("bv_exchange_rates");
  if (cached) {
    try {
      const data = JSON.parse(cached);
      if (data && data.timestamp && (Date.now() - data.timestamp < 6 * 60 * 60 * 1000)) {
        exchangeRates = data.rates;
        return;
      }
    } catch {}
  }
  try {
    const res = await fetch((window.WORKER_BASE || '') + "/api/rates");
    const json = await res.json();
    if (json && json.rates) {
      exchangeRates = json.rates;
      _ratesUnavailable = false;
      localStorage.setItem("bv_exchange_rates", JSON.stringify({
        timestamp: Date.now(),
        rates: json.rates
      }));
    }
  } catch (e) {
    // Keep any previously-cached rates (even stale) over a silent 1:1; only
    // flag "unavailable" when we truly have nothing but the USD identity.
    _ratesUnavailable = Object.keys(exchangeRates).length <= 1;
    console.error("Failed to fetch exchange rates, falling back to USD = 1", e);
  }
}

export function getExchangeRate(targetCurrency) {
  return exchangeRates[targetCurrency] || 1;
}

export function fmtMoney(n, opts = {}) {
  if (n == null || isNaN(n)) return "—";
  const userCurrency = state.me?.currency || "USD";
  const rate = getExchangeRate(userCurrency);
  const symbol = CURRENCY_SYMBOLS[userCurrency] || "$";
  const converted = n * rate;
  const sign = converted < 0 ? "-" : "";
  const abs = Math.abs(converted);
  const v = abs.toLocaleString("en-US", { minimumFractionDigits: opts.cents ?? 2, maximumFractionDigits: 2 });
  return sign + symbol + v;
}

export function fmtMoneyShort(n) {
  if (n == null || isNaN(n)) return "—";
  const userCurrency = state.me?.currency || "USD";
  const rate = getExchangeRate(userCurrency);
  const symbol = CURRENCY_SYMBOLS[userCurrency] || "$";
  const converted = n * rate;
  const a = Math.abs(converted); const s = converted < 0 ? "-" : "";
  if (a >= 1e6) return s + symbol + (a / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return s + symbol + (a / 1e3).toFixed(1) + "K";
  return s + symbol + a.toFixed(0);
}

export function fmtPct(n) { return (n >= 0 ? "+" : "") + (n * 100).toFixed(1) + "%"; }
export const daysAgo = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
export const yearsAgo = (iso) => (Date.now() - new Date(iso).getTime()) / (365.25 * 86400000);
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

export function parseMarkdown(text) {
  if (!text) return "";
  let html = escapeHtml(text);
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");
  html = html.replace(/^### (.*?)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.*?)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.*?)$/gm, "<h1>$1</h1>");
  const lines = html.split("\n");
  let inList = false;
  const processed = lines.map(line => {
    const cleanLine = line.trim();
    if (cleanLine.startsWith("- ") || cleanLine.startsWith("* ")) {
      let listContent = cleanLine.slice(2);
      let out = "";
      if (!inList) {
        inList = true;
        out += '<ul style="margin: 4px 0; padding-left: 20px;">';
      }
      out += `<li>${listContent}</li>`;
      return out;
    } else {
      let out = "";
      if (inList) {
        inList = false;
        out += "</ul>";
      }
      out += line;
      return out;
    }
  });
  if (inList) {
    processed.push("</ul>");
  }
  return processed.join("<br>").replace(/<\/ul><br>/g, "</ul>").replace(/<br><ul/g, "<ul");
}

// Fire-and-forget client telemetry - anonymous, allowlisted server-side, and
// sampled here so hot paths (route views) cost a fraction of a request. Never
// throws into the caller; failures are silently dropped.
export function track(event, detail = "", sample = 1) {
  try {
    if (sample < 1 && Math.random() > sample) return;
    fetch((window.WORKER_BASE || "") + "/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ e: event, d: String(detail).slice(0, 120) }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* telemetry must never break the app */ }
}

export function haptic(t) {
  // Native @capacitor/haptics gives crisp, OS-tuned impact feedback on Android
  // (navigator.vibrate is a blunt buzz). Accessed via the global bridge to keep
  // utils dependency-free; falls back to vibrate on the web / when unavailable.
  try {
    const cap = window.Capacitor;
    const Haptics = cap?.isNativePlatform?.() ? cap.Plugins?.Haptics : null;
    if (Haptics?.impact) {
      const style = t === "heavy" ? "HEAVY" : t === "medium" ? "MEDIUM" : "LIGHT";
      Haptics.impact({ style }); // fire-and-forget
      return;
    }
  } catch { /* fall through to vibrate */ }
  const ms = t === "heavy" ? 30 : t === "medium" ? 15 : 8;
  try { navigator.vibrate && navigator.vibrate(ms); } catch {}
}

let toastTimer = null;
const _toastQueue = [];
let _toastShowing = false;
function _renderNextToast() {
  const el = $("#toast");
  if (!el) { _toastQueue.length = 0; _toastShowing = false; return; }
  const next = _toastQueue.shift();
  if (!next) { _toastShowing = false; return; }
  _toastShowing = true;
  const { msg, type } = next;
  el.className = "show " + (type || "info");
  el.innerHTML = `<span class="t-icon">${type === "success" ? I.check() : type === "error" ? I.close() : I.info()}</span><span>${escapeHtml(msg)}</span>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
    setTimeout(_renderNextToast, 180);
  }, 3200);
}
export function toast(msg, type) {
  if (!$("#toast")) return;
  const last = _toastQueue[_toastQueue.length - 1];
  if (last && last.msg === msg && last.type === type) return;
  _toastQueue.push({ msg, type });
  if (!_toastShowing) _renderNextToast();
}

// Post-action Undo toast: shows `msg` with an UNDO button for 5s (longer than
// a normal toast so a mis-tap after a confirm is still recoverable). Takes over
// the shared toast element directly, then hands back to the queue.
export function undoToast(msg, onUndo) {
  const el = $("#toast");
  if (!el) return;
  clearTimeout(toastTimer);
  _toastShowing = true;
  el.className = "show info";
  el.innerHTML = `<span class="t-icon">${I.check()}</span><span></span><button class="toast-undo-btn">Undo</button>`;
  el.children[1].textContent = msg;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.classList.remove("show");
    setTimeout(_renderNextToast, 180);
  };
  el.querySelector(".toast-undo-btn").addEventListener("click", () => {
    const run = !done;
    finish();
    if (run) { try { onUndo(); } catch { /* undo is best-effort */ } }
  });
  toastTimer = setTimeout(finish, 5000);
}

// One debounce interval for every search box — consistent feel across screens.
export const SEARCH_DEBOUNCE_MS = 250;

// Patch container's children to match `html` via morphdom — preserves focus,
// scroll, and unchanged DOM instead of an innerHTML teardown. Subtrees marked
// data-static are left untouched so async-managed nodes (charts/photos) survive.
export function mount(container, html) {
  if (!container) return;
  const tmp = container.cloneNode(false);
  tmp.innerHTML = html;
  morphdom(container, tmp, {
    childrenOnly: true,
    onBeforeElUpdated(fromEl, toEl) {
      if (fromEl.isEqualNode(toEl)) return false;
      if (fromEl.nodeType === 1 && fromEl.hasAttribute('data-static')) return false;
      if (fromEl === document.activeElement && 'value' in fromEl && 'value' in toEl) {
        toEl.value = fromEl.value;
      }
      // Preserve runtime image-loaded state (image hydration adds .photo-loaded on
      // load to reveal the photo over its placeholder); the template lacks it, so
      // without this morphdom would re-hide already-loaded photos on re-render.
      if (fromEl.nodeType === 1 && fromEl.classList.contains('photo-loaded')) toEl.classList.add('photo-loaded');
      return true;
    },
  });
}

// Accessible focus trap for bespoke modals/overlays. Keeps Tab cycling inside
// `container`; calls onEscape (if given) on Escape; returns a release() that
// removes the listener and restores focus to the pre-open element. Mirrors the
// proven pattern in components/sheet.js so all modals behave consistently.
export const FOCUSABLE_SEL = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
export function activateFocusTrap(container, onEscape) {
  const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  function handler(e) {
    if (e.key === "Escape") { if (onEscape) { e.preventDefault(); onEscape(); } return; }
    if (e.key !== "Tab" || !container) return;
    const f = [...container.querySelectorAll(FOCUSABLE_SEL)].filter(el => !el.disabled && el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!container.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener("keydown", handler);
  return function release() {
    document.removeEventListener("keydown", handler);
    if (invoker && document.contains(invoker)) { try { invoker.focus(); } catch {} }
  };
}

export function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function confettiBurst() {
  if (prefersReducedMotion()) return;
  const colors = ["#FFD700", "#DA291C", "#1A7F4B", "#0057b7", "#7c3aed", "#f57c00"];
  const layer = document.createElement("div");
  layer.className = "confetti-layer";
  const N = 20;
  for (let k = 0; k < N; k++) {
    const s = document.createElement("i");
    const left = Math.random() * 100;
    const delay = Math.random() * 0.25;
    const dur = 1.1 + Math.random() * 0.8;
    const rot = (Math.random() * 720 - 360) | 0;
    const drift = (Math.random() * 120 - 60) | 0;
    s.style.cssText = `left:${left}vw;background:${colors[k % colors.length]};` +
      `animation-delay:${delay}s;animation-duration:${dur}s;` +
      `--rot:${rot}deg;--drift:${drift}px;`;
    layer.appendChild(s);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 2400);
}

// LEGO-flavored one-liners shown under a milestone headline. Kept light and a
// little silly — this only fires on genuine wins (first set, $1k, 100 sets…).
const CELEBRATE_QUIPS = [
  "Everything is awesome! 🎶",
  "You're really stuck on this hobby. 🧱",
  "Built different. Literally.",
  "Snapping together nicely!",
  "AFOL status: confirmed.",
  "Your wallet felt that click.",
  "One brick closer to stepping on them all. 🦶",
  "That's a whole lotta studs.",
  "No minifigs were harmed in this milestone.",
  "Certified brick baron. 👑",
];

// Celebration sound preference (device-local, default on).
export function soundEnabled() {
  return localStorage.getItem("bv_sound") !== "off";
}

// AI assistant (advisor FAB) preference — device-local, default on. When off,
// the floating assistant button is hidden on every route.
export function advisorEnabled() {
  return localStorage.getItem("bv_advisor") !== "off";
}

// A short, cheerful synthesized "ta-da" arpeggio (Web Audio — no asset, CSP-safe).
// Gated by the sound pref. The AudioContext is created lazily and resumed, so it
// works after the user gesture that triggered the reward. Silent on any failure.
let _audioCtx = null;
export function celebrateChime() {
  if (!soundEnabled()) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    _audioCtx = _audioCtx || new AC();
    if (_audioCtx.state === "suspended") _audioCtx.resume();
    const ctx = _audioCtx;
    const t0 = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5–E5–G5–C6 major arpeggio
    notes.forEach((f, i) => {
      const t = t0 + i * 0.085;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.16, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.34);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  } catch {}
}

// Centered celebration popup for milestones — a bouncy LEGO-brick card with a
// funny sub-line + confetti + chime. Replaces the old bottom "milestone" toast
// so a big win feels like a moment. Auto-dismisses; tap or Escape to close early.
// opts: { quip?: string, hue?: number } — hue tints the brick to the set's theme.
export function celebrate(msg, opts = {}) {
  const { quip, hue } = typeof opts === "string" ? { quip: opts } : opts;
  confettiBurst();
  haptic("heavy");
  celebrateChime();
  document.querySelector(".celebrate-scrim")?.remove();
  const line = quip || CELEBRATE_QUIPS[Math.floor(Math.random() * CELEBRATE_QUIPS.length)];
  const brickStyle = Number.isFinite(hue) ? ` style="--cb-color:oklch(0.62 0.18 ${hue})"` : "";
  const scrim = document.createElement("div");
  scrim.className = "celebrate-scrim";
  scrim.innerHTML =
    `<div class="celebrate-card" role="alert" aria-live="assertive">` +
      `<div class="celebrate-studs" aria-hidden="true"><i></i><i></i><i></i><i></i></div>` +
      `<div class="celebrate-brick"${brickStyle} aria-hidden="true"><span class="cb-studs"><i></i><i></i></span><span class="cb-body"></span></div>` +
      `<div class="celebrate-title">${escapeHtml(msg)}</div>` +
      `<div class="celebrate-sub">${escapeHtml(line)}</div>` +
    `</div>`;
  document.body.appendChild(scrim);
  requestAnimationFrame(() => scrim.classList.add("show"));
  let done = false;
  const close = () => {
    if (done) return; done = true;
    clearTimeout(timer);
    document.removeEventListener("keydown", onKey);
    scrim.classList.remove("show");
    scrim.classList.add("closing");
    setTimeout(() => scrim.remove(), 320);
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  scrim.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  const timer = setTimeout(close, 3000);
}

// Persisted "last seen" portfolio totals — used to detect when an add crosses a
// milestone threshold upward (prev < threshold <= current). Recorded on every
// authoritative total (vault render + after an add), so deleting sets lowers the
// baseline and re-crossing a threshold celebrates again instead of never firing.
export function lastPortfolioMilestone() {
  return {
    value: Number(localStorage.getItem("bv_ms_value")) || 0,
    count: Number(localStorage.getItem("bv_ms_count")) || 0,
  };
}
export function recordPortfolioMilestone(count, value) {
  try {
    localStorage.setItem("bv_ms_count", String(Math.max(0, Math.round(Number(count) || 0))));
    localStorage.setItem("bv_ms_value", String(Math.max(0, Math.round(Number(value) || 0))));
  } catch {}
}

export function themeHue(theme = "") {
  let h = 0;
  for (let i = 0; i < theme.length; i++) h = (h * 31 + theme.charCodeAt(i)) & 0xFFFF;
  return h % 360;
}

export function setHue(set) {
  return set.hue ?? themeHue(set.theme || "");
}

export const THEME_COLORS = {
  "Star Wars":        "#1a1a2e",
  "City":             "#0057b7",
  "Technic":          "#e8a500",
  "Creator":          "#2e7d32",
  "Friends":          "#e91e8c",
  "Harry Potter":     "#5c3317",
  "Ninjago":          "#d32f2f",
  "Ideas":            "#7c3aed",
  "Architecture":     "#546e7a",
  "Disney":           "#1976d2",
  "Marvel":           "#b71c1c",
  "DC":               "#0d47a1",
  "Speed Champions":  "#f57c00",
  "Minecraft":        "#4caf50",
  "Icons":            "#37474f",
  "Classic":          "#f9a825",
  "Duplo":            "#e53935",
  "Creator Expert":   "#558b2f",
  "Art":              "#6a1b9a",
  "Botanical":        "#388e3c",
};

export function fmtShortDate(d) {
  try {
    // getLocale(), not "en-US": this feeds the price-chart scrub tooltip, which
    // read "Jul 8" no matter what language the rest of the chart was in.
    return new Date(d).toLocaleDateString(getLocale(), { month: "short", day: "numeric" });
  } catch { return ""; }
}

export function parseUTCDate(str) {
  if (!str) return null;
  let iso = str;
  if (!str.includes('T') && !str.includes('Z')) {
    iso = str.replace(' ', 'T') + 'Z';
  }
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

export function fmtDateUpdated(str) {
  const d = parseUTCDate(str);
  if (!d) return t("time.unknown");
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0 && now.getDate() === d.getDate()) {
    return t("time.today");
  } else if (diffDays === 1 || (diffDays === 0 && now.getDate() !== d.getDate())) {
    return t("time.yesterday");
  } else if (diffDays < 7) {
    // "2 days ago" carries a number, so no exact-match key can ever reach it.
    return t("time.daysAgo", { n: diffDays });
  }
  // Was pinned to en-US, which rendered "Nov 3, 2025" for every language.
  return d.toLocaleDateString(getLocale(), { month: "short", day: "numeric", year: "numeric" });
}

export function setBtnLoading(el, on) {
  if (!el) return;
  el.classList.toggle("is-loading", !!on);
  el.disabled = !!on;
}

export function drawSparkline(container, data, opts = {}) {
  if (!container || !data || data.length < 2) return;
  const W = container.clientWidth || 300;
  const H = container.clientHeight || 88;
  const vals = data.map(d => d.total_value ?? d.current_value ?? d);
  const dates = data.map(d => (d && d.snapshot_date) || null);
  // Optional overlay series: opts.series = [{ key, color, dash }] — drawn on
  // the same scale so divergence between sources is visually honest.
  const series = (opts.series || [])
    .map(s => ({
      ...s,
      pts: data.map((d, i) => ({ i, v: Number(d?.[s.key]) })).filter(p => Number.isFinite(p.v) && p.v > 0),
    }))
    .filter(s => s.pts.length >= 2);
  const allVals = vals.filter(v => Number.isFinite(v)).concat(...series.map(s => s.pts.map(p => p.v)));
  const mn = Math.min(...allVals), mx = Math.max(...allVals);
  const pad = 4;
  const xs = (i) => pad + (i / (data.length - 1)) * (W - pad * 2);
  // A flat series (all snapshots equal — e.g. day-one vaults) would otherwise
  // normalize to y=max and hug the bottom edge; center it instead.
  const ys = (v) => mx === mn ? H / 2 : H - pad - ((v - mn) / (mx - mn)) * (H - pad * 2);
  let path = `M${xs(0).toFixed(1)} ${ys(vals[0]).toFixed(1)}`;
  for (let i = 1; i < data.length; i++) path += ` L${xs(i).toFixed(1)} ${ys(vals[i]).toFixed(1)}`;
  const area = path + ` L${xs(data.length - 1).toFixed(1)} ${H} L${xs(0).toFixed(1)} ${H} Z`;
  const stroke = opts.up !== false ? "var(--up)" : "var(--down)";
  const gid = "sg" + Math.random().toString(36).slice(2, 8);
  const overlays = series.map(s => {
    let p = `M${xs(s.pts[0].i).toFixed(1)} ${ys(s.pts[0].v).toFixed(1)}`;
    for (let j = 1; j < s.pts.length; j++) p += ` L${xs(s.pts[j].i).toFixed(1)} ${ys(s.pts[j].v).toFixed(1)}`;
    return `<path d="${p}" fill="none" stroke="${s.color}" stroke-width="1.5" stroke-dasharray="${s.dash || "4 3"}" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`;
  }).join("");
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${stroke}" stop-opacity="0.30"/>
          <stop offset="100%" stop-color="${stroke}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#${gid})" />
      ${overlays}
      <path d="${path}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <line class="spark-guide" x1="0" y1="0" x2="0" y2="${H}" stroke="${stroke}" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>
      <circle class="spark-cursor" r="4.5" fill="${stroke}" stroke="var(--bg)" stroke-width="2" opacity="0"/>
      ${opts.dot !== false ? `<circle cx="${xs(data.length-1).toFixed(1)}" cy="${ys(vals[vals.length-1]).toFixed(1)}" r="4" fill="${stroke}" stroke="var(--bg)" stroke-width="2"/>` : ""}
    </svg>
    <div class="spark-scrub"></div>`;

  if (opts.scrub === false) return;
  const guide = container.querySelector(".spark-guide");
  const cursor = container.querySelector(".spark-cursor");
  const scrub = container.querySelector(".spark-scrub");
  const onMove = (e) => {
    const rect = container.getBoundingClientRect();
    if (!rect.width) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const i = Math.round(ratio * (data.length - 1));
    const cx = xs(i), cy = ys(vals[i]);
    guide.setAttribute("x1", cx); guide.setAttribute("x2", cx); guide.setAttribute("opacity", "0.45");
    cursor.setAttribute("cx", cx); cursor.setAttribute("cy", cy); cursor.setAttribute("opacity", "1");
    scrub.style.left = (cx / W * rect.width) + "px";
    scrub.style.top = (cy / H * rect.height) + "px";
    scrub.innerHTML = `<strong>${fmtMoney(vals[i], { cents: 0 })}</strong>${dates[i] ? " · " + fmtShortDate(dates[i]) : ""}`;
    scrub.classList.add("show");
  };
  const onLeave = () => {
    guide.setAttribute("opacity", "0");
    cursor.setAttribute("opacity", "0");
    scrub.classList.remove("show");
  };
  container.addEventListener("pointermove", onMove);
  container.addEventListener("pointerleave", onLeave);
  container.addEventListener("touchmove", onMove, { passive: true });
  container.addEventListener("touchend", onLeave);
}

export function brickTile(set) {
  const h = setHue(set);
  return `<div class="brick-tile" style="--h:${h};"></div>`;
}

// Route Rebrickable-hosted images through our /api/img mirror (R2 + edge
// cache). Logged-in API responses arrive already rewritten server-side; this
// covers GUEST-mode data (localStorage snapshots hold raw CDN URLs). Any other
// host passes through untouched — the allowlist matches the worker's.
export function proxyImg(url) {
  if (typeof url === "string" && url.startsWith("https://cdn.rebrickable.com/")) {
    return `${window.WORKER_BASE || ""}/api/img?u=${encodeURIComponent(url)}`;
  }
  return url;
}

// The Transformations-enabled zone that reliably downscales (?w=<px> → ~15-27KB
// vs ~100KB full). This is the SAME Worker exposed on the bricksvault.app zone,
// which is the only host where Cloudflare Image Resizing is enabled — the
// workers.dev host returns full-size. Used for parsing/base only; the live
// origin comes from thumbOrigin() below so it can fail over per session.
export const IMAGE_ORIGIN = window.IMAGE_BASE || "https://img.bricksvault.app";

// Live origin for thumbnails. The Transformations zone (img.bricksvault.app) is
// a freshly-added subdomain that has been seen to fail on some devices (stale
// DNS, edge/WebView hiccup). The first time a thumbnail from it fails to load,
// installImageFallback flips this flag so every SUBSEQUENT thumbnail is built
// against the proven Worker host instead (full-size but reliable) — no repeated
// failed first-requests. An explicit window.IMAGE_BASE always wins.
function thumbOrigin() {
  if (window.IMAGE_BASE) return window.IMAGE_BASE;
  if (window.__bvThumbHostDown) return window.WORKER_BASE || "";
  return "https://img.bricksvault.app";
}

// Thumbnail URL for GRID cards. Accepts a raw Rebrickable CDN URL OR an already
// proxied /api/img URL (from the API or the bundled seed) and re-points it at
// the current thumbnail origin with a width. Detail/lightbox keep full-size
// images (they call proxyImg, not this). Non-Rebrickable images pass through.
export function thumbImg(url, w = 400) {
  if (typeof url !== "string" || !url || url.startsWith("data:")) return url;
  let src = null;
  if (url.startsWith("https://cdn.rebrickable.com/")) {
    src = url;
  } else if (url.includes("/api/img?")) {
    try { src = new URL(url, IMAGE_ORIGIN).searchParams.get("u"); } catch { src = null; }
  }
  if (!src || !src.startsWith("https://cdn.rebrickable.com/")) return url;
  return `${thumbOrigin()}/api/img?u=${encodeURIComponent(src)}&w=${w}`;
}

// Grid thumbnails go through the Transformations zone (img.bricksvault.app). If
// that host ever fails to load an <img> on a device — a stale-DNS window on the
// freshly-added subdomain, an edge hiccup — the card would show only its
// brick-tile placeholder. This capture-phase listener transparently retries a
// failed proxied image via the proven Worker proxy (full size), then the origin
// CDN, and only then gives up. One handler covers every view's <img>, no
// per-tag onerror needed.
export function installImageFallback(win = window) {
  const doc = win.document;
  if (!doc || doc.__bvImgFallback) return;
  doc.__bvImgFallback = true;
  doc.addEventListener(
    "error",
    (e) => {
      const img = e.target;
      if (!img || img.tagName !== "IMG") return;
      const src = img.currentSrc || img.getAttribute("src") || "";
      if (!src.includes("/api/img?")) return; // only our proxied images
      let cdn = null;
      try { cdn = new URL(src, IMAGE_ORIGIN).searchParams.get("u"); } catch { cdn = null; }
      const stage = img.dataset.imgFb || "";
      if (stage === "" && cdn && src.includes("img.bricksvault.app")) {
        // Stage 1: retry via the Worker proxy (proven to load on-device) AND
        // flip the session so every subsequent thumbnail skips the failing host
        // entirely — one failed request, then all cards render from the Worker.
        win.__bvThumbHostDown = true;
        img.dataset.imgFb = "worker";
        img.src = `${win.WORKER_BASE || ""}/api/img?u=${encodeURIComponent(cdn)}&w=400`;
        return;
      }
      if (stage !== "cdn" && cdn && cdn.startsWith("https://cdn.rebrickable.com/")) {
        // Stage 2: straight to the origin CDN.
        img.dataset.imgFb = "cdn";
        img.src = cdn;
        return;
      }
      // Stage 3: give up — hide the <img> so the brick-tile placeholder shows.
      img.dataset.imgFb = "failed";
      img.style.display = "none";
    },
    true,
  );
}

export function slImgHTML(set, { newBadge = false, qtyBadge = 0 } = {}) {
  const _h = setHue(set);
  const hasImg = set.image_url && !set.image_url.startsWith("data:");
  return `<div class="sl-img has-tile${hasImg ? " has-photo" : ""}">
    ${brickTile(set)}
    ${hasImg ? `<img class="set-photo" src="${escapeHtml(thumbImg(set.image_url))}" alt="" loading="lazy" decoding="async">` : ""}
    ${newBadge ? `<span class="new-badge">NEW</span>` : ""}
    ${qtyBadge > 1 ? `<span class="qty-badge">×${qtyBadge}</span>` : ""}
  </div>`;
}

export function bricklinkBuyURL(setNum) {
  const clean = setNum.replace(/-1$/, "");
  return `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${clean}-1`;
}

export function emptyState({ icon = '', title, body = '', action = '' } = {}) {
  return `<div class="empty-state">
    ${icon ? `<div class="empty-state-icon" aria-hidden="true">${icon}</div>` : ''}
    <div class="empty-state-title">${escapeHtml(title || '')}</div>
    ${body ? `<p class="empty-state-body">${escapeHtml(body)}</p>` : ''}
    ${action}
  </div>`;
}

export function trendBadgeHTML(trend) {
  if (trend === "rising") {
    return `<span class="trend-badge rising" title="Price trend: Rising">${I.trend({w:10, h:10})} Rising</span>`;
  }
  if (trend === "falling") {
    return `<span class="trend-badge falling" title="Price trend: Falling">${I.trendDown({w:10, h:10})} Falling</span>`;
  }
  return "";
}

/** Mark a .field wrapper (or input) as invalid and show msg in its .field-err
 *  sibling (created if missing). Pass clearFieldError to reset. */
export function setFieldError(fieldEl, msg) {
  if (!fieldEl) return;
  fieldEl.classList.add("error");
  let err = fieldEl.querySelector(".field-err") || fieldEl.nextElementSibling;
  if (!err || !err.classList?.contains("field-err")) {
    err = document.createElement("div");
    err.className = "field-err";
    fieldEl.appendChild(err);
  }
  err.textContent = msg || "";
}

export function clearFieldError(fieldEl) {
  if (!fieldEl) return;
  fieldEl.classList.remove("error");
  const err = fieldEl.querySelector(".field-err");
  if (err) err.textContent = "";
}

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function resizeImage(dataUrl, maxSide = 1024) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const w = img.width, h = img.height;
      const scale = Math.min(1, maxSide / Math.max(w, h));
      canvas.width = w * scale; canvas.height = h * scale;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => reject(new Error("Failed to load image for resize"));
    img.src = dataUrl;
  });
}

