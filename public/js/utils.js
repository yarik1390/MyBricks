import { I } from './icons.js';
import { state } from './state.js';

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

/* ---------- Formatters ---------- */
export const CURRENCY_SYMBOLS = {
  USD: "$",
  GBP: "£",
  EUR: "€",
  CAD: "CA$",
  AUD: "A$"
};

let exchangeRates = { USD: 1 };

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
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const json = await res.json();
    if (json && json.rates) {
      exchangeRates = json.rates;
      localStorage.setItem("bv_exchange_rates", JSON.stringify({
        timestamp: Date.now(),
        rates: json.rates
      }));
    }
  } catch (e) {
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

export function haptic(t) {
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
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
  if (!d) return "unknown";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0 && now.getDate() === d.getDate()) {
    return "Today";
  } else if (diffDays === 1 || (diffDays === 0 && now.getDate() !== d.getDate())) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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
  const ys = (v) => H - pad - ((v - mn) / ((mx - mn) || 1)) * (H - pad * 2);
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

export function slImgHTML(set, { newBadge = false, qtyBadge = 0 } = {}) {
  const h = setHue(set);
  const hasImg = set.image_url && !set.image_url.startsWith("data:");
  return `<div class="sl-img has-tile${hasImg ? " has-photo" : ""}">
    ${brickTile(set)}
    ${hasImg ? `<img class="set-photo" src="${escapeHtml(set.image_url)}" alt="" loading="lazy">` : ""}
    ${newBadge ? `<span class="new-badge">NEW</span>` : ""}
    ${qtyBadge > 1 ? `<span class="qty-badge">×${qtyBadge}</span>` : ""}
  </div>`;
}

export function bricklinkBuyURL(setNum) {
  const clean = setNum.replace(/-1$/, "");
  return `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${clean}-1`;
}

export function trendBadgeHTML(trend) {
  if (trend === "rising") {
    return `<span class="trend-badge rising" style="display:inline-flex;align-items:center;gap:3px;font-size:10px;color:var(--up);font-weight:700;margin-left:6px;" title="Price trend: Rising">${I.trend({w:10, h:10})} ↑ Rising</span>`;
  }
  if (trend === "falling") {
    return `<span class="trend-badge falling" style="display:inline-flex;align-items:center;gap:3px;font-size:10px;color:var(--bv-red);font-weight:700;margin-left:6px;" title="Price trend: Falling">${I.trend({w:10, h:10})} ↓ Falling</span>`;
  }
  return "";
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

