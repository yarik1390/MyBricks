/* ============================================================
   Brickvault — frontend (vanilla JS, hash routing, real API)
   ============================================================ */
"use strict";

/* ---------- icon library ---------- */
const I = (() => {
  const s = (d, opts) => `<svg viewBox="0 0 24 24" width="${(opts&&opts.w)||22}" height="${(opts&&opts.w)||22}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  return {
    home:     () => s('<path d="M3 11l9-8 9 8M5 10v10h14V10"/>'),
    search:   () => s('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
    scan:     () => s('<path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3"/><path d="M7 12h10"/>'),
    plus:     () => s('<path d="M12 5v14M5 12h14"/>'),
    minus:    () => s('<path d="M5 12h14"/>'),
    check:    () => s('<path d="M5 12l5 5L20 7"/>'),
    trash:    () => s('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
    chev:     () => s('<path d="M9 6l6 6-6 6"/>'),
    chevL:    () => s('<path d="M15 6l-6 6 6 6"/>'),
    close:    () => s('<path d="M6 6l12 12M18 6L6 18"/>'),
    gear:     () => s('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.1-1.2l2-1.6-2-3.4-2.4.9a7 7 0 00-2-1.2L14 3h-4l-.5 2.5a7 7 0 00-2 1.2l-2.4-.9-2 3.4 2 1.6A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-.9a7 7 0 002 1.2L10 21h4l.5-2.5a7 7 0 002-1.2l2.4.9 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/>'),
    layers:   () => s('<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5M3 18l9 5 9-5"/>'),
    bell:     () => s('<path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 21a2 2 0 004 0"/>'),
    heart:    () => s('<path d="M12 21s-7-4.5-9.5-9A5 5 0 0112 6a5 5 0 019.5 6c-2.5 4.5-9.5 9-9.5 9z"/>'),
    heartF:   () => `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 21s-7-4.5-9.5-9A5 5 0 0112 6a5 5 0 019.5 6c-2.5 4.5-9.5 9-9.5 9z"/></svg>`,
    filter:   () => s('<path d="M4 5h16M7 12h10M10 19h4"/>'),
    arrowR:   () => s('<path d="M5 12h14M13 5l7 7-7 7"/>'),
    arrowU:   () => s('<path d="M7 15l5-5 5 5"/>'),
    arrowD:   () => s('<path d="M7 9l5 5 5-5"/>'),
    sparkles: () => s('<path d="M12 3l1.8 4.4L18 9l-4.2 1.6L12 15l-1.8-4.4L6 9l4.2-1.6L12 3zM19 15l.8 1.7L21 18l-1.2.7L19 21l-.8-2.3L17 18l1.2-1.3z"/>'),
    download: () => s('<path d="M12 4v12m0 0l-5-5m5 5l5-5M4 20h16"/>'),
    pencil:   () => s('<path d="M4 20h4l10-10-4-4L4 16v4z"/>'),
    eye:      () => s('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    dollar:   () => s('<path d="M12 2v20M17 6H9.5a3 3 0 100 6h5a3 3 0 010 6H6"/>'),
    share:    () => s('<circle cx="6" cy="12" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8.5 10.5l7-3M8.5 13.5l7 3"/>'),
    cart:     () => s('<path d="M3 4h2l3 12h11l2-8H6"/><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/>'),
    tag:      () => s('<path d="M3 12V3h9l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/>'),
    figure:   () => s('<rect x="8" y="3" width="8" height="5" rx="1"/><path d="M6 8h12v6H6zM9 14v6M15 14v6"/>'),
    star:     () => s('<path d="M12 3l2.6 6.1 6.4.6-4.9 4.3 1.5 6.3L12 17.3 6.4 20.3l1.5-6.3L3 9.7l6.4-.6L12 3z"/>'),
    refresh:  () => s('<path d="M3 12a9 9 0 0115-6.7L21 8M21 4v4h-4M21 12a9 9 0 01-15 6.7L3 16M3 20v-4h4"/>'),
    camera:   () => s('<path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/>'),
    barcode:  () => s('<path d="M4 6v12M7 6v12M10 6v12M13 6v12M16 6v12M19 6v12" stroke-width="1.8"/>'),
    user:     () => s('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>'),
    box:      () => s('<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/>'),
    flash:    () => s('<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>'),
    info:       () => s('<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>'),
    trend:      () => s('<path d="M3 17l6-6 4 4 8-9"/><path d="M14 6h7v7"/>'),
    extLink:    () => s('<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/>'),
    advisor:    () => s('<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 015.1 2.1c0 1.6-1.5 2.5-2.1 3.4V16"/><circle cx="12" cy="19" r=".5" fill="currentColor"/>'),
    fire:       () => s('<path d="M8.5 2C8.5 2 9 5 7 8c-1.5 2.5-.5 5 1.5 6.5C8 12 10 10.5 10 10.5s.5 4 3 6a7 7 0 10-4.5-14.5z"/>'),
  };
})();

/* ---------- DOM helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ---------- state ---------- */
/* ---------- IndexedDB cache (state persistence across reloads) ---------- */
const bvIDB = (() => {
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
  return { get, set };
})();

/* ---------- Offline outbox (queue mutations for replay when back online) ---------- */
const OUTBOX_KEY = 'bv_outbox';
function outboxEnqueue(item) {
  try {
    const q = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
    q.push({ id: Date.now(), ...item });
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(q));
  } catch {}
}
function outboxDequeue(id) {
  try {
    const q = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(q.filter(x => x.id !== id)));
  } catch {}
}
async function drainOutbox() {
  try {
    const q = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
    if (!q.length) return;
    let synced = 0;
    for (const item of q) {
      await api(item.path, { method: item.method, ...(item.body ? { body: item.body } : {}) });
      outboxDequeue(item.id);
      synced++;
    }
    state.portfolio = null;
    if (synced) toast(`${synced} offline action${synced > 1 ? 's' : ''} synced`, 'success');
  } catch {}
}

const state = {
  portfolio: null,
  catalog: { items: [], total: 0, offset: 0, hasMore: false, loading: false, pageSize: 24 },
  blind: { items: [], total: 0, offset: 0, hasMore: false, loading: false, ownedCount: 0, pageSize: 30 },
  themes: [], themesLoadedAt: 0,
  me: null,
  filter: {
    kind: "all", theme: null, range: "1M", q: "",
    sort: localStorage.getItem("bv_sort") || "added_desc",
    catalogQ: "",
    catalogSort: "value_desc", catalogYear: "all",
    catalogRetired: false, catalogTheme: "all",
    catalogRanges: { min_year: "", max_year: "", min_pieces: "", max_pieces: "", min_value: "", max_value: "" },
    wishlistSort: "recent",
    figQ: "", figRarity: "all", figOwned: "all",
  },
  detail: { tab: "info", cache: {} },
  pwa: { deferredPrompt: null },
  wishlist: [], wishlistAlerts: [],
  portfolioHistory: null,
  ownedFigs: new Set(JSON.parse(localStorage.getItem("bv_figs") || "[]")),
  toastTimer: null,
  camera: { stream: null, mode: "barcode", detector: null, scanning: false, timer: null },
  pendingRequests: new Set(),
};

/* ---------- Supabase auth (no SDK — plain fetch to REST API) ---------- */
let _authSession = null;
let _sbUrl = "";
let _sbAnonKey = "";
let _swipeAc = null;

function loadSession() {
  try { return JSON.parse(localStorage.getItem("bv_session") || "null"); } catch { return null; }
}
function saveSession(s) {
  try {
    if (s) localStorage.setItem("bv_session", JSON.stringify(s));
    else localStorage.removeItem("bv_session");
  } catch {}
  _authSession = s;
}
async function sbSignIn(email, password) {
  const r = await fetch(`${_sbUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: _sbAnonKey },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error_description || d.message || "Sign in failed");
  return d;
}
async function sbSignUp(email, password) {
  const r = await fetch(`${_sbUrl}/auth/v1/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: _sbAnonKey },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json();
  if (!r.ok || d.error) throw new Error(d.error_description || d.error || d.message || "Sign up failed");
  return d;
}
async function sbRefresh(refreshToken) {
  const r = await fetch(`${_sbUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: _sbAnonKey },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error("Session expired");
  return d;
}
async function sbSignOut() {
  if (!_authSession?.access_token) return;
  await fetch(`${_sbUrl}/auth/v1/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${_authSession.access_token}`, apikey: _sbAnonKey },
  }).catch(() => {});
  saveSession(null);
}

/* ---------- helpers ---------- */
function fmtMoney(n, opts = {}) {
  if (n == null || isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const v = abs.toLocaleString("en-US", { minimumFractionDigits: opts.cents ?? 2, maximumFractionDigits: 2 });
  return sign + "$" + v;
}
function fmtMoneyShort(n) {
  if (n == null || isNaN(n)) return "—";
  const a = Math.abs(n); const s = n < 0 ? "-" : "";
  if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return s + "$" + (a / 1e3).toFixed(1) + "K";
  return s + "$" + a.toFixed(0);
}
function fmtPct(n) { return (n >= 0 ? "+" : "") + (n * 100).toFixed(1) + "%"; }
function daysAgo(iso) { return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); }
function yearsAgo(iso) { return (Date.now() - new Date(iso).getTime()) / (365.25 * 86400000); }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function parseMarkdown(text) {
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
function haptic(t) {
  const ms = t === "heavy" ? 30 : t === "medium" ? 15 : 8;
  try { navigator.vibrate && navigator.vibrate(ms); } catch {}
}
function toast(msg, type) {
  const el = $("#toast");
  if (!el) return;
  el.className = "show " + (type || "info");
  el.innerHTML = `<span class="t-icon">${type === "success" ? I.check() : type === "error" ? I.close() : I.info()}</span><span>${msg}</span>`;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}
function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Celebratory confetti burst — pure DOM, no library. Spawns ~40 colored
// shards that fall and fade. Auto-cleans after the animation. Respects
// reduced-motion (no-op).
function confettiBurst() {
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

/* ---------- hue from theme (deterministic) ---------- */
function themeHue(theme = "") {
  let h = 0;
  for (let i = 0; i < theme.length; i++) h = (h * 31 + theme.charCodeAt(i)) & 0xFFFF;
  return h % 360;
}
function setHue(set) {
  return set.hue ?? themeHue(set.theme || "");
}

/* ---------- theme → accent color map ---------- */
const THEME_COLORS = {
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

/* ---------- API ---------- */
async function api(path, opts = {}) {
  const token = _authSession?.access_token;
  const streamMode = opts.stream === true;
  const init = {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  };
  delete init.stream;
  const _url = (window.WORKER_BASE || '') + path;
  let r;
  try {
    r = await fetch(_url, init);
  } catch (e) {
    if (!navigator.onLine && (init.method === "POST" || init.method === "PATCH" || init.method === "DELETE")) {
      outboxEnqueue({ path, method: init.method, body: opts.body });
      toast("Saved offline — will sync when connected", "info");
      return init.method === "DELETE" ? null : { item: opts.body || {} };
    }
    // Network-level failure — retry once after a short delay.
    await new Promise(res => setTimeout(res, 600));
    try {
      r = await fetch(_url, init);
    } catch (e2) {
      if (init.method === "POST" || init.method === "PATCH" || init.method === "DELETE") {
        outboxEnqueue({ path, method: init.method, body: opts.body });
        toast("Saved offline — will sync when connected", "info");
        return init.method === "DELETE" ? null : { item: opts.body || {} };
      }
      throw e2;
    }
  }
  // Token expired — try a silent refresh, then retry the original request.
  if (r.status === 401) {
    if (_authSession?.refresh_token) {
      try {
        const fresh = await sbRefresh(_authSession.refresh_token);
        saveSession(fresh);
        init.headers["Authorization"] = `Bearer ${fresh.access_token}`;
        r = await fetch(_url, init);
      } catch {
        saveSession(null);
        location.hash = "#/login";
        throw new Error("Session expired — please sign in again");
      }
    } else {
      saveSession(null);
      location.hash = "#/login";
      throw new Error("Please sign in");
    }
  }
  if (!r.ok) {
    let msg = r.statusText;
    try { const b = await r.json(); msg = b.error || msg; if (b.reason) msg += ': ' + b.reason; } catch {}
    throw new Error(msg);
  }
  if (r.status === 204) return null;
  if (streamMode) return r;  // caller reads the SSE body directly
  return r.json();
}

/* ============================================================
   Sparkline (SVG)
   ============================================================ */
function drawSparkline(container, data, opts = {}) {
  if (!container || !data || data.length < 2) return;
  const W = container.clientWidth || 300;
  const H = container.clientHeight || 88;
  const vals = data.map(d => d.total_value ?? d.current_value ?? d);
  const dates = data.map(d => (d && d.snapshot_date) || null);
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const pad = 4;
  const xs = (i) => pad + (i / (data.length - 1)) * (W - pad * 2);
  const ys = (v) => H - pad - ((v - mn) / ((mx - mn) || 1)) * (H - pad * 2);
  let path = `M${xs(0).toFixed(1)} ${ys(vals[0]).toFixed(1)}`;
  for (let i = 1; i < data.length; i++) path += ` L${xs(i).toFixed(1)} ${ys(vals[i]).toFixed(1)}`;
  const area = path + ` L${xs(data.length - 1).toFixed(1)} ${H} L${xs(0).toFixed(1)} ${H} Z`;
  const stroke = opts.up !== false ? "var(--up)" : "var(--down)";
  const gid = "sg" + Math.random().toString(36).slice(2, 8);
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

function fmtShortDate(d) {
  try {
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch { return ""; }
}

// Toggle an inline loading state on a button (spinner + disabled). The CSS
// `.is-loading` class hides the label and shows a spinner.
function setBtnLoading(el, on) {
  if (!el) return;
  el.classList.toggle("is-loading", !!on);
  el.disabled = !!on;
}

// Fetch and draw a set's REAL price history. Honest empty state when there
// aren't yet two points to connect (never fabricates a trend).
async function loadSetHistory(setNum) {
  const el = $("#setSpark");
  if (!el) return;
  try {
    const res = await api("/api/sets/" + encodeURIComponent(setNum) + "/history?days=90");
    const hist = res.history || [];
    if (hist.length >= 2) {
      const up = Number(hist[hist.length - 1].current_value) >= Number(hist[0].current_value);
      drawSparkline(el, hist, { up });
    } else {
      el.style.height = "auto";
      el.innerHTML = `<div class="spark-empty">${I.info()}<span>Price tracking just started — check back soon for a trend.</span></div>`;
    }
  } catch {
    el.style.height = "auto";
    el.innerHTML = `<div class="spark-empty"><span>Couldn't load price history.</span></div>`;
  }
}

/* ============================================================
   Brick-tile / image helpers
   ============================================================ */
function brickTile(set) {
  const h = setHue(set);
  return `<div class="brick-tile" style="--h:${h};"></div>`;
}

function slImgHTML(set, { newBadge = false, qtyBadge = 0 } = {}) {
  const h = setHue(set);
  const hasImg = set.image_url && !set.image_url.startsWith("data:");
  return `<div class="sl-img has-tile${hasImg ? " has-photo" : ""}">
    ${brickTile(set)}
    ${hasImg ? `<img class="set-photo" src="${escapeHtml(set.image_url)}" alt="" loading="lazy">` : ""}
    ${newBadge ? `<span class="new-badge">NEW</span>` : ""}
    ${qtyBadge > 1 ? `<span class="qty-badge">×${qtyBadge}</span>` : ""}
  </div>`;
}

/* ============================================================
   Login screen
   ============================================================ */
function renderLogin() {
  let mode = "signin";
  const nav = document.getElementById("nav");
  if (nav) nav.style.display = "none";

  const paint = () => {
    document.getElementById("root").innerHTML = `
      <div class="page" style="max-width:420px;margin:0 auto;padding-top:48px;">
        <div style="text-align:center;margin-bottom:32px;">
          <div style="font-family:var(--serif);font-size:30px;font-weight:600;margin-bottom:6px;">Brickvault</div>
          <div style="color:var(--ink-mute);font-size:14px;">Your brick portfolio, always in hand.</div>
        </div>
        <div class="card" style="padding:24px;">
          <div class="section-title" style="margin-bottom:16px;">${mode === "signin" ? "Sign in" : "Create account"}</div>
          <div style="display:flex;flex-direction:column;gap:12px;">
            <input type="email" id="authEmail" placeholder="Email address" autocomplete="email"
              style="padding:12px;border:1.5px solid var(--line);border-radius:var(--r-2);background:var(--surface-2);color:var(--ink);font-size:15px;outline:none;font-family:var(--sans);">
            <input type="password" id="authPass" placeholder="Password"
              autocomplete="${mode === "signin" ? "current-password" : "new-password"}"
              style="padding:12px;border:1.5px solid var(--line);border-radius:var(--r-2);background:var(--surface-2);color:var(--ink);font-size:15px;outline:none;font-family:var(--sans);">
            <button class="btn-primary" id="authSubmit" style="margin-top:4px;">
              <span>${mode === "signin" ? "Sign in" : "Create account"}</span>
            </button>
            <div id="authErr" style="color:var(--down);font-size:13px;text-align:center;min-height:18px;font-family:var(--mono);"></div>
            <div style="display:flex;align-items:center;gap:10px;margin-top:4px;">
              <div style="flex:1;height:1px;background:var(--line);"></div>
              <div style="font-size:12px;color:var(--ink-mute);white-space:nowrap;">or</div>
              <div style="flex:1;height:1px;background:var(--line);"></div>
            </div>
            <button id="googleSignIn" class="btn-secondary" style="width:100%;gap:10px;justify-content:center;">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              <span>Continue with Google</span>
            </button>
          </div>
        </div>
        <div style="text-align:center;margin-top:16px;font-size:13px;color:var(--ink-mute);">
          ${mode === "signin" ? "Don't have an account?" : "Already have an account?"}
          <button id="authSwitch" style="color:var(--accent);background:none;border:none;font-size:13px;font-weight:600;cursor:pointer;padding:0 4px;">
            ${mode === "signin" ? "Sign up" : "Sign in"}
          </button>
        </div>
      </div>`;

    document.getElementById("authSwitch").addEventListener("click", () => {
      mode = mode === "signin" ? "signup" : "signin";
      paint();
    });

    document.getElementById("googleSignIn")?.addEventListener("click", () => {
      if (!_sbUrl) { toast("Auth not configured", "error"); return; }
      const redirectTo = encodeURIComponent(location.origin + location.pathname);
      location.href = `${_sbUrl}/auth/v1/authorize?provider=google&redirect_to=${redirectTo}`;
    });

    const submit = async () => {
      const email = document.getElementById("authEmail")?.value.trim() || "";
      const pass = document.getElementById("authPass")?.value || "";
      const btn = document.getElementById("authSubmit");
      const errEl = document.getElementById("authErr");
      if (!email || !pass) { if (errEl) errEl.textContent = "Email and password required."; return; }
      setBtnLoading(btn, true);
      if (errEl) errEl.textContent = "";
      try {
        let session;
        if (mode === "signin") {
          session = await sbSignIn(email, pass);
        } else {
          session = await sbSignUp(email, pass);
          if (!session.access_token) {
            if (errEl) errEl.textContent = "Account created! Check your email to confirm, then sign in.";
            setBtnLoading(btn, false);
            setTimeout(() => { mode = "signin"; paint(); }, 2000);
            return;
          }
        }
        saveSession(session);
        if (nav) nav.style.display = "";
        location.hash = "#/";
      } catch (e) {
        if (errEl) errEl.textContent = e.message;
        setBtnLoading(btn, false);
      }
    };

    document.getElementById("authSubmit")?.addEventListener("click", submit);
    document.getElementById("authPass")?.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
  };

  paint();
}

/* ============================================================
   Router
   ============================================================ */
function errorStateHTML() {
  return `
    <div class="page">
      <div class="empty card">
        <div class="empty-icon">${I.info()}</div>
        <h3>Something went wrong</h3>
        <p>We couldn't load this page. Check your connection and try again.</p>
        <button class="btn-primary" id="errorRetry">${I.refresh()}<span>Retry</span></button>
      </div>
    </div>`;
}

const prefersReducedMotion = () =>
  window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// --- Theme (light / dark / auto) ---------------------------------------
// CSS is attribute-driven via :root[data-theme="dark"]; "auto" is resolved to a
// concrete value here so the manual switch works regardless of the OS setting.
const getThemePref = () => {
  try { return localStorage.getItem("bv_theme") || "auto"; } catch { return "auto"; }
};
const resolveTheme = pref => {
  if (pref === "light" || pref === "dark") return pref;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};
function applyTheme(pref) {
  const resolved = resolveTheme(pref);
  document.documentElement.dataset.theme = resolved;
  // Keep the browser chrome (status/address bar) in step with the theme.
  const color = resolved === "dark" ? "#16161C" : "#F5F1E8";
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute("content", color));
}
function setThemePref(pref) {
  try { localStorage.setItem("bv_theme", pref); } catch {}
  applyTheme(pref);
}
// Follow the OS while in auto mode.
if (window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getThemePref() === "auto") applyTheme("auto");
  });
}

// Run a synchronous DOM update inside a View Transition for a native-feeling
// crossfade between routes. Falls back to a plain call when unsupported or when
// the user prefers reduced motion.
// Route transition. We deliberately do NOT use document.startViewTransition:
// its ::view-transition pseudo-element overlay can get stuck showing the old
// snapshot on top of the live DOM when a transition is interrupted (overlapping
// tab taps, a mid-transition DOM mutation, or a rejected update callback),
// which presents as a blank page that only a manual reload clears. Instead we
// run the (possibly async) render, then play a short opacity fade on the live
// #root element. A fade on the real element can never freeze the page — it
// always ends at opacity:1 — so the page can never get stuck blank.
async function withViewTransition(fn) {
  await fn();
  if (prefersReducedMotion()) return;
  const root = document.getElementById('root');
  if (!root) return;
  root.classList.remove('route-fade');
  void root.offsetWidth; // force reflow so the animation restarts
  root.classList.add('route-fade');
}

function showNavProgress() {
  const el = document.getElementById('navProgress');
  if (!el) return;
  el.classList.remove('done');
  el.style.width = '0';
  el.offsetWidth; // force reflow to restart transition
  el.classList.add('loading');
}
function hideNavProgress() {
  const el = document.getElementById('navProgress');
  if (!el) return;
  el.classList.remove('loading');
  el.classList.add('done');
  setTimeout(() => { el.classList.remove('done'); }, 500);
}

// True when the route can paint immediately from already-loaded state, so we
// show no top progress bar (the render is instant). When false, render() needs
// a network fetch, so we show the progress bar while it runs.
function hasCachedView(hash) {
  if (hash === "/" || hash === "") return !!state.portfolio;
  if (hash === "/add") return state.catalog.items.length > 0;
  if (hash === "/minifigs") return state.blind.items.length > 0;
  if (hash === "/advisor") return !!localStorage.getItem('bv_chat');
  return false;
}

// Serialize navigation. Rapid tab taps fire overlapping route() calls that each
// paint #root and each start their own View Transition; a slow or stale render
// could then clobber the page you just landed on, leaving a stuck skeleton until
// a manual refresh. Coalesce to a single in-flight route — if taps arrive while
// one is running, run exactly once more afterwards against the latest hash.
let _routeBusy = false;
let _routeQueued = false;
async function route() {
  if (_routeBusy) { _routeQueued = true; return; }
  _routeBusy = true;
  try {
    await _routeImpl();
  } finally {
    _routeBusy = false;
    if (_routeQueued) { _routeQueued = false; route(); }
  }
}

async function _routeImpl() {
  hideSheet();
  let hash = location.hash.replace("#", "") || "/";
  if (hash === "/blind") { location.hash = "#/minifigs"; return; }

  // Auth gate — bounce to login if no session.
  if (!_authSession) {
    if (hash !== "/login") { location.hash = "#/login"; return; }
    await withViewTransition(() => renderLogin());
    return;
  }
  if (hash === "/login") { location.hash = "#/"; return; }

  // Restore nav if it was hidden by the login screen.
  const nav = document.getElementById("nav");
  if (nav) nav.style.display = "";

  $$("#nav .nav-tab").forEach(t => {
    const r = t.dataset.route;
    const active = r === hash || (hash.startsWith("/set/") && r === "/") || (hash === "/wishlist" && r === "/");
    t.classList.toggle("active", active);
  });

  const render = async () => {
    if (hash === "/" || hash === "") await renderPortfolio();
    else if (hash === "/add") await renderAdd();
    else if (hash === "/pile") renderPile();
    else if (hash === "/minifigs") await renderBlind();
    else if (hash === "/me") await renderMe();
    else if (hash === "/advisor") await renderAdvisor();
    else if (hash === "/wishlist") await renderWishlist();
    else if (hash.startsWith("/set/")) {
      const parts = hash.split("/");
      const setNum = decodeURIComponent(parts[2]);
      state.detail.tab = parts[3] || "info";
      await renderSetDetail(setNum);
    } else if (hash.startsWith("/u/")) {
      const handle = hash.slice(3);
      await renderPublicProfile(handle);
    } else {
      location.hash = "#/";
      throw { __redirect: true };
    }
  };

  try {
    const cached = hasCachedView(hash);
    if (!cached) showNavProgress();
    await withViewTransition(() => render());
    if (!cached) {
      hideNavProgress();
      document.querySelector('#root .page')?.setAttribute('data-fresh', '1');
    }
  } catch (e) {
    if (e && e.__redirect) return;
    const root = $("#root");
    if (root) {
      root.innerHTML = errorStateHTML();
      $("#errorRetry")?.addEventListener("click", () => route());
    }
  }
  window.scrollTo({ top: 0, behavior: "instant" });
}

/* ============================================================
   Portfolio screen
   ============================================================ */
async function renderPortfolio() {
  if (!state.portfolio) {
    try {
      const [port, hist, wl] = await Promise.all([
        api("/api/collection"),
        api("/api/collection/history?days=365"),
        api("/api/wishlist"),
      ]);
      state.portfolio = port;
      state.portfolioHistory = hist.snapshots || [];
      state.wishlist = wl.wishlist || [];
      state.wishlistAlerts = wl.unread_alerts || [];
      bvIDB.set('portfolio', { data: state.portfolio, ts: Date.now() }).catch(() => {});
    } catch (e) {
      toast("Couldn't load collection: " + e.message, "error");
      state.portfolio = { items: [], total_value: 0, total_paid: 0, count: 0 };
      state.portfolioHistory = [];
    }
  }
  paintPortfolio();
}

// Filter + sort the vault items according to current state.filter. Pure — no DOM.
function sortedPortfolioItems() {
  const p = state.portfolio;
  let items = (p.items || []).slice();
  const q = state.filter.q.toLowerCase().trim();
  if (q) items = items.filter(i => i.name?.toLowerCase().includes(q) || i.set_num?.toLowerCase().includes(q) || i.theme?.toLowerCase().includes(q));
  switch (state.filter.sort) {
    case "added_desc": items.sort((a, b) => new Date(b.added_at) - new Date(a.added_at)); break;
    case "value_desc": items.sort((a, b) => b.current_value - a.current_value); break;
    case "roi_desc":   items.sort((a, b) => (b.annualized_roi ?? -1) - (a.annualized_roi ?? -1)); break;
    case "az":         items.sort((a, b) => a.name?.localeCompare(b.name)); break;
  }
  return items;
}

// Re-render ONLY the set list + wire its cards. Used by sort/search so the
// hero, chart and topbar don't flash from a full-page re-render.
function repaintSetList() {
  const list = $("#setList");
  if (!list) return;
  const items = sortedPortfolioItems();
  list.innerHTML = items.length === 0 ? emptyVaultHTML() : items.map(setListCardHTML).join("");
  $$(".set-list-card").forEach(card => {
    card.addEventListener("click", () => { haptic("light"); location.hash = "#/set/" + encodeURIComponent(card.dataset.set); });
    wireLongPress(card, () => showQuickActions(card.dataset.set));
  });
}

function paintPortfolio() {
  const p = state.portfolio;
  const hist = state.portfolioHistory || [];
  const alertsCount = state.wishlistAlerts.length;
  const gain = p.total_value - p.total_paid;
  const gainPct = p.total_paid ? gain / p.total_paid : 0;
  const totalVal = p.total_value_with_figs ?? p.total_value ?? 0;

  let items = sortedPortfolioItems();

  const ranges = { "1W": 7, "1M": 30, "3M": 90, "1Y": 365, "ALL": 999 };
  const days = ranges[state.filter.range] || 30;
  const clipped = hist.slice(-Math.min(days + 1, hist.length));

  $("#root").innerHTML = `
    <div class="page">
      <div class="topbar">
        <div class="brand">
          <div class="brand-mark"></div>
          <div class="brand-name">Brickvault</div>
        </div>
        <div class="topbar-actions">
          <button class="icon-btn" id="searchToggle" aria-label="Search">${I.search()}</button>
          <a href="#/wishlist" class="icon-btn" id="wishlistBtn" aria-label="Wishlist">
            ${I.heart()}
            ${state.wishlist.length > 0 ? `<span class="dot">${state.wishlist.length}</span>` : ""}
          </a>
          <button class="icon-btn" id="alertsBtn" aria-label="Alerts">
            ${I.bell()}
            ${alertsCount > 0 ? `<span class="dot">${alertsCount}</span>` : ""}
          </button>
        </div>
      </div>
      <div class="search-wrap${state.filter.q ? " open" : ""}" id="searchWrap">
        <span class="s-icon">${I.search()}</span>
        <input class="search-input" id="portfolioSearch" placeholder="Search your vault…" autocomplete="off" value="${escapeHtml(state.filter.q)}">
      </div>

      <div class="card hero" data-trend="${gain > 0 ? "up" : gain < 0 ? "down" : "flat"}">
        <div class="hero-eyebrow"><span class="pulse"></span>Vault · LIVE</div>
        <div class="hero-value" id="heroValue">${heroValueHTML(totalVal)}</div>
        <div class="hero-meta">
          <span>Invested ${fmtMoney(p.total_paid)}</span>
          <span class="delta ${gain >= 0 ? "up" : "down"}"><span class="arrow">${gain >= 0 ? "▲" : "▼"}</span>${fmtMoney(Math.abs(gain), { cents: 0 })} (${fmtPct(Math.abs(gainPct))})</span>
          ${p.fig_count > 0 ? `<span style="cursor:help;" title="Minifig collection value tracked separately">Figs: ${p.fig_count} (${fmtMoney(p.fig_value || 0)})</span>` : ""}
        </div>
        <div class="spark-wrap" id="heroChart"></div>
        <div class="range-pills" id="rangePills">
          ${["1W","1M","3M","1Y","ALL"].map(r => `<button data-r="${r}" class="${state.filter.range === r ? "active" : ""}">${r}</button>`).join("")}
        </div>
      </div>

      <div class="filter-row">
        ${[["added_desc","Recent"],["value_desc","By value"],["roi_desc","By ROI"],["az","A–Z"]]
          .map(([k,l]) => `<button class="chip ${state.filter.sort === k ? "active" : ""}" data-sort="${k}">${l}</button>`).join("")}
      </div>

      <div class="set-list" id="setList">
        ${items.length === 0 ? emptyVaultHTML() : items.map(setListCardHTML).join("")}
      </div>

      ${p.items.length > 0 ? `
        <button class="insights-toggle" id="insightsToggle">${I.trend()}<span>Insights</span>${I.chev()}</button>
        <div id="insightsPanel" style="display:none;"></div>` : ""}
    </div>`;

  setTimeout(() => drawSparkline($("#heroChart"), clipped, { up: gain >= 0 }), 30);
  animateHeroValue(totalVal);

  $$("#rangePills button").forEach(b => b.addEventListener("click", () => {
    state.filter.range = b.dataset.r; haptic("light");
    $$("#rangePills button").forEach(x => x.classList.toggle("active", x.dataset.r === state.filter.range));
    const d = ranges[state.filter.range] || 30;
    drawSparkline($("#heroChart"), hist.slice(-Math.min(d + 1, hist.length)), { up: gain >= 0 });
  }));
  $$(".filter-row .chip").forEach(c => c.addEventListener("click", () => {
    state.filter.sort = c.dataset.sort; localStorage.setItem("bv_sort", c.dataset.sort); haptic("light");
    $$(".filter-row .chip").forEach(x => x.classList.toggle("active", x.dataset.sort === state.filter.sort));
    repaintSetList();
  }));
  $("#searchToggle")?.addEventListener("click", () => {
    const w = $("#searchWrap");
    w.classList.toggle("open");
    if (w.classList.contains("open")) $("#portfolioSearch")?.focus();
    else { state.filter.q = ""; repaintSetList(); }
  });
  $("#portfolioSearch")?.addEventListener("input", debounce(e => { state.filter.q = e.target.value; repaintSetList(); }, 150));
  $("#alertsBtn")?.addEventListener("click", () => showAlertsSheet(state.wishlistAlerts));
  $$(".set-list-card").forEach(card => {
    card.addEventListener("click", () => { haptic("light"); location.hash = "#/set/" + encodeURIComponent(card.dataset.set); });
    wireLongPress(card, () => showQuickActions(card.dataset.set));
  });
  $("#insightsToggle")?.addEventListener("click", () => {
    const panel = $("#insightsPanel");
    const btn = $("#insightsToggle");
    if (!panel) return;
    haptic("light");
    const open = panel.style.display !== "none";
    panel.style.display = open ? "none" : "block";
    btn.classList.toggle("open", !open);
    if (!open) {
      panel.innerHTML = insightsHTML(p.items || []);
      wireInsightsTabs(p.items || []);
    }
  });
  refreshNavBadge();
}

function heroValueHTML(n) {
  if (n == null || isNaN(n)) return `<span>—</span>`;
  const whole = Math.floor(Math.abs(n)).toLocaleString("en-US");
  const cents = Math.abs(n % 1 * 100 | 0).toString().padStart(2, "0");
  const sign = n < 0 ? "-" : "";
  return `${sign}$${whole}<span class="cents">.${cents}</span>`;
}

// Animate the hero value counting up from ~0 to its real total. A short
// ease-out tick that feels alive without being slow. Skips under reduced motion.
function animateHeroValue(target) {
  const el = $("#heroValue");
  if (!el || target == null || isNaN(target) || target <= 0) return;
  if (prefersReducedMotion()) { el.innerHTML = heroValueHTML(target); return; }
  const dur = 750;
  const start = performance.now();
  const from = target * 0.82; // start near the value so it ticks up the last stretch
  const tick = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    el.innerHTML = heroValueHTML(from + (target - from) * eased);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function setListCardHTML(item) {
  const delta = item.purchase_price ? (item.current_value - item.purchase_price) / item.purchase_price : null;
  const cls = delta == null ? "flat" : delta >= 0 ? "up" : "down";
  const arrow = delta == null ? "" : delta >= 0 ? "▲" : "▼";
  const dStr = delta == null ? "—" : (delta * 100).toFixed(1) + "%";
  const newBadge = item.added_at && daysAgo(item.added_at) < 7;
  const tc = THEME_COLORS[item.theme] || null;
  const borderStyle = tc ? ` style="border-left-color:${tc};"` : "";
  return `
    <button class="set-list-card" data-set="${escapeHtml(item.set_num)}"${borderStyle}>
      ${slImgHTML(item, { newBadge, qtyBadge: item.quantity || 1 })}
      <div class="sl-body">
        <div class="sl-name">${escapeHtml(item.name)}</div>
        <div class="sl-meta">
          <span>${escapeHtml(item.theme || "")}</span>
          <span class="dot"></span>
          <span>${escapeHtml(item.set_num)}</span>
        </div>
      </div>
      <div class="sl-right">
        <div class="sl-value" style="display:flex;align-items:center;justify-content:flex-end;">${fmtMoney(item.current_value)}${item.trend ? trendBadgeHTML(item.trend) : ""}</div>
        <div class="sl-delta ${cls}"><span class="arrow">${arrow}</span>${dStr}</div>
      </div>
    </button>`;
}

function emptyVaultHTML() {
  return `
    <div class="empty card">
      <div class="empty-icon">${I.box()}</div>
      <h3>Build your vault</h3>
      <p>Scan a set, search the catalog, or browse below to start tracking your collection's value.</p>
      <a href="#/add" class="btn-primary">${I.plus()}<span>Add first set</span></a>
    </div>`;
}

function insightsHTML(items) {
  if (!items || !items.length) return `<p style="color:var(--ink-mute);font-size:14px;padding:8px 0;">Add sets to see insights.</p>`;

  return `
    <div class="insights-tabs" style="display:flex;gap:12px;border-bottom:1.5px solid var(--line-soft);margin-bottom:12px;padding-bottom:4px;">
      <button class="insights-tab active" data-tab="general" style="font-family:var(--mono);font-size:10px;text-transform:uppercase;padding:4px 8px;border:none;background:transparent;cursor:pointer;color:var(--ink-mute);font-weight:700;border-bottom:2px solid var(--ink);position:relative;bottom:-5px;">Overview</button>
      <button class="insights-tab" data-tab="cohort" style="font-family:var(--mono);font-size:10px;text-transform:uppercase;padding:4px 8px;border:none;background:transparent;cursor:pointer;color:var(--ink-mute);font-weight:500;">By Year</button>
    </div>
    <style>
      .insights-tab.active {
        color: var(--ink) !important;
        font-weight: 700 !important;
        border-bottom: 2px solid var(--ink) !important;
      }
    </style>
    <div class="insights-section" id="insightsTabContent">
      ${insightsGeneralHTML(items)}
    </div>`;
}

/* ============================================================
   Catalog (Add page)
   ============================================================ */
function catalogQuery() {
  const f = state.filter;
  const p = new URLSearchParams();
  p.set("limit", state.catalog.pageSize);
  p.set("offset", state.catalog.offset);
  p.set("sort", f.catalogSort);
  if (f.catalogQ) p.set("q", f.catalogQ);
  if (f.catalogTheme !== "all") p.set("theme", f.catalogTheme);
  if (f.catalogRetired) p.set("retired", "1");
  for (const [k, v] of Object.entries(f.catalogRanges)) {
    if (v !== "" && v != null) p.set(k, v);
  }
  return p.toString();
}

// Fetch a page of the catalog. reset=true starts over; otherwise appends.
// Returns the newly fetched rows so callers can append to the DOM.
let _catalogGen = 0;
async function loadCatalog({ reset = false } = {}) {
  const c = state.catalog;
  // reset=true always wins; non-reset (scroll) loads back off if one is already running.
  if (!reset && c.loading) return [];
  if (!reset && !c.hasMore) return [];
  if (reset) { _catalogGen++; c.offset = 0; c.hasMore = false; c.total = 0; }
  const myGen = _catalogGen;
  c.loading = true;
  try {
    const res = await api("/api/sets/search?" + catalogQuery());
    if (myGen !== _catalogGen) return []; // superseded by a newer reset
    const fresh = res.sets || [];
    c.items = reset ? fresh : c.items.concat(fresh);
    c.total = res.total ?? c.items.length;
    c.offset = c.items.length;
    c.hasMore = !!res.hasMore;
    return fresh;
  } catch (e) {
    if (myGen !== _catalogGen) return [];
    // Show retry inline inside the catalog page if it's open; otherwise silent.
    const results = $("#catalogResults");
    if (results) {
      results.innerHTML = `<div class="empty card" style="margin-top:16px;">
        <h3>Couldn't load catalog</h3>
        <p>${e.message}. Check your connection and try again.</p>
        <button class="btn-secondary" id="catalogRetry" style="margin-top:12px;">Retry</button>
      </div>`;
      $("#catalogRetry")?.addEventListener("click", async () => { await loadCatalog({ reset: true }); refreshCatalogGrid(); });
    }
    return [];
  } finally {
    if (myGen === _catalogGen) c.loading = false;
  }
}

function isCatalogDefault() {
  const f = state.filter;
  return !f.catalogQ && f.catalogTheme === 'all' && f.catalogYear === 'all' && !f.catalogRetired &&
    Object.values(f.catalogRanges || {}).every(v => v === '');
}

async function renderAdd() {
  if (!state.themes.length) {
    try { const t = await api("/api/themes"); state.themes = t.themes || []; state.themesLoadedAt = Date.now(); } catch {}
  }
  if (!state.catalog.items.length) {
    await loadCatalog({ reset: true });
    if (isCatalogDefault()) bvIDB.set('catalog', { data: { items: state.catalog.items, total: state.catalog.total, hasMore: state.catalog.hasMore, offset: state.catalog.offset }, ts: Date.now() }).catch(() => {});
  } else if (state.catalog._stale) {
    // IDB-hydrated data: paint instantly from cache, refresh only the grid in
    // the background. Using refreshCatalogGrid (not paintAdd) means the background
    // fetch can never overwrite whatever page the user may have navigated to.
    state.catalog._stale = false;
    loadCatalog({ reset: true }).then(() => {
      if (location.hash === '#/add' && $('#catalogResults')) {
        refreshCatalogGrid();
        if (isCatalogDefault()) bvIDB.set('catalog', { data: { items: state.catalog.items, total: state.catalog.total, hasMore: state.catalog.hasMore, offset: state.catalog.offset }, ts: Date.now() }).catch(() => {});
      }
    }).catch(() => {});
  }
  paintAdd();
}

const debouncedCatalogSearch = debounce(async () => {
  await loadCatalog({ reset: true });
  refreshCatalogGrid();
}, 350);

// Inner HTML for the catalog results region (count + grid/empty + sentinel).
function catalogResultsHTML() {
  const c = state.catalog;
  const f = state.filter;
  return `
    <div id="catalogCount" style="font-family:var(--mono);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-mute);margin:14px 4px 10px;">${c.total.toLocaleString()} result${c.total === 1 ? "" : "s"}</div>
    ${c.items.length === 0 ? `
      <div class="empty card">
        <div class="empty-icon">${I.search()}</div>
        <h3>No sets found</h3>
        <p>${f.catalogQ ? `Nothing matches "${escapeHtml(f.catalogQ)}".` : "No sets match these filters."} Try a different search or clear filters.</p>
      </div>` : `
      <div class="grid" id="catalogGrid">
        ${c.items.map(s => catalogCardHTML(s)).join("")}
      </div>
      <div id="catalogSentinel" class="load-sentinel" style="${c.hasMore ? "" : "display:none;"}">
        <div class="spinner"></div>
      </div>`}`;
}

// Re-render only the results region (preserves search focus + filter chips,
// so changing sort/theme/search doesn't flash the whole page).
function refreshCatalogGrid() {
  const results = $("#catalogResults");
  if (!results) return;
  results.innerHTML = catalogResultsHTML();
  wireCatalogCards();
  mountCatalogSentinel();
}

function wireCatalogCards() {
  $$(".set-card").forEach(c => c.addEventListener("click", () => { haptic("light"); location.hash = "#/set/" + encodeURIComponent(c.dataset.set); }));
}

// IntersectionObserver-driven infinite scroll.
function mountCatalogSentinel() {
  const grid = $("#catalogGrid");
  const sentinel = $("#catalogSentinel");
  if (!grid || !sentinel) return;
  if (state._catalogObserver) state._catalogObserver.disconnect();
  sentinel.style.display = state.catalog.hasMore ? "" : "none";
  if (!state.catalog.hasMore) return;
  state._catalogObserver = new IntersectionObserver(async (entries) => {
    if (!entries[0].isIntersecting || state.catalog.loading) return;
    const fresh = await loadCatalog();
    if (fresh.length) {
      grid.insertAdjacentHTML("beforeend", fresh.map(s => catalogCardHTML(s)).join(""));
      wireCatalogCards();
    }
    sentinel.style.display = state.catalog.hasMore ? "" : "none";
    if (!state.catalog.hasMore) state._catalogObserver.disconnect();
  }, { rootMargin: "400px" });
  state._catalogObserver.observe(sentinel);
}

function paintAdd() {
  const f = state.filter;
  const c = state.catalog;

  $("#root").innerHTML = `
    <div class="page">
      <div class="topbar">
        <div class="topbar-heading">
          <div class="topbar-eyebrow">Catalog</div>
          <div class="topbar-title">Find a set</div>
        </div>
      </div>

      <button class="scan-cta" id="scanCta">
        <div class="scan-cta-icon">${I.scan()}</div>
        <div class="scan-cta-text">
          <div class="t1">Scan with camera</div>
          <div class="t2">Barcode or photo · AI identifies any set</div>
        </div>
        <div class="scan-cta-arrow">${I.arrowR()}</div>
      </button>

      <div class="search-wrap open" style="margin-bottom:14px;">
        <span class="s-icon">${I.search()}</span>
        <input class="search-input" id="catalogSearch" placeholder="Search sets…" autocomplete="off" value="${escapeHtml(f.catalogQ)}">
      </div>

      <div class="filter-row">
        <button class="chip ${f.catalogTheme === "all" ? "active" : ""}" data-cat-theme="all">All themes</button>
        ${state.themes.slice(0, 8).map(t => `<button class="chip ${f.catalogTheme === t ? "active" : ""}" data-cat-theme="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("")}
      </div>

      <div class="filter-row" style="margin-top:-4px;">
        ${[["value_desc","Top value"],["roi_desc","Best growth"],["year_desc","Newest"],["az","A–Z"]]
          .map(([k,l]) => `<button class="chip ${f.catalogSort === k ? "active" : ""}" data-csort="${k}">${l}</button>`).join("")}
        <button class="chip ${f.catalogRetired ? "active" : ""}" data-retired="1">${I.tag()}<span>Retired</span></button>
        <button class="chip ${catalogRangesActive() ? "active" : ""}" id="filterChip">${I.filter()}<span>Filters${catalogRangesActive() ? " · " + catalogRangesActive() : ""}</span></button>
      </div>

      <div id="catalogResults">${catalogResultsHTML()}</div>
    </div>`;

  $("#scanCta")?.addEventListener("click", () => openScan());
  const catInput = $("#catalogSearch");
  catInput?.addEventListener("input", (e) => {
    state.filter.catalogQ = e.target.value;
    debouncedCatalogSearch();
  });
  // Update chips' active state + repaint only the results region — no full reload.
  const reloadGrid = async () => { await loadCatalog({ reset: true }); refreshCatalogGrid(); };
  // NB: scope to the catalog page. A bare [data-theme] selector would also match
  // the <html data-theme="light|dark"> color-theme attribute, attaching this
  // handler to the document root — then any click anywhere bubbled up and reset
  // the catalog filter to the (nonexistent) theme "light", blanking the grid.
  $$("[data-cat-theme]").forEach(b => b.addEventListener("click", () => {
    state.filter.catalogTheme = b.dataset.catTheme; haptic("light");
    $$("[data-cat-theme]").forEach(x => x.classList.toggle("active", x.dataset.catTheme === state.filter.catalogTheme));
    reloadGrid();
  }));
  $$("[data-csort]").forEach(b => b.addEventListener("click", () => {
    state.filter.catalogSort = b.dataset.csort; haptic("light");
    $$("[data-csort]").forEach(x => x.classList.toggle("active", x.dataset.csort === state.filter.catalogSort));
    reloadGrid();
  }));
  $$("[data-retired]").forEach(b => b.addEventListener("click", () => {
    state.filter.catalogRetired = !state.filter.catalogRetired; haptic("light");
    b.classList.toggle("active", state.filter.catalogRetired);
    reloadGrid();
  }));
  $("#filterChip")?.addEventListener("click", () => showFilterSheet(reloadGrid));
  wireCatalogCards();
  mountCatalogSentinel();
}

// Count how many advanced range filters are active (0 → falsy).
function catalogRangesActive() {
  return Object.values(state.filter.catalogRanges).filter(v => v !== "" && v != null).length;
}

// Bottom sheet with year / pieces / value range inputs for the catalog.
function showFilterSheet(onApply) {
  const r = state.filter.catalogRanges;
  const rangeField = (label, minKey, maxKey, ph1, ph2) => `
    <div class="field" style="margin-bottom:14px;">
      <div class="field-lbl">${label}</div>
      <div class="range-inputs">
        <input type="number" inputmode="numeric" id="f_${minKey}" value="${r[minKey]}" placeholder="${ph1}">
        <span class="range-dash">–</span>
        <input type="number" inputmode="numeric" id="f_${maxKey}" value="${r[maxKey]}" placeholder="${ph2}">
      </div>
    </div>`;
  showSheet(`
    <div style="font-family:var(--serif);font-size:22px;font-weight:500;margin:0 4px 16px;">Filters</div>
    ${rangeField("Year", "min_year", "max_year", "1970", String(new Date().getFullYear()))}
    ${rangeField("Pieces", "min_pieces", "max_pieces", "0", "10000+")}
    ${rangeField("Value ($)", "min_value", "max_value", "0", "9999+")}
    <button class="btn-primary" id="fApply" style="margin-top:6px;">${I.check()}<span>Apply filters</span></button>
    <button class="btn-secondary" id="fClear" style="margin-top:8px;">Clear all</button>`);
  const refreshChip = () => {
    const chip = $("#filterChip");
    if (!chip) return;
    const n = catalogRangesActive();
    chip.classList.toggle("active", !!n);
    const lbl = chip.querySelector("span");
    if (lbl) lbl.textContent = "Filters" + (n ? " · " + n : "");
  };
  $("#fApply").addEventListener("click", () => {
    for (const k of Object.keys(state.filter.catalogRanges)) {
      const v = $("#f_" + k)?.value.trim();
      state.filter.catalogRanges[k] = v === "" ? "" : (parseInt(v, 10) || "");
    }
    haptic("medium");
    hideSheet();
    refreshChip();
    onApply();
  });
  $("#fClear").addEventListener("click", () => {
    for (const k of Object.keys(state.filter.catalogRanges)) state.filter.catalogRanges[k] = "";
    haptic("light");
    hideSheet();
    refreshChip();
    onApply();
  });
}

function catalogCardHTML(s) {
  const hasImg = s.image_url && !s.image_url.startsWith("data:");
  const h = setHue(s);
  return `
    <button class="set-card" data-set="${escapeHtml(s.set_num)}">
      <div class="set-card-img${hasImg ? " has-photo" : ""}">
        <div class="brick-tile" style="--h:${h};width:64%;height:64%;"></div>
        ${hasImg ? `<img class="set-photo" src="${escapeHtml(s.image_url)}" alt="" loading="lazy">` : ""}
        ${s.retired ? `<span class="retired-tag">RETIRED</span>` : ""}
        ${(s.retirement_risk_score || 0) >= 70 && !s.retired ? `<span class="retire-risk-badge">🔥</span>` : ""}
        ${s.owned ? `<span class="owned-tag">${I.check()}OWNED</span>` : ""}
      </div>
      <div class="set-card-body">
        <div class="set-card-name">${escapeHtml(s.name)}</div>
        <div class="set-card-meta">
          ${THEME_COLORS[s.theme] ? `<span class="theme-dot" style="background:${THEME_COLORS[s.theme]};"></span>` : ""}
          <span>${s.year || ""}</span>
          <span>${s.pieces || 0}pc</span>
          ${s.minifigs > 0 ? `<span>${s.minifigs} fig</span>` : ""}
        </div>
        <div class="set-card-value" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;">
          <span>${fmtMoney(s.current_value)}</span>
          ${s.trend ? trendBadgeHTML(s.trend) : ""}
        </div>
      </div>
    </button>`;
}

/* ============================================================
   Set detail
   ============================================================ */
async function renderSetDetail(setNum) {
  const hit = state.detail.cache[setNum];
  const now = Date.now();
  if (hit && now - hit.ts < 300_000) {
    paintSetDetail(hit.set, hit.entry);
    api("/api/sets/" + encodeURIComponent(setNum))
      .then(data => {
        const set = data.set || data;
        const entry = data.entry || null;
        state.detail.cache[setNum] = { set, entry, ts: Date.now() };
        if (location.hash.includes(setNum)) paintSetDetail(set, entry);
      }).catch(() => {});
    return;
  }
  try {
    const data = await api("/api/sets/" + encodeURIComponent(setNum));
    const set = data.set || data;
    const entry = data.entry || null;
    state.detail.cache[setNum] = { set, entry, ts: Date.now() };
    paintSetDetail(set, entry);
  } catch (e) {
    $("#root").innerHTML = `<div class="page"><p>Set not found.</p></div>`;
  }
}

function paintSetDetail(set, entry) {
  const isWish = state.wishlist.some(w => w.set_num === set.set_num);
  const owned = !!entry;
  const h = setHue(set);
  const hasImg = set.image_url && !set.image_url.startsWith("data:");

  $("#root").innerHTML = `
    <div class="page no-pad detail-page-container">
      <div class="detail-hero-col">
        <button class="detail-back" id="detailBack" aria-label="Back">${I.chevL()}</button>
        <div class="detail-hero${hasImg ? " has-photo" : ""}">
          ${hasImg
            ? `<div class="detail-hero-bg" style="background-image:url('${escapeHtml(set.image_url)}')"></div>`
            : `<div class="detail-hero-bg placeholder" style="--brick-hue:linear-gradient(135deg, oklch(0.72 0.13 ${h}), oklch(0.55 0.13 ${h}));"></div>`}
          <div class="detail-hero-overlay"></div>
          <div class="detail-img${hasImg ? " has-photo" : ""}">
            <div class="brick-art" style="--brick-color:oklch(0.72 0.13 ${h});">${escapeHtml(set.set_num)}</div>
            ${hasImg ? `<img class="set-photo" src="${escapeHtml(set.image_url)}" alt="">` : ""}
          </div>
        </div>
      </div>
      <div class="detail-content-col">
        <div class="detail-title-row">
          <div>
            <div class="detail-eyebrow">${escapeHtml(set.theme || "")} · #${escapeHtml(set.set_num)}${set.retired ? " · RETIRED" : ""}</div>
            <div class="detail-title">${escapeHtml(set.name)}</div>
          </div>
          <button class="detail-share-btn icon-btn" id="shareBtn" aria-label="Share">${I.share()}</button>
        </div>
        <div class="detail-tabs" id="detailTabs">
          ${["info","forecast","manage"].filter(t => t !== "manage" || owned).map(t =>
            `<button data-tab="${t}" class="${state.detail.tab === t ? "active" : ""}">${t[0].toUpperCase()+t.slice(1)}</button>`
          ).join("")}
        </div>
        <div class="detail-tab-panel" id="tabPanels">
          ${state.detail.tab === "info" ? infoTabHTML(set, entry, isWish) :
            state.detail.tab === "forecast" ? forecastTabHTML(set) :
            manageTabHTML(set, entry)}
        </div>
      </div>
    </div>`;

  $("#detailBack")?.addEventListener("click", () => { if (history.length > 1) history.back(); else location.hash = "#/"; });
  $("#shareBtn")?.addEventListener("click", () => shareSet(set));
  $$("#detailTabs button").forEach(b => b.addEventListener("click", () => {
    state.detail.tab = b.dataset.tab; haptic("light"); paintSetDetail(set, entry);
  }));
  if (state.detail.tab === "info") wireInfoTab(set, entry);
  else if (state.detail.tab === "manage") wireManageTab(set, entry);
  setupTabSwipe(set, entry);
}

function infoTabHTML(set, entry, isWish) {
  const owned = !!entry;
  const delta = entry && entry.purchase_price ? (set.current_value - entry.purchase_price) / entry.purchase_price : null;
  const valueSource = set.valuation_method === "market" ? "BrickLink"
    : set.valuation_method === "ai" ? "AI estimate" : "Estimated";
  return `
    ${priceStripHTML(set, entry)}
    <div class="stat-grid">
      <div class="stat-cell">
        <div class="lbl">${I.dollar()}Market (new)</div>
        <div class="val s">${set.current_value ? fmtMoney(set.current_value) : "—"}</div>
        ${delta != null ? `<div class="delta ${delta >= 0 ? "up" : "down"}" style="margin-top:6px;"><span class="arrow">${delta >= 0 ? "▲" : "▼"}</span>${fmtPct(Math.abs(delta))}</div>` : ""}
        <div style="font-family:var(--mono);font-size:10px;color:var(--ink-mute);margin-top:4px;letter-spacing:0.08em;">${valueSource}</div>
      </div>
      <div class="stat-cell">
        <div class="lbl">${I.tag()}Retail</div>
        <div class="val s">${fmtMoney(set.retail_price)}</div>
        <div style="font-family:var(--mono);font-size:10px;color:var(--ink-mute);margin-top:4px;letter-spacing:0.08em;">${set.year || ""} · MSRP</div>
      </div>
      <div class="stat-cell">
        <div class="lbl">${I.box()}Pieces</div>
        <div class="val s">${(set.pieces || 0).toLocaleString()}</div>
      </div>
      <div class="stat-cell">
        <div class="lbl">${I.figure()}Minifigs</div>
        <div class="val s">${set.minifigs || 0}</div>
      </div>
    </div>

    <div class="card" style="padding:14px 16px;margin-bottom:14px;">
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-mute);margin-bottom:8px;">Price history · 90d</div>
      <div class="spark-wrap" id="setSpark" style="height:60px;"></div>
    </div>

    ${owned ? `
      <div class="qty-row">
        <div>
          <div class="qty-row-lbl">In your vault</div>
          <div class="qty-row-val">×${entry.quantity}</div>
        </div>
        <div class="qty-stepper">
          <button class="qty-btn" id="qtyDown">${I.minus()}</button>
          <div class="qty-num" id="qtyNum">${entry.quantity}</div>
          <button class="qty-btn" id="qtyUp">${I.plus()}</button>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn-secondary" id="wishToggle">
          ${isWish ? I.heartF() : I.heart()}
          <span>${isWish ? "Wishlisted" : "Wishlist"}</span>
        </button>
        <a class="btn-secondary" href="#/set/${encodeURIComponent(set.set_num)}/manage">
          ${I.gear()}<span>Manage</span>
        </a>
      </div>
    ` : `
      <button class="btn-primary" id="addBtn">${I.plus()}<span>Add to vault · ${fmtMoney(set.current_value, { cents: 0 })}</span></button>
      <button class="btn-secondary" id="wishToggle" style="margin-top:8px;">
        ${isWish ? I.heartF() : I.heart()}
        <span>${isWish ? "Remove from wishlist" : "Add to wishlist"}</span>
      </button>
    `}
    <a class="bl-buy-link" href="${bricklinkBuyURL(set.set_num)}" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:6px;font-size:12px;color:var(--ink-mute);text-decoration:underline;margin-top:14px;">
      View on BrickLink ${I.extLink()}
    </a>`;
}

function wireInfoTab(set, entry) {
  loadSetHistory(set.set_num);
  $("#btnRevalue")?.addEventListener("click", () => triggerRevalue(set.set_num));

  let qty = entry?.quantity || 1;
  $("#qtyDown")?.addEventListener("click", async () => {
    if (qty <= 1) return;
    haptic("medium");
    qty--;
    $("#qtyNum").textContent = qty;
    try { await api("/api/collection/" + entry.id, { method: "PATCH", body: { quantity: qty } }); state.portfolio = null; }
    catch (e) { toast("Save failed", "error"); }
  });
  $("#qtyUp")?.addEventListener("click", async () => {
    haptic("medium");
    qty++;
    $("#qtyNum").textContent = qty;
    try { await api("/api/collection/" + entry.id, { method: "PATCH", body: { quantity: qty } }); state.portfolio = null; }
    catch (e) { toast("Save failed", "error"); }
  });
  $("#addBtn")?.addEventListener("click", async (e) => {
    if (state.pendingRequests.has(set.set_num)) return;
    state.pendingRequests.add(set.set_num);
    haptic("heavy");
    setBtnLoading(e.currentTarget, true);
    try {
      const prevCount = state.portfolio?.items?.length ?? 0;
      const prevValue = state.portfolio?.total_value ?? 0;
      await api("/api/collection", { method: "POST", body: { set_num: set.set_num, quantity: 1, purchase_price: set.current_value } });
      state.portfolio = null; state.catalogAll = null;
      toast("Added to vault", "success");
      // Milestone detection
      const newCount = prevCount + 1;
      const newValue = prevValue + (Number(set.current_value) || 0);
      const countMs = [[1,"Your first set! Welcome to Brickvault!"],[10,"10 sets in the vault!"],[25,"25 sets! Nice collection."],[50,"50 sets! Dedicated collector 🏅"],[100,"100 sets! Elite collector 🏆"]];
      const valueMs = [[1000,"$1,000 portfolio milestone!"],[5000,"$5,000 portfolio!"],[10000,"$10,000 portfolio 💰"],[50000,"$50,000 — serious money 🤑"]];
      for (const [n, msg] of countMs) {
        if (prevCount < n && newCount >= n) { haptic("heavy"); setTimeout(() => { toast(msg, "milestone"); confettiBurst(); }, 700); break; }
      }
      for (const [v, msg] of valueMs) {
        if (prevValue < v && newValue >= v) { haptic("heavy"); setTimeout(() => { toast(msg, "milestone"); confettiBurst(); }, 1100); break; }
      }
      const r = await api("/api/sets/" + encodeURIComponent(set.set_num));
      state.detail.cache[set.set_num] = { set: r.set || r, entry: r.entry || null, ts: Date.now() };
      paintSetDetail(r.set || r, r.entry || null);
    } catch (e) {
      setBtnLoading($("#addBtn"), false);
      if (!navigator.onLine) {
        outboxEnqueue({ path: '/api/collection', method: 'POST', body: { set_num: set.set_num, quantity: 1, purchase_price: set.current_value } });
        toast('Saved offline — will sync when connected', 'info');
      } else { toast("Error: " + e.message, "error"); }
    } finally { state.pendingRequests.delete(set.set_num); }
  });
  $("#wishToggle")?.addEventListener("click", async () => {
    const wishKey = 'wish_' + set.set_num;
    if (state.pendingRequests.has(wishKey)) return;
    state.pendingRequests.add(wishKey);
    haptic("medium");
    const alreadyWished = state.wishlist.some(w => w.set_num === set.set_num);
    try {
      if (alreadyWished) {
        const w = state.wishlist.find(x => x.set_num === set.set_num);
        if (w) await api("/api/wishlist/" + w.id, { method: "DELETE" });
        state.wishlist = state.wishlist.filter(x => x.set_num !== set.set_num);
        toast("Removed from wishlist", "info");
      } else {
        const res = await api("/api/wishlist", { method: "POST", body: { set_num: set.set_num } });
        state.wishlist = [...state.wishlist, res];
        toast("Added to wishlist", "success");
      }
      paintSetDetail(set, entry);
    } catch (e) { toast("Error: " + e.message, "error"); }
    finally { state.pendingRequests.delete(wishKey); }
  });
}

function forecastTabHTML(set) {
  const g2 = set.forecast_2y && set.current_value ? (set.forecast_2y - set.current_value) / set.current_value : 0.18;
  const g5 = set.forecast_5y && set.current_value ? (set.forecast_5y - set.current_value) / set.current_value : 0.45;
  const pct = (g) => Math.min(100, Math.max(8, g * 100 + 12)).toFixed(1);
  const forecastLabel = set.valuation_method === "market" ? "Market value · BrickLink"
    : set.valuation_method === "ai" ? "AI forecast · GPT-4o-mini" : "Estimated";
  return `
    <div class="card" style="padding:14px 16px;margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        ${I.sparkles()}
        <div style="font-family:var(--mono);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-mute);">${forecastLabel}</div>
      </div>
      <p style="margin:6px 0 0;font-size:13px;color:var(--ink-soft);line-height:1.45;">
        ${set.valuation_method === "market"
          ? "Based on recent completed sales on BrickLink."
          : `Based on theme rarity, piece count, retirement status, and market trends for similar ${escapeHtml(set.theme || "")} sets.`}
      </p>
    </div>

    <div class="forecast-card">
      <div class="fh">
        <div class="fh-lbl">2-year forecast</div>
        <div class="fh-val">${fmtMoney(set.forecast_2y)}</div>
      </div>
      <div class="forecast-bar"><div style="--fill:${pct(g2)}%;"></div></div>
      <div class="forecast-pct${g2 < 0 ? " down" : ""}">${g2 >= 0 ? I.arrowU() : I.arrowD()}${fmtPct(g2)} projected</div>
    </div>

    <div class="forecast-card">
      <div class="fh">
        <div class="fh-lbl">5-year forecast</div>
        <div class="fh-val">${fmtMoney(set.forecast_5y)}</div>
      </div>
      <div class="forecast-bar"><div style="--fill:${pct(g5)}%;"></div></div>
      <div class="forecast-pct${g5 < 0 ? " down" : ""}">${g5 >= 0 ? I.arrowU() : I.arrowD()}${fmtPct(g5)} projected</div>
    </div>

    <div class="card" style="background:var(--surface-2);margin-top:14px;">
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-mute);margin-bottom:8px;">Confidence factors</div>
      <ul style="margin:0;padding-left:18px;font-size:13px;color:var(--ink-soft);line-height:1.55;">
        <li>${set.retired ? "Retired — supply is fixed" : "Active — value tied to retail"}</li>
        <li>${(set.pieces||0) > 2000 ? "Large set, high collector appeal" : (set.pieces||0) > 500 ? "Mid-size set, moderate appeal" : "Compact set, lower aftermarket premium"}</li>
        <li>${(set.minifigs||0) >= 5 ? "Many minifigs — strong parts-out potential" : "Few/no minifigs — value driven by set alone"}</li>
      </ul>
    </div>`;
}

function manageTabHTML(set, entry) {
  if (!entry) return `<p style="color:var(--ink-mute);">Not in your vault.</p>`;
  return `
    <div class="field">
      <div class="field-lbl">Purchase price</div>
      <input id="mPrice" type="number" step="0.01" value="${entry.purchase_price ?? ""}" placeholder="0.00">
    </div>
    <div class="field">
      <div class="field-lbl">Purchase date</div>
      <input id="mDate" type="date" value="${entry.purchased_at ? entry.purchased_at.slice(0,10) : ""}">
    </div>
    <div class="field">
      <div class="field-lbl">Condition</div>
      <select id="mCondition">
        <option value="sealed" ${entry.condition === "sealed" ? "selected" : ""}>Sealed (MISB)</option>
        <option value="new" ${entry.condition === "new" ? "selected" : ""}>New, opened</option>
        <option value="used_good" ${entry.condition === "used_good" ? "selected" : ""}>Used — good</option>
        <option value="used_acceptable" ${entry.condition === "used_acceptable" ? "selected" : ""}>Used — acceptable</option>
      </select>
    </div>
    <div class="field">
      <div class="field-lbl">Notes</div>
      <textarea id="mNotes" placeholder="Story, details, anything…">${escapeHtml(entry.notes || "")}</textarea>
    </div>
    <div class="field">
      <div class="field-lbl">Storage location</div>
      <input id="mStorage" type="text" value="${escapeHtml(entry.storage_location || "")}" placeholder="e.g. Display shelf A3, Attic box 2" list="storageLocations">
      <datalist id="storageLocations"></datalist>
    </div>
    <div class="field">
      <div class="field-lbl">Acquisition source</div>
      <select id="mAcquisition">
        <option value="" ${!entry.acquisition_source ? "selected" : ""}>— select —</option>
        ${["Store","BrickLink","eBay","Facebook Marketplace","Trade","Gift","Other"].map(s =>
          `<option value="${s}" ${entry.acquisition_source === s ? "selected" : ""}>${s}</option>`
        ).join("")}
      </select>
    </div>
    <div class="field">
      <div class="field-lbl">Completeness</div>
      <div class="completeness-row">
        <label><input type="checkbox" id="mComplete" ${entry.is_complete !== false ? "checked" : ""}>Complete / all pieces present</label>
      </div>
      <div class="missing-pieces-wrap" id="missingWrap" style="${entry.is_complete === false ? "" : "display:none;"}">
        <input type="number" id="mMissing" min="0" value="${entry.missing_pieces || 0}" placeholder="0">
        <span style="font-size:13px;color:var(--ink-mute);">pieces missing</span>
      </div>
    </div>
    <div id="mFlipCalcContainer">${flipCalcHTML(set, entry)}</div>
    <button class="btn-danger" id="mRemove" style="margin-top:14px;">${I.trash()}<span>Remove from vault</span></button>
    <button class="btn-secondary" id="mListSale" style="margin-top:8px;">${I.tag()}<span>List for Sale</span></button>`;
}

function wireManageTab(set, entry) {
  if (!entry) return;

  // Populate storage-location datalist from existing collection locations
  const dl = $("#storageLocations");
  if (dl && state.portfolio?.items) {
    const locs = [...new Set((state.portfolio.items).map(i => i.storage_location).filter(Boolean))];
    dl.innerHTML = locs.map(l => `<option value="${escapeHtml(l)}">`).join("");
  }

  function updateLocalFlip() {
    const priceVal = $("#mPrice")?.value || "";
    const condVal = $("#mCondition")?.value || "new";
    const tempEntry = { ...entry, purchase_price: parseFloat(priceVal) || 0, condition: condVal };
    const container = $("#mFlipCalcContainer");
    if (container) {
      container.innerHTML = flipCalcHTML(set, tempEntry);
    }
  }

  async function persist() {
    try {
      const isComplete = $("#mComplete")?.checked ?? true;
      await api("/api/collection/" + entry.id, {
        method: "PATCH",
        body: {
          purchase_price: parseFloat($("#mPrice")?.value) || null,
          purchased_at: $("#mDate")?.value ? new Date($("#mDate").value).toISOString() : entry.purchased_at,
          condition: $("#mCondition")?.value,
          notes: $("#mNotes")?.value || "",
          storage_location: $("#mStorage")?.value || null,
          acquisition_source: $("#mAcquisition")?.value || null,
          is_complete: isComplete,
          missing_pieces: isComplete ? 0 : (parseInt($("#mMissing")?.value) || 0),
        }
      });
      state.portfolio = null;
      delete state.detail.cache[set.set_num];
      toast("Saved", "success");
    } catch (e) { toast("Save failed: " + e.message, "error"); }
  }

  // Toggle missing-pieces input when completeness changes
  $("#mComplete")?.addEventListener("change", e => {
    const w = $("#missingWrap");
    if (w) w.style.display = e.target.checked ? "none" : "";
    persist();
  });

  ["#mPrice","#mDate","#mStorage","#mMissing"].forEach(s => $(s)?.addEventListener("blur", persist));
  ["#mCondition","#mAcquisition"].forEach(s => $(s)?.addEventListener("change", persist));
  $("#mNotes")?.addEventListener("blur", persist);

  $("#mPrice")?.addEventListener("input", updateLocalFlip);
  $("#mCondition")?.addEventListener("change", updateLocalFlip);

  $("#mRemove")?.addEventListener("click", async () => {
    if (!(await confirmSheet({ title: "Remove from vault?", message: "This set will be removed from your collection.", confirmLabel: "Remove", danger: true }))) return;
    haptic("heavy");
    try {
      await api("/api/collection/" + entry.id, { method: "DELETE" });
      state.portfolio = null;
      delete state.detail.cache[set.set_num];
      toast("Removed from vault", "info");
      if (history.length > 1) history.back();
      else location.hash = "#/";
    } catch (e) {
      if (!navigator.onLine && entry?.id) {
        outboxEnqueue({ path: '/api/collection/' + entry.id, method: 'DELETE' });
        state.portfolio = null;
        toast('Removed offline — will sync when connected', 'info');
        if (history.length > 1) history.back(); else location.hash = '#/';
      } else { toast("Error: " + e.message, "error"); }
    }
  });
  $("#mListSale")?.addEventListener("click", () => showListingSheet(set, entry));
}

function setupTabSwipe(set, entry) {
  const el = $("#tabPanels"); if (!el) return;
  if (_swipeAc) _swipeAc.abort();
  _swipeAc = new AbortController();
  const { signal } = _swipeAc;
  let sx = 0, sy = 0, active = false;
  el.addEventListener("touchstart", e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; active = true; }, { passive: true, signal });
  el.addEventListener("touchend", e => {
    if (!active) return; active = false;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const owned = !!entry;
      const tabs = owned ? ["info","forecast","manage"] : ["info","forecast"];
      const idx = tabs.indexOf(state.detail.tab);
      const next = clamp(idx + (dx < 0 ? 1 : -1), 0, tabs.length - 1);
      if (next !== idx) { state.detail.tab = tabs[next]; haptic("light"); paintSetDetail(set, entry); }
    }
  }, { signal });
}

/* ============================================================
   Wishlist screen
   ============================================================ */
async function renderWishlist() {
  try {
    const wl = await api("/api/wishlist");
    state.wishlist = wl.wishlist || [];
    state.wishlistAlerts = wl.unread_alerts || [];
  } catch (e) { toast("Couldn't load wishlist", "error"); }

  const alerts = [...(state.wishlistAlerts || [])];
  const spikeAlerts = alerts.filter(a => a.alert_type === "spike");
  const dropAlerts = alerts.filter(a => a.alert_type !== "spike");
  const totalAlerts = alerts.length;

  if (state.wishlistAlerts && state.wishlistAlerts.length > 0) {
    state.wishlistAlerts = [];
    refreshNavBadge();
    alerts.forEach(a => {
      api(`/api/wishlist/${a.id}`, { method: "POST" }).catch(err => console.error("Failed to mark alert as read:", err));
    });
  }

  $("#root").innerHTML = `
    <div class="page">
      <div class="topbar">
        <a href="#/" class="icon-btn" aria-label="Back" style="margin-top:2px;margin-right:8px;">${I.chevL()}</a>
        <div class="topbar-heading">
          <div class="topbar-eyebrow">${state.wishlist.length} sets · ${totalAlerts} alert${totalAlerts !== 1 ? "s" : ""}</div>
          <div class="topbar-title">Wishlist</div>
        </div>
      </div>

      ${spikeAlerts.length > 0 ? `
        <div class="section-title">Sell Opportunities 💰</div>
        <div style="margin-bottom:14px;">
          ${spikeAlerts.map(a => spikeAlertCardHTML(a)).join("")}
        </div>` : ""}

      ${dropAlerts.length > 0 ? `
        <div class="section-title">Price Drops 📉</div>
        <div style="margin-bottom:14px;">
          ${dropAlerts.map(a => `
            <div class="alert-card">
              <div class="ah">${I.bell()}Price drop · ${daysAgo(a.triggered_at)}d ago</div>
              <div style="font-weight:600;">${escapeHtml(a.set_name)}</div>
              <div style="font-size:13px;margin-top:4px;">Now <strong>${fmtMoney(a.current_value)}</strong> — your target was ${fmtMoney(a.target_price)}.</div>
            </div>`).join("")}
        </div>` : ""}

      ${state.wishlist.length === 0 ? `
        <div class="empty card">
          <div class="empty-icon">${I.heart()}</div>
          <h3>Nothing wishlisted yet</h3>
          <p>Tap the heart on any set to watch it. We'll alert you when the price hits your target.</p>
        </div>` : `
        <div>${state.wishlist.map(wishlistCardHTML).join("")}</div>`}
    </div>`;

  $$(".wishlist-card").forEach(c => c.addEventListener("click", () => {
    location.hash = "#/set/" + encodeURIComponent(c.dataset.set);
  }));
  $$(".spike-alert[data-set]").forEach(c => c.addEventListener("click", (e) => {
    if (e.target.tagName === "A") return;
    location.hash = "#/set/" + encodeURIComponent(c.dataset.set);
  }));
}

function wishlistCardHTML(w) {
  const gap = w.target_price ? ((w.current_value - w.target_price) / w.target_price) : null;
  const hit = gap != null && gap <= 0;
  const progress = gap == null ? 100 : Math.min(100, Math.max(0, 100 - gap * 100));
  const h = setHue(w);
  const hasImg = w.image_url && !w.image_url.startsWith("data:");
  return `
    <div class="wishlist-card" data-set="${escapeHtml(w.set_num)}" style="cursor:pointer;position:relative;">
      <div class="sl-img has-tile${hasImg ? " has-photo" : ""}" style="width:72px;height:76px;">
        <div class="brick-tile" style="--h:${h};width:100%;height:76%;margin-top:auto;"></div>
        ${hasImg ? `<img class="set-photo" src="${escapeHtml(w.image_url)}" alt="" loading="lazy">` : ""}
      </div>
      <div class="sl-body" style="flex:1;text-align:left;padding-right:32px;">
        <div class="sl-name">${escapeHtml(w.name || w.set_num)}</div>
        <div class="sl-meta">
          <span>${escapeHtml(w.theme || "")}</span>
          <span class="dot"></span>
          <span>${escapeHtml(w.set_num)}</span>
        </div>
        <div class="gap-row">
          <span style="color:var(--ink-mute);">Now ${fmtMoney(w.current_value, { cents: 0 })}</span>
          <span style="color:${hit ? "var(--up)" : "var(--ink)"};font-weight:700;">${hit ? "AT TARGET" : "Target " + fmtMoney(w.target_price || 0, { cents: 0 })}</span>
        </div>
        <div class="progress${hit ? " over" : ""}"><div style="width:${progress}%;"></div></div>
        ${(w.retirement_risk_score || 0) >= 70 && !w.retired ? `<div style="font-size:11px;color:var(--down);margin-top:4px;font-family:var(--mono);">⚠️ Retirement risk: High</div>` : ""}
      </div>
      <a href="${bricklinkBuyURL(w.set_num)}" target="_blank" rel="noopener" class="bl-badge" style="position:absolute;bottom:10px;right:10px;z-index:5;font-size:10px;font-family:var(--mono);font-weight:700;padding:2px 5px;background:var(--bv-yellow);color:#000;border:1.5px solid var(--line);border-radius:var(--r-1);text-decoration:none;" onclick="event.stopPropagation();">BL ↗</a>
    </div>`;
}

/* ============================================================
   Me (profile)
   ============================================================ */
async function renderMe() {
  let me = state.me;
  if (!me) {
    try { me = await api("/api/me"); state.me = me; }
    catch (e) { toast("Couldn't load profile", "error"); me = { display_name: "Collector", handle: "you", notify_price_drops: true, portfolio_stats: {} }; }
  }
  const c = me.portfolio_stats || {};
  const gain = (c.total_value || 0) - (c.total_paid || 0);
  const gainPct = c.total_paid ? gain / c.total_paid : 0;
  const savedGeminiKey = localStorage.getItem('bv_gemini_key') || '';
  const savedOpenAIKey = localStorage.getItem('bv_openai_key') || '';

  $("#root").innerHTML = `
    <div class="page">
      <div class="topbar">
        <div class="topbar-heading">
          <div class="topbar-eyebrow">@${escapeHtml(me.handle || "you")}</div>
          <div class="topbar-title">Profile</div>
        </div>
      </div>

      <div class="profile-head">
        <div class="avatar">${(me.display_name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}</div>
        <div style="flex:1;min-width:0;">
          <div class="profile-name">${escapeHtml(me.display_name || "Collector")}</div>
          <div class="profile-handle">Member · Brickvault</div>
        </div>
        <button class="profile-pencil" aria-label="Edit name" id="editName">${I.pencil()}</button>
      </div>

      <div class="summary-grid">
        <div class="summary-cell"><div class="lbl">Sets owned</div><div class="val">${c.set_count || 0}</div></div>
        <div class="summary-cell"><div class="lbl">Total value</div><div class="val">${fmtMoneyShort(c.total_value || 0)}</div></div>
        <div class="summary-cell"><div class="lbl">Invested</div><div class="val">${fmtMoneyShort(c.total_paid || 0)}</div></div>
        <div class="summary-cell">
          <div class="lbl">Gain</div>
          <div class="val" style="color:${gain >= 0 ? "var(--up)" : "var(--down)"};">${fmtMoneyShort(gain)}</div>
          <div class="delta ${gain >= 0 ? "up" : "down"}" style="margin-top:6px;"><span class="arrow">${gain >= 0 ? "▲" : "▼"}</span>${fmtPct(Math.abs(gainPct))}</div>
        </div>
      </div>

      ${state.pwa.deferredPrompt ? `
        <button class="install-card" id="installBtn">
          <div class="install-icon">${I.download()}</div>
          <div class="install-text">
            <div class="install-t1">Install Brickvault</div>
            <div class="install-t2">Add to your home screen for a full-screen, app-like experience.</div>
          </div>
          ${I.arrowR()}
        </button>` : ""}

      ${publicProfileSectionHTML(me)}

      <div class="section-title">Preferences</div>
      <div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Appearance</div><div class="desc">Match your device or pick a side.</div></div>
          <div class="theme-seg" id="themeSeg" role="group" aria-label="Theme">
            ${[["light","Light"],["auto","Auto"],["dark","Dark"]].map(([v,l]) =>
              `<button data-theme-val="${v}" class="${getThemePref() === v ? "active" : ""}" aria-pressed="${getThemePref() === v}">${l}</button>`).join("")}
          </div>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Price-drop alerts</div><div class="desc">Alert when wishlisted sets hit your target.</div></div>
          <button class="toggle ${me.notify_price_drops ? "on" : ""}" id="notifyToggle" aria-pressed="${me.notify_price_drops}"></button>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Currency</div><div class="desc">Display values in your local currency.</div></div>
          <div style="font-family:var(--mono);font-weight:600;font-size:14px;display:flex;align-items:center;">USD ${I.chev()}</div>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Daily snapshot</div><div class="desc">Portfolio history captured at 02:00 daily.</div></div>
          <div style="font-family:var(--mono);font-size:12px;color:var(--up);">ACTIVE</div>
        </div>
      </div>

      <div class="section-title">Catalog</div>
      <div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Import sets</div><div class="desc" id="importSetsDesc">~22k sets from Rebrickable with themes &amp; images</div></div>
          <button class="import-btn" id="importSetsBtn" aria-label="Import sets">${I.download()}</button>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Import minifigs</div><div class="desc" id="importFigsDesc">~10k minifigures from Rebrickable</div></div>
          <button class="import-btn" id="importFigsBtn" aria-label="Import minifigs">${I.download()}</button>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Backfill barcodes</div><div class="desc" id="backfillUpcDesc">Fill UPC codes from Brickset — enables free barcode scanning</div></div>
          <button class="import-btn" id="backfillUpcBtn" aria-label="Backfill barcodes">${I.download()}</button>
        </div>
      </div>

      <div class="section-title">AI Scanning</div>
      <div>
        <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
          <div class="lbl-wrap">
            <div class="lbl">Gemini API key (free)</div>
            <div class="desc">${savedGeminiKey ? "Active — unlimited scans on your free Google quota" : 'Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="color:var(--bv-red);font-weight:600;text-decoration:underline;">aistudio.google.com/apikey</a> — bypasses the 20/hr limit'}</div>
          </div>
          <div style="display:flex;gap:8px;width:100%;">
            <input type="password" id="geminiKeyInput" value="${escapeHtml(savedGeminiKey)}" placeholder="AIza..."
              style="flex:1;padding:10px;border:1.5px solid var(--line);border-radius:var(--r-2);background:var(--surface-2);color:var(--ink);font-size:13px;font-family:var(--mono);outline:none;">
            <button class="btn-secondary" id="saveGeminiKey" style="white-space:nowrap;">Save</button>
          </div>
        </div>
        <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
          <div class="lbl-wrap">
            <div class="lbl">OpenAI key (optional)</div>
            <div class="desc">${savedOpenAIKey ? "Active — bypasses the 20/hr shared limit" : "Optional: use your own OpenAI key to bypass the shared limit"}</div>
          </div>
          <div style="display:flex;gap:8px;width:100%;">
            <input type="password" id="openaiKeyInput" value="${escapeHtml(savedOpenAIKey)}" placeholder="sk-..."
              style="flex:1;padding:10px;border:1.5px solid var(--line);border-radius:var(--r-2);background:var(--surface-2);color:var(--ink);font-size:13px;font-family:var(--mono);outline:none;">
            <button class="btn-secondary" id="saveOpenAIKey" style="white-space:nowrap;">Save</button>
          </div>
        </div>
      </div>

      <div class="section-title">Data</div>
      <div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Export collection</div><div class="desc">CSV with all collector fields &amp; ROI.</div></div>
          <button class="import-btn" id="exportCsvBtn" aria-label="Export CSV">${I.download()}</button>
        </div>
        <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
          <div class="lbl-wrap">
            <div class="lbl">Import collection</div>
            <div class="desc">Upload a CSV to add sets in bulk. Existing sets are skipped.</div>
          </div>
          <div class="csv-import-wrap">
            <label class="csv-file-label">${I.download()}<span>Choose CSV file</span><input type="file" id="csvFile" accept=".csv"></label>
            <span id="csvFileName"></span>
            <button class="btn-primary" id="csvImportBtn" style="display:none;">${I.plus()}<span>Import</span></button>
          </div>
          <div id="csvImportResult" style="font-size:13px;color:var(--ink-mute);font-family:var(--mono);"></div>
        </div>
        <div class="setting-row" id="signOutRow" style="cursor:pointer;">
          <div class="lbl-wrap"><div class="lbl">Sign out</div><div class="desc">Sync resumes when you return.</div></div>
          ${I.chev()}
        </div>
      </div>

      <div style="text-align:center;font-family:var(--mono);font-size:10px;color:var(--ink-faint);margin-top:24px;letter-spacing:0.1em;">
        BRICKVAULT · v5.0 · STACK SOMETHING BEAUTIFUL
      </div>
    </div>`;

  $("#installBtn")?.addEventListener("click", async () => {
    const dp = state.pwa.deferredPrompt;
    if (!dp) return;
    haptic("medium");
    dp.prompt();
    try {
      const { outcome } = await dp.userChoice;
      if (outcome === "accepted") toast("Installing Brickvault…", "success");
    } catch {}
    state.pwa.deferredPrompt = null;
    $("#installBtn")?.remove();
  });

  $$("#themeSeg button").forEach(b => b.addEventListener("click", () => {
    const val = b.dataset.themeVal;
    haptic("light");
    setThemePref(val);
    $$("#themeSeg button").forEach(x => {
      const on = x === b;
      x.classList.toggle("active", on);
      x.setAttribute("aria-pressed", on);
    });
  }));

  let notifyOn = me.notify_price_drops;
  $("#notifyToggle")?.addEventListener("click", async (e) => {
    notifyOn = !notifyOn;
    e.currentTarget.classList.toggle("on", notifyOn);
    haptic("medium");
    try { await api("/api/me", { method: "PATCH", body: { notify_price_drops: notifyOn } }); state.me = null; }
    catch {}
    toast(notifyOn ? "Alerts on" : "Alerts paused", "info");
  });
  $("#editName")?.addEventListener("click", async () => {
    const name = await promptSheet({ title: "Display name", label: "How should we call you?", value: me.display_name || "", placeholder: "Your name" });
    if (name && name.trim()) {
      api("/api/me", { method: "PATCH", body: { display_name: name.trim().slice(0, 40) } })
        .then(() => { state.me = null; renderMe(); }).catch(e => toast("Error: " + e.message, "error"));
    }
  });

  $("#saveGeminiKey")?.addEventListener("click", () => {
    const key = ($("#geminiKeyInput")?.value || "").trim();
    if (key) { localStorage.setItem('bv_gemini_key', key); toast("Gemini key saved", "success"); }
    else { localStorage.removeItem('bv_gemini_key'); toast("Gemini key removed", "info"); }
    state.me = null; renderMe();
  });
  $("#saveOpenAIKey")?.addEventListener("click", () => {
    const key = ($("#openaiKeyInput")?.value || "").trim();
    if (key) { localStorage.setItem('bv_openai_key', key); toast("OpenAI key saved", "success"); }
    else { localStorage.removeItem('bv_openai_key'); toast("OpenAI key removed", "info"); }
    state.me = null; renderMe();
  });

  async function runImport(dataset, descId, btnId) {
    const descEl = $(descId), btnEl = $(btnId);
    if (!btnEl || btnEl.disabled) return;
    btnEl.disabled = true;
    haptic("medium");
    descEl.textContent = "Starting import…";
    try {
      const r = await api("/api/admin/import-rebrickable", { method: "POST", body: { dataset } });
      if (r.status === "running" && r.run_id) {
        descEl.textContent = "Importing… (this takes ~30 sec)";
        let dots = 0, elapsed = 0;
        const poll = setInterval(async () => {
          dots = (dots + 1) % 4;
          elapsed += 3;
          descEl.textContent = "Importing" + ".".repeat(dots + 1) + ` (${elapsed}s)`;
          try {
            const s = await api(`/api/admin/import-status/${r.run_id}`);
            if (s.status === "completed") {
              clearInterval(poll);
              const sets = s.sets_loaded ?? 0;
              const figs = s.figs_loaded ?? 0;
              const parts = [];
              if (dataset !== "figs") parts.push(`${sets.toLocaleString()} sets`);
              if (dataset !== "sets") parts.push(`${figs.toLocaleString()} figs`);
              descEl.textContent = `✓ ${parts.join(", ")} imported`;
              toast(`Import complete: ${parts.join(", ")}`, "info");
              btnEl.disabled = false;
            } else if (s.status === "error") {
              clearInterval(poll);
              descEl.textContent = s.error || "Import failed";
              toast("Import failed: " + (s.error || "unknown error"), "error");
              btnEl.disabled = false;
            } else if (elapsed >= 300) {
              clearInterval(poll);
              descEl.textContent = "Timed out — try again";
              btnEl.disabled = false;
            }
          } catch { /* keep polling on transient errors */ }
        }, 3000);
      } else {
        const n = dataset === "sets" ? r.sets_loaded : r.figs_loaded;
        descEl.textContent = `✓ ${(n || 0).toLocaleString()} imported`;
        toast(`${(n || 0).toLocaleString()} records imported`, "info");
        btnEl.disabled = false;
      }
    } catch (e) {
      descEl.textContent = e.message || "Import failed";
      btnEl.disabled = false;
      toast("Import failed: " + e.message, "error");
    }
  }

  $("#importSetsBtn")?.addEventListener("click", () => runImport("sets", "#importSetsDesc", "#importSetsBtn"));
  $("#importFigsBtn")?.addEventListener("click", () => runImport("figs", "#importFigsDesc", "#importFigsBtn"));

  $("#backfillUpcBtn")?.addEventListener("click", async () => {
    const descEl = $("#backfillUpcDesc"), btnEl = $("#backfillUpcBtn");
    if (!btnEl || btnEl.disabled) return;
    btnEl.disabled = true;
    haptic("medium");
    descEl.textContent = "Fetching barcodes…";
    try {
      const r = await api("/api/admin/backfill-upc", { method: "POST" });
      if (r.status === "running" && r.run_id) {
        let elapsed = 0;
        const poll = setInterval(async () => {
          elapsed += 3;
          try {
            const s = await api(`/api/admin/import-status/${r.run_id}`);
            if (s.status === "completed") {
              clearInterval(poll);
              const n = s.sets_loaded ?? 0;
              const note = n === 0 && s.error ? ` (${s.error})` : "";
              descEl.textContent = `✓ ${n} barcode${n !== 1 ? "s" : ""} filled${note}`;
              toast(n > 0 ? `${n} barcodes filled` : `0 filled${note}`, n > 0 ? "info" : "error");
              btnEl.disabled = false;
            } else if (s.status === "error") {
              clearInterval(poll);
              descEl.textContent = s.error || "Failed";
              toast("Backfill failed: " + (s.error || "unknown"), "error");
              btnEl.disabled = false;
            } else if (elapsed >= 120) {
              clearInterval(poll);
              descEl.textContent = "Timed out — try again";
              btnEl.disabled = false;
            }
          } catch { /* keep polling on transient errors */ }
        }, 3000);
      }
    } catch (e) {
      descEl.textContent = e.message || "Failed";
      btnEl.disabled = false;
      toast("Backfill failed: " + e.message, "error");
    }
  });

  // Export CSV (needs auth header — fetch and blob-download)
  $("#exportCsvBtn")?.addEventListener("click", async () => {
    try {
      const token = _authSession?.access_token;
      const r = await fetch((window.WORKER_BASE || '') + "/api/collection/export", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error("Export failed");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "brickvault-export.csv";
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) { toast(e.message, "error"); }
  });

  // Sign out
  $("#signOutRow")?.addEventListener("click", async () => {
    haptic("medium");
    await sbSignOut();
    state.portfolio = null; state.me = null; state.catalog.items = [];
    state.blind.items = []; state.wishlist = []; state.portfolioHistory = null;
    location.hash = "#/login";
  });

  // CSV import flow
  $("#csvFile")?.addEventListener("change", e => {
    const file = e.target.files[0];
    const nameEl = $("#csvFileName"), btnEl = $("#csvImportBtn");
    if (!file) { if (nameEl) nameEl.textContent = ""; if (btnEl) btnEl.style.display = "none"; return; }
    if (nameEl) nameEl.textContent = file.name;
    if (btnEl) btnEl.style.display = "";
  });
  $("#csvImportBtn")?.addEventListener("click", async () => {
    const file = $("#csvFile")?.files[0];
    const resultEl = $("#csvImportResult"), btnEl = $("#csvImportBtn");
    if (!file) return;
    setBtnLoading(btnEl, true);
    try {
      const text = await file.text();
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) throw new Error("CSV is empty or has no data rows");
      const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, "").toLowerCase());
      const rows = lines.slice(1).map(line => {
        const cells = line.match(/(".*?"|[^,]+)(?=,|$)/g) || line.split(",");
        const obj = {};
        headers.forEach((h, i) => { obj[h] = (cells[i] || "").replace(/^"|"$/g, "").trim(); });
        return obj;
      }).filter(r => r.set_num);
      if (!rows.length) throw new Error("No valid rows found — check set_num column exists");
      const r = await api("/api/collection/import", { method: "POST", body: { rows } });
      if (resultEl) resultEl.textContent = `✓ ${r.imported} imported, ${r.skipped} skipped${r.errors?.length ? `, ${r.errors.length} errors` : ""}`;
      state.portfolio = null;
      toast(`${r.imported} sets imported`, "success");
    } catch (e) {
      if (resultEl) resultEl.textContent = "Error: " + e.message;
      toast("Import failed: " + e.message, "error");
    } finally {
      setBtnLoading(btnEl, false);
    }
  });

  // Public profile wiring
  let isPublicState = !!me.is_public;
  $("#publicToggle")?.addEventListener("click", async (e) => {
    isPublicState = !isPublicState;
    e.currentTarget.classList.toggle("on", isPublicState);
    haptic("medium");
    try { await api("/api/me", { method: "PATCH", body: { is_public: isPublicState } }); state.me = null; }
    catch (err) { toast("Error: " + err.message, "error"); }
    toast(isPublicState ? "Profile public" : "Profile private", "info");
  });
  $("#saveHandle")?.addEventListener("click", async () => {
    const h = ($("#handleInput")?.value || "").trim().toLowerCase();
    if (!h) { toast("Enter a handle", "info"); return; }
    if (!/^[a-zA-Z0-9-]{3,30}$/.test(h)) { toast("Handle: 3-30 chars, letters, numbers, hyphens only", "error"); return; }
    try {
      await api("/api/me", { method: "PATCH", body: { handle: h } });
      state.me = null;
      toast("Handle saved", "success");
      renderMe();
    } catch (err) { toast("Error: " + err.message, "error"); }
  });
  $("#copyShareLink")?.addEventListener("click", () => {
    const h = me.handle;
    if (!h) return;
    const url = `${location.origin}/#/u/${encodeURIComponent(h)}`;
    copyListingField(url, "Share link");
  });
  $("#editShowcaseBtn")?.addEventListener("click", () => showShowcaseSheet());
}

/* ============================================================
   Pile (AI photo scanner)
   ============================================================ */
function renderPile() {
  $("#root").innerHTML = `
    <div class="page">
      <div class="topbar">
        <div class="topbar-heading">
          <div class="topbar-eyebrow">Snap &amp; identify</div>
          <div class="topbar-title">Pile scanner</div>
        </div>
      </div>

      <div class="card" style="padding:18px;margin-bottom:14px;">
        <div style="display:flex;gap:10px;align-items:flex-start;">
          ${I.sparkles()}
          <div>
            <div style="font-family:var(--serif);font-weight:500;font-size:17px;line-height:1.2;">Point. Snap. Identify.</div>
            <p style="margin:6px 0 0;font-size:13px;color:var(--ink-soft);line-height:1.45;">
              Take a photo of any set — built, in pieces, or in the box. GPT-4o reads the bricks and tells you what you're holding.
            </p>
          </div>
        </div>
      </div>

      <button class="scan-cta" id="pileScan" style="margin-bottom:18px;">
        <div class="scan-cta-icon">${I.camera()}</div>
        <div class="scan-cta-text">
          <div class="t1">Open camera</div>
          <div class="t2">20 scans/hour · powered by GPT-4o</div>
        </div>
        <div class="scan-cta-arrow">${I.arrowR()}</div>
      </button>

      <div class="section-title">How it works</div>
      <div class="card" style="background:var(--surface-2);padding:14px;">
        <ol style="margin:0;padding-left:18px;font-size:13px;color:var(--ink-soft);line-height:1.7;">
          <li>Tap "Open camera" above</li>
          <li>Switch to Photo mode</li>
          <li>Frame the set clearly and tap the shutter</li>
          <li>GPT-4o identifies the set and shows price info</li>
          <li>Tap "Add to vault" to log it instantly</li>
        </ol>
      </div>
    </div>`;

  $("#pileScan")?.addEventListener("click", () => openScan("image"));
}

/* ============================================================
   Minifigs
   ============================================================ */
let _blindGen = 0;

function blindQuery() {
  const f = state.filter;
  const b = state.blind;
  const p = new URLSearchParams({ limit: b.pageSize, offset: b.offset });
  if (f.figQ)                  p.set('q', f.figQ);
  if (f.figRarity !== 'all')   p.set('rarity', f.figRarity);
  if (f.figOwned === 'owned')   p.set('owned', 'yes');
  if (f.figOwned === 'unowned') p.set('owned', 'no');
  return p.toString();
}

async function loadBlind({ reset = false } = {}) {
  const b = state.blind;
  if (!reset && b.loading) return [];
  if (!reset && !b.hasMore) return [];
  if (reset) { _blindGen++; b.offset = 0; b.hasMore = false; b.total = 0; }
  const myGen = _blindGen;
  b.loading = true;
  try {
    const res = await api("/api/minifigs?" + blindQuery());
    if (myGen !== _blindGen) return [];
    const fresh = res.minifigs || [];
    // Server is the source of truth for ownership — seed the local set from
    // owned_qty so it survives device switches / cache clears.
    fresh.forEach(f => { if (f.owned_qty > 0) state.ownedFigs.add(f.fig_num); });
    saveFigs();
    b.items = reset ? fresh : b.items.concat(fresh);
    b.total = res.total ?? b.items.length;
    b.offset = b.items.length;
    b.hasMore = !!res.hasMore;
    return fresh;
  } catch (e) {
    if (myGen === _blindGen) toast("Couldn't load minifigs", "error");
    return [];
  } finally {
    if (myGen === _blindGen) b.loading = false;
  }
}

function saveFigs() {
  try { localStorage.setItem("bv_figs", JSON.stringify([...state.ownedFigs])); } catch {}
}

function refreshMiniGrid() {
  const grid = $('#miniGrid');
  if (!grid) return;
  grid.innerHTML = state.blind.items.map(f => miniCardHTML(f)).join('');
  wireMiniCards();
  mountBlindSentinel();
}

const debouncedFigSearch = debounce(async () => {
  await loadBlind({ reset: true });
  refreshMiniGrid();
}, 350);

function wireMiniCards() {
  const grid = $("#miniGrid");
  if (!grid || grid._delegated) return;
  grid._delegated = true;
  grid.addEventListener("click", (evt) => {
    const card = evt.target.closest(".mini-card");
    if (!card) return;
    const num = card.dataset.fig;
    if (!num) return;
    haptic("light");
    const f = state.blind.items.find(x => x.fig_num === num);
    if (f) showFigDetail(f);
  });
}

function updateBlindCount() {
  const el = $("#blindCount");
  if (!el) return;
  const owned = state.blind.items.filter(f => state.ownedFigs.has(f.fig_num)).length;
  el.textContent = `${owned}/${state.blind.total.toLocaleString()} collected`;
}

function updateFigStats() {
  const ownedItems = state.blind.items.filter(f => state.ownedFigs.has(f.fig_num));
  const countEl = $("#figStatCount");
  const valueEl = $("#figStatValue");
  if (countEl) countEl.textContent = `${ownedItems.length} owned`;
  if (valueEl) {
    const total = ownedItems.reduce((s, f) => s + (f.value ?? f.current_value ?? 0), 0);
    valueEl.textContent = fmtMoney(total, { cents: 0 });
  }
}

function showFigDetail(f) {
  const owned = state.ownedFigs.has(f.fig_num);
  const val = f.value ?? f.current_value ?? 0;
  const hue = f.hue ?? themeHue(f.series || f.fig_num);
  const hasImg = f.image_url;
  const rarity = f.rarity || 'common';
  const rbUrl = `https://rebrickable.com/minifigs/${encodeURIComponent(f.fig_num)}/`;

  const renderBtn = (isOwned) => isOwned
    ? `${I.check()}<span>Owned</span>`
    : `<span>Mark as owned</span>`;

  showSheet(`
    <div class="fig-detail">
      <div class="fig-detail-hero${hasImg ? ' has-photo' : ''}">
        <div class="mini-figure" style="--fig-color:oklch(0.6 0.18 ${hue});--fig-color2:oklch(0.4 0.08 ${(hue + 180) % 360});">
          <div class="head"></div><div class="body"></div><div class="legs"></div>
        </div>
        ${hasImg ? `<img class="fig-photo" src="${escapeHtml(f.image_url)}" alt="${escapeHtml(f.name)}" loading="lazy">` : ''}
        <span class="mini-rarity-tag rarity-${rarity}">${rarity}</span>
      </div>
      <div class="fig-detail-body">
        <div class="fig-detail-series">${escapeHtml(f.series || 'Minifig')}</div>
        <div class="fig-detail-name">${escapeHtml(f.name)}</div>
        ${val > 0 ? `
        <div class="fig-detail-value">
          <span class="fig-detail-value-lbl">Est. resale value</span>
          <span class="fig-detail-value-num">${fmtMoney(val, { cents: 0 })}</span>
        </div>` : ''}
        <button class="btn-primary fig-own-btn${owned ? ' is-owned' : ''}" id="figOwnBtn">
          ${renderBtn(owned)}
        </button>
        <a class="fig-detail-link" href="${rbUrl}" target="_blank" rel="noopener noreferrer">
          ${I.extLink()}<span>View on Rebrickable</span>
        </a>
      </div>
    </div>`);

  $('#figOwnBtn')?.addEventListener('click', async () => {
    const nowOwned = !state.ownedFigs.has(f.fig_num);
    if (nowOwned) state.ownedFigs.add(f.fig_num); else state.ownedFigs.delete(f.fig_num);
    f.owned_qty = nowOwned ? 1 : 0;
    saveFigs();
    haptic('medium');
    const btn = $('#figOwnBtn');
    if (btn) {
      btn.innerHTML = renderBtn(nowOwned);
      btn.classList.toggle('is-owned', nowOwned);
    }
    const card = $(`.mini-card[data-fig="${CSS.escape(f.fig_num)}"]`);
    if (card) card.outerHTML = miniCardHTML(f);
    updateBlindCount();
    updateFigStats();
    try {
      await api('/api/minifigs/' + encodeURIComponent(f.fig_num), { method: nowOwned ? 'PUT' : 'DELETE' });
    } catch {
      if (nowOwned) state.ownedFigs.delete(f.fig_num); else state.ownedFigs.add(f.fig_num);
      f.owned_qty = nowOwned ? 0 : 1;
      saveFigs();
      const recard = $(`.mini-card[data-fig="${CSS.escape(f.fig_num)}"]`);
      if (recard) recard.outerHTML = miniCardHTML(f);
      updateBlindCount();
      updateFigStats();
      toast("Couldn't save — try again", 'error');
    }
  });
}

function mountBlindSentinel() {
  const grid = $("#miniGrid");
  const sentinel = $("#blindSentinel");
  if (!grid || !sentinel) return;
  if (state._blindObserver) state._blindObserver.disconnect();
  sentinel.style.display = state.blind.hasMore ? "" : "none";
  if (!state.blind.hasMore) return;
  state._blindObserver = new IntersectionObserver(async (entries) => {
    if (!entries[0].isIntersecting || state.blind.loading) return;
    const fresh = await loadBlind();
    if (fresh.length) {
      grid.insertAdjacentHTML("beforeend", fresh.map(f => miniCardHTML(f)).join(""));
      wireMiniCards();
    }
    sentinel.style.display = state.blind.hasMore ? "" : "none";
    if (!state.blind.hasMore) state._blindObserver.disconnect();
  }, { rootMargin: "400px" });
  state._blindObserver.observe(sentinel);
}

async function renderBlind() {
  if (!state.blind.items.length) {
    await loadBlind({ reset: true });
    if (isFigFilterDefault()) bvIDB.set('blind', { data: { items: state.blind.items, total: state.blind.total, hasMore: state.blind.hasMore, offset: state.blind.offset }, ts: Date.now() }).catch(() => {});
  } else if (state.blind._stale) {
    state.blind._stale = false;
    loadBlind({ reset: true }).then(() => {
      if (location.hash === '#/minifigs' && $('#miniGrid')) {
        refreshMiniGrid();
        if (isFigFilterDefault()) bvIDB.set('blind', { data: { items: state.blind.items, total: state.blind.total, hasMore: state.blind.hasMore, offset: state.blind.offset }, ts: Date.now() }).catch(() => {});
      }
    }).catch(() => {});
  }
  const b = state.blind;
  const f = state.filter;
  const ownedCount = b.items.filter(fig => state.ownedFigs.has(fig.fig_num)).length;
  const ownedValue = b.items.filter(fig => state.ownedFigs.has(fig.fig_num)).reduce((s, fig) => s + (fig.value ?? fig.current_value ?? 0), 0);
  const rarities = ['common','uncommon','rare','legendary'];
  const ownedChipLabel = f.figOwned === 'owned' ? 'Owned' : f.figOwned === 'unowned' ? 'Unowned' : 'All';

  $("#root").innerHTML = `
    <div class="page">
      <div class="topbar">
        <div class="topbar-heading">
          <div class="topbar-eyebrow" id="blindCount">${ownedCount}/${b.total.toLocaleString()} collected</div>
          <div class="topbar-title">Minifigs</div>
        </div>
      </div>

      <div class="fig-stats-row">
        <div class="fig-stat-pill">
          <div class="fig-stat-num" id="figStatCount">${ownedCount} owned</div>
          <div class="fig-stat-lbl">of ${b.total.toLocaleString()} figs</div>
        </div>
        <div class="fig-stat-pill">
          <div class="fig-stat-num" id="figStatValue">${fmtMoney(ownedValue, { cents: 0 })}</div>
          <div class="fig-stat-lbl">collection value</div>
        </div>
      </div>

      <div class="fig-filter-bar">
        <div class="search-wrap open" style="margin-bottom:10px;">
          <span class="s-icon">${I.search()}</span>
          <input class="search-input" id="figSearch" placeholder="Search minifigs…" autocomplete="off" value="${escapeHtml(f.figQ)}">
        </div>
        <div class="filter-row">
          <button class="chip ${f.figRarity === 'all' ? 'active' : ''}" data-fig-rarity="all">All</button>
          ${rarities.map(r => `<button class="chip ${f.figRarity === r ? 'active' : ''} rarity-chip-${r}" data-fig-rarity="${r}">${r.charAt(0).toUpperCase() + r.slice(1)}</button>`).join('')}
        </div>
        <div class="filter-row" style="margin-top:-4px;">
          <button class="chip fig-owned-chip ${f.figOwned !== 'all' ? 'active' : ''}" id="figOwnedChip">${ownedChipLabel}</button>
        </div>
      </div>

      <div class="mini-grid" id="miniGrid">
        ${b.items.map(fig => miniCardHTML(fig)).join("")}
      </div>
      <div id="blindSentinel" class="load-sentinel" style="${b.hasMore ? "" : "display:none;"}">
        <div class="spinner"></div>
      </div>
    </div>`;

  const figSearchInput = $("#figSearch");
  figSearchInput?.addEventListener("input", (e) => { state.filter.figQ = e.target.value; debouncedFigSearch(); });

  $$("[data-fig-rarity]").forEach(btn => btn.addEventListener("click", () => {
    state.filter.figRarity = btn.dataset.figRarity; haptic("light");
    $$("[data-fig-rarity]").forEach(x => x.classList.toggle("active", x.dataset.figRarity === state.filter.figRarity));
    loadBlind({ reset: true }).then(() => { if (location.hash === '#/minifigs' && $('#miniGrid')) refreshMiniGrid(); }).catch(() => {});
  }));

  const ownedCycle = { all: 'owned', owned: 'unowned', unowned: 'all' };
  $("#figOwnedChip")?.addEventListener("click", () => {
    state.filter.figOwned = ownedCycle[state.filter.figOwned] || 'all'; haptic("light");
    const labels = { all: 'All', owned: 'Owned', unowned: 'Unowned' };
    const chip = $("#figOwnedChip");
    if (chip) { chip.textContent = labels[state.filter.figOwned]; chip.classList.toggle("active", state.filter.figOwned !== 'all'); }
    loadBlind({ reset: true }).then(() => { if (location.hash === '#/minifigs' && $('#miniGrid')) refreshMiniGrid(); }).catch(() => {});
  });

  wireMiniCards();
  mountBlindSentinel();
}

function isFigFilterDefault() {
  const f = state.filter;
  return !f.figQ && f.figRarity === 'all' && f.figOwned === 'all';
}

function miniCardHTML(f) {
  const owned = state.ownedFigs.has(f.fig_num);
  const hue = f.hue ?? themeHue(f.series || f.fig_num);
  const hasImg = f.image_url;
  const val = f.value ?? f.current_value ?? 0;
  const rarity = f.rarity || "common";
  return `
    <button class="mini-card rarity-${rarity}" data-fig="${escapeHtml(f.fig_num)}" aria-label="${escapeHtml(f.name)}">
      <div class="mini-img${hasImg ? " has-photo" : ""}">
        <div class="mini-figure" style="--fig-color:oklch(0.6 0.18 ${hue});--fig-color2:oklch(0.4 0.08 ${(hue+180)%360});">
          <div class="head"></div>
          <div class="body"></div>
          <div class="legs"></div>
        </div>
        ${hasImg ? `<img class="fig-photo" src="${escapeHtml(f.image_url)}" alt="" loading="lazy">` : ""}
        <span class="mini-rarity-tag rarity-${rarity}">${rarity}</span>
      </div>
      <div class="mini-body">
        <div class="mini-name">${escapeHtml(f.name)}</div>
        <div class="mini-meta">
          <span>${escapeHtml(f.series || "Minifig")}</span>
        </div>
        <div class="mini-card-footer">
          <div class="mini-value">${val > 0 ? fmtMoney(val, { cents: 0 }) : '—'}</div>
          ${owned ? `<span class="mini-owned-badge">${I.check()}</span>` : ''}
        </div>
      </div>
    </button>`;
}

/* ============================================================
   Camera scan overlay
   ============================================================ */
function openScan(mode = "barcode") {
  state.camera.mode = mode;
  const ov = $("#scanOverlay");
  ov.innerHTML = scanOverlayHTML(mode);
  ov.classList.add("open");
  $("#scanCloseBtn").addEventListener("click", closeScan);
  $$(".scan-mode-toggle button").forEach(b => b.addEventListener("click", () => {
    stopCamera();
    openScan(b.dataset.mode);
  }));
  $("#scanCapture")?.addEventListener("click", capturePhoto);
  startCamera();
}

function closeScan() {
  stopCamera();
  $("#scanOverlay").classList.remove("open");
  $("#scanOverlay").innerHTML = "";
}

function stopCamera() {
  clearInterval(state.camera.timer);
  state.camera.timer = null;
  if (state.camera.stream) {
    state.camera.stream.getTracks().forEach(t => t.stop());
    state.camera.stream = null;
  }
  state.camera.scanning = false;
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 } }
    });
    state.camera.stream = stream;
    const vid = $("#scanVideo");
    if (vid) { vid.srcObject = stream; await vid.play().catch(() => {}); }

    if (state.camera.mode === "barcode" && "BarcodeDetector" in window) {
      state.camera.detector = new BarcodeDetector({ formats: ["ean_13","ean_8","upc_a","upc_e","code_128","code_39"] });
      state.camera.scanning = true;
      state.camera.timer = setInterval(scanBarcode, 400);
    } else if (state.camera.mode === "barcode") {
      const hint = $("#scanHint");
      if (hint) hint.textContent = "Barcode scanning isn't supported on this browser — switch to photo mode";
    }
  } catch (e) {
    const hint = $("#scanHint");
    if (hint) hint.textContent = "Camera not available — check permissions";
  }
}

async function scanBarcode() {
  if (!state.camera.scanning) return;
  const vid = $("#scanVideo");
  if (!vid || vid.readyState < 2) return;
  try {
    const codes = await state.camera.detector.detect(vid);
    if (codes.length > 0) {
      state.camera.scanning = false;
      clearInterval(state.camera.timer);
      haptic("medium");
      const barcode = codes[0].rawValue;
      const hint = $("#scanHint");
      if (hint) hint.textContent = "Looking up barcode…";
      sendScanToAPI({ mode: "barcode", barcode });
    }
  } catch {}
}

async function capturePhoto() {
  haptic("heavy");
  const btn = $("#scanCapture");
  if (btn) { btn.style.transform = "scale(0.85)"; setTimeout(() => btn.style.transform = "", 200); }
  const hint = $("#scanHint");
  if (hint) hint.textContent = "Identifying…";

  const vid = $("#scanVideo");
  if (!vid) return;
  const canvas = document.createElement("canvas");
  const maxSide = 1024;
  const w = vid.videoWidth || 640; const h = vid.videoHeight || 480;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  canvas.width = w * scale; canvas.height = h * scale;
  canvas.getContext("2d").drawImage(vid, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  sendScanToAPI({ mode: "image", image: dataUrl });
}

async function sendScanToAPI(payload) {
  const el = $("#scanResult");
  if (el) {
    el.classList.add("show");
    el.innerHTML = `<div class="scan-loading"><div class="spinner"></div><span>Identifying…</span></div>`;
  }
  const frame = document.querySelector(".scan-frame");
  if (frame) frame.classList.add("scan-pending");
  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(), 30_000);
  try {
    const geminiKey = localStorage.getItem('bv_gemini_key');
    const openaiKey = localStorage.getItem('bv_openai_key');
    const extraHeaders = {};
    if (geminiKey) extraHeaders['X-Gemini-Key'] = geminiKey;
    if (openaiKey) extraHeaders['X-OpenAI-Key'] = openaiKey;
    const res = await api("/api/scan/identify", { method: "POST", body: payload, signal: ac.signal, headers: extraHeaders });
    showScanResult(res);
  } catch (e) {
    const msg = ac.signal.aborted ? "Took too long — try again." : e.message;
    const hint = $("#scanHint");
    if (hint) hint.textContent = ac.signal.aborted ? "Timed out" : "Error: " + e.message;
    showScanResult({ identified: false, reasoning: msg });
  } finally {
    clearTimeout(tid);
    if (frame) frame.classList.remove("scan-pending");
  }
}

function showScanResult(res) {
  const el = $("#scanResult");
  if (!el) return;
  el.classList.add("show");
  if (!res.identified) {
    el.innerHTML = `
      <div class="scan-result-head">
        <span class="badge miss">${I.close()}NO MATCH</span>
        <span style="font-family:var(--mono);font-size:10px;color:var(--ink-mute);letter-spacing:0.1em;text-transform:uppercase;">Not found</span>
      </div>
      <p style="font-size:13px;color:var(--ink-mute);margin:0 0 10px;">${escapeHtml(res.reasoning || "Couldn't identify the set. Try a clearer photo.")}</p>
      <button class="btn-secondary" id="scanRetry">Try again</button>`;
    $("#scanRetry")?.addEventListener("click", () => {
      el.classList.remove("show");
      state.camera.scanning = true;
      state.camera.timer = setInterval(scanBarcode, 400);
      const hint = $("#scanHint");
      if (hint) hint.textContent = state.camera.mode === "barcode" ? "Align barcode within the frame" : "Frame the set and tap to identify";
    });
    return;
  }
  const sets = res.sets || (res.set ? [res.set] : []);
  if (!sets.length) {
    el.innerHTML = `
      <div class="scan-result-head">
        <span class="badge miss">${I.close()}NO MATCH</span>
        <span style="font-family:var(--mono);font-size:10px;color:var(--ink-mute);letter-spacing:0.1em;text-transform:uppercase;">No sets found</span>
      </div>
      <p style="font-size:13px;color:var(--ink-mute);margin:0 0 10px;">Matched sets were not found in local catalog.</p>
      <button class="btn-secondary" id="scanRetry">Try again</button>`;
    return;
  }
  let headHTML = `
    <div class="scan-result-head">
      <span class="badge">${I.check()}MATCH</span>
      <span style="font-family:var(--mono);font-size:10px;color:var(--ink-mute);letter-spacing:0.1em;text-transform:uppercase;">${escapeHtml(res.confidence || "high")} confidence</span>
    </div>`;
  let listHTML = `<div style="display:flex;flex-direction:column;gap:10px;margin:8px 0 16px;max-height:40vh;overflow-y:auto;padding-right:4px;">`;
  sets.forEach((set, idx) => {
    const h = setHue(set);
    const hasImg = set.image_url && !set.image_url.startsWith("data:");
    listHTML += `
      <div class="scan-result-row" style="align-items:center;background:var(--surface-2);padding:8px;border-radius:var(--r-2);border:1.5px solid var(--line-soft);margin-bottom:6px;">
        <input type="checkbox" class="scan-select-check" data-setnum="${escapeHtml(set.set_num)}" data-idx="${idx}" checked style="width:18px;height:18px;margin-right:10px;cursor:pointer;">
        <div class="si${hasImg ? " has-photo" : ""}" style="width:48px;height:48px;border-radius:var(--r-1);background:linear-gradient(135deg, var(--surface-2), var(--surface-3));flex-shrink:0;position:relative;">
          <div class="brick-tile" style="--h:${h};width:100%;height:100%;border-radius:var(--r-1);"></div>
          ${hasImg ? `<img src="${escapeHtml(set.image_url)}" alt="" style="position:absolute;inset:2px;width:calc(100% - 4px);height:calc(100% - 4px);object-fit:contain;mix-blend-mode:multiply;">` : ""}
        </div>
        <div class="sx" style="margin-left:10px;flex:1;min-width:0;text-align:left;">
          <div class="sx-name" style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(set.name)}</div>
          <div class="sx-meta" style="font-size:10px;color:var(--ink-mute);">${escapeHtml(set.theme||"")} · #${escapeHtml(set.set_num)}</div>
          <div class="sx-val" style="font-weight:600;font-size:12px;color:var(--up);">${fmtMoney(set.current_value)}</div>
        </div>
      </div>`;
  });
  listHTML += `</div>`;

  let dealHTML = "";
  if (sets.length === 1) {
    dealHTML = `
      <div style="margin: 0 0 12px 0;">
        ${dealScoreHTML(sets[0])}
        <div id="scanFlipCalcContainer">${flipCalcHTML(sets[0], null)}</div>
      </div>`;
  }

  let actionsHTML = `
    <div class="btn-row" style="margin-top:12px;">
      <button class="btn-secondary" id="scanDetails" ${sets.length > 1 ? 'disabled style="opacity:0.5;"' : ""}>Details</button>
      <button class="btn-primary" id="scanAdd">${I.plus()}<span>Add selected</span></button>
    </div>`;
  el.innerHTML = headHTML + listHTML + dealHTML + actionsHTML;

  if (sets.length === 1) {
    const dpi = $("#dealPriceInput");
    if (dpi) {
      let debounceTid;
      dpi.addEventListener("input", (e) => {
        const val = e.target.value;
        clearTimeout(debounceTid);
        debounceTid = setTimeout(() => {
          updateDealBadge(sets[0], val);
          updateFlipCalc(sets[0], null, val);
        }, 150);
      });
    }
  }

  $("#scanDetails")?.addEventListener("click", () => {
    if (sets.length === 1) {
      closeScan();
      location.hash = "#/set/" + encodeURIComponent(sets[0].set_num);
    }
  });
  $("#scanAdd")?.addEventListener("click", async () => {
    haptic("heavy");
    const checkedBoxes = $$(".scan-select-check:checked");
    if (!checkedBoxes.length) { toast("No sets selected", "info"); return; }
    setBtnLoading($("#scanAdd"), true);
    let addedCount = 0;
    for (const box of checkedBoxes) {
      const setnum = box.dataset.setnum;
      const targetSet = sets[parseInt(box.dataset.idx, 10)];
      try {
        await api("/api/collection", { method: "POST", body: { set_num: setnum, quantity: 1, purchase_price: targetSet.current_value } });
        addedCount++;
      } catch (e) {
        if (!navigator.onLine) {
          outboxEnqueue({ path: '/api/collection', method: 'POST', body: { set_num: setnum, quantity: 1, purchase_price: targetSet.current_value } });
          addedCount++;
        } else {
          toast(`Failed to add ${targetSet.name}: ${e.message}`, "error");
        }
      }
    }
    state.portfolio = null;
    closeScan();
    if (addedCount > 0) {
      toast(navigator.onLine ? `Added ${addedCount} sets to vault` : `Saved ${addedCount} offline — will sync`, "success");
    }
    location.hash = "#/";
  });
}

function scanOverlayHTML(mode) {
  return `
    <div class="scan-video-wrap">
      <video class="scan-video" id="scanVideo" autoplay playsinline muted></video>
      <div class="scan-top">
        <button id="scanCloseBtn" aria-label="Close">${I.close()}</button>
        <div class="scan-mode-toggle">
          <button data-mode="barcode" class="${mode === "barcode" ? "active" : ""}">Barcode</button>
          <button data-mode="image" class="${mode === "image" ? "active" : ""}">Photo</button>
        </div>
        <div style="width:42px;"></div>
      </div>
      <div class="scan-frame ${mode === "barcode" ? "barcode" : ""}">
        <span class="corner tl"></span><span class="corner tr"></span>
        <span class="corner bl"></span><span class="corner br"></span>
        ${mode === "barcode" ? `<span class="laser"></span>` : ""}
      </div>
      <div class="scan-hint" id="scanHint">${mode === "barcode" ? "Align barcode within the frame" : "Frame the set and tap to identify"}</div>
      ${mode === "image" ? `
        <div class="scan-bottom">
          <button class="scan-capture-btn" id="scanCapture" aria-label="Capture"></button>
        </div>` : ""}
      <div class="scan-result" id="scanResult"></div>
    </div>`;
}

/* ============================================================
   Sheets
   ============================================================ */
function showSheet(html) {
  const back = $("#sheetBackdrop");
  const sheet = $("#sheet");
  sheet.innerHTML = `<div class="sheet-handle"></div>` + html;
  back.classList.add("show");
  sheet.classList.add("show");
  haptic("light");
  back.addEventListener("click", hideSheet, { once: true });
  document.addEventListener("keydown", sheetKeyHandler);
  wireSheetDrag(sheet);
}
function sheetKeyHandler(e) { if (e.key === "Escape") hideSheet(); }
function hideSheet() {
  const sheet = $("#sheet");
  const backdrop = $("#sheetBackdrop");
  if (!backdrop || !backdrop.classList.contains("show")) return;
  backdrop.classList.remove("show");
  if (sheet) {
    sheet.classList.remove("show");
    sheet.style.transform = "";
    sheet.style.transition = "";
  }
  document.removeEventListener("keydown", sheetKeyHandler);
  haptic("light");
}
// Drag the sheet down to dismiss; release past ~30% (or a fast flick) closes it,
// otherwise it springs back. Native iOS/Android bottom-sheet behaviour.
function wireSheetDrag(sheet) {
  let startY = 0, dy = 0, dragging = false, t0 = 0;
  const onStart = (e) => {
    // Only initiate a drag from the top of the sheet (handle area) or when
    // the content is scrolled to the top, so inner scrolling still works.
    if (sheet.scrollTop > 0) return;
    startY = e.touches[0].clientY; dy = 0; dragging = true; t0 = Date.now();
    sheet.style.transition = "none";
  };
  const onMove = (e) => {
    if (!dragging) return;
    dy = e.touches[0].clientY - startY;
    if (dy < 0) dy = 0;
    sheet.style.transform = `translateY(${dy}px)`;
  };
  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = "";
    const velocity = dy / Math.max(1, Date.now() - t0);
    if (dy > sheet.offsetHeight * 0.3 || velocity > 0.6) hideSheet();
    else sheet.style.transform = "";
  };
  sheet.addEventListener("touchstart", onStart, { passive: true });
  sheet.addEventListener("touchmove", onMove, { passive: true });
  sheet.addEventListener("touchend", onEnd);
}

// In-app confirm sheet (replaces window.confirm). Resolves true/false.
function confirmSheet({ title, message = "", confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; hideSheet(); resolve(v); };
    showSheet(`
      <div style="font-family:var(--serif);font-size:22px;font-weight:500;margin:0 4px 6px;">${escapeHtml(title)}</div>
      ${message ? `<div style="color:var(--ink-mute);font-size:14px;margin:0 4px 18px;">${escapeHtml(message)}</div>` : `<div style="height:12px;"></div>`}
      <button class="btn-primary ${danger ? "btn-danger" : ""}" id="cfYes">${escapeHtml(confirmLabel)}</button>
      <button class="btn-secondary" id="cfNo" style="margin-top:8px;">Cancel</button>`);
    $("#cfYes").addEventListener("click", () => finish(true));
    $("#cfNo").addEventListener("click", () => finish(false));
    $("#sheetBackdrop").addEventListener("click", () => finish(false), { once: true });
  });
}

// In-app single-field prompt sheet (replaces window.prompt). Resolves string or null.
function promptSheet({ title, label = "", value = "", placeholder = "", confirmLabel = "Save" }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; hideSheet(); resolve(v); };
    showSheet(`
      <div style="font-family:var(--serif);font-size:22px;font-weight:500;margin:0 4px 14px;">${escapeHtml(title)}</div>
      ${label ? `<label class="field-lbl" for="psInput">${escapeHtml(label)}</label>` : ""}
      <input class="field-input" id="psInput" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off">
      <button class="btn-primary" id="psSave" style="margin-top:14px;">${escapeHtml(confirmLabel)}</button>
      <button class="btn-secondary" id="psCancel" style="margin-top:8px;">Cancel</button>`);
    const input = $("#psInput");
    setTimeout(() => input?.focus(), 80);
    input?.addEventListener("keydown", (e) => { if (e.key === "Enter") finish(input.value.trim()); });
    $("#psSave").addEventListener("click", () => finish(input.value.trim()));
    $("#psCancel").addEventListener("click", () => finish(null));
    $("#sheetBackdrop").addEventListener("click", () => finish(null), { once: true });
  });
}

function showAlertsSheet(alerts) {
  const html = alerts.length === 0
    ? `<div style="padding:20px 0;text-align:center;color:var(--ink-mute);">No new alerts.</div>`
    : alerts.map(a => `
        <div class="alert-card">
          <div class="ah">${I.bell()}Price drop · ${daysAgo(a.triggered_at)}d ago</div>
          <div style="font-weight:600;">${escapeHtml(a.set_name)}</div>
          <div style="font-size:13px;margin-top:4px;">Now <strong>${fmtMoney(a.current_value)}</strong> — your target was ${fmtMoney(a.target_price)}.</div>
        </div>`).join("");
  showSheet(`
    <div style="font-family:var(--serif);font-size:22px;font-weight:500;margin:0 4px 14px;">Alerts</div>
    ${html}`);
}
function showQuickActions(setNum) {
  haptic("medium");
  showSheet(`
    <button class="sheet-action" id="qaView">${I.eye()}<span>View details</span></button>
    <button class="sheet-action" id="qaEdit">${I.pencil()}<span>Edit purchase price</span></button>
    <button class="sheet-action" id="qaShare">${I.share()}<span>Share set</span></button>
    <button class="sheet-action danger" id="qaRemove">${I.trash()}<span>Remove from vault</span></button>`);
  $("#qaView").addEventListener("click", () => { hideSheet(); location.hash = "#/set/" + encodeURIComponent(setNum); });
  $("#qaEdit").addEventListener("click", () => { hideSheet(); location.hash = "#/set/" + encodeURIComponent(setNum) + "/manage"; });
  $("#qaShare").addEventListener("click", () => {
    hideSheet();
    const set = (state.portfolio?.items || []).find(s => s.set_num === setNum) || { set_num: setNum, name: setNum };
    shareSet(set);
  });
  $("#qaRemove").addEventListener("click", async () => {
    hideSheet();
    if (!(await confirmSheet({ title: "Remove from vault?", message: "This set will be removed from your collection.", confirmLabel: "Remove", danger: true }))) return;
    const item = (state.portfolio?.items || []).find(s => s.set_num === setNum);
    if (item) {
      try { await api("/api/collection/" + item.id, { method: "DELETE" }); state.portfolio = null; toast("Removed", "info"); }
      catch (e) {
        if (!navigator.onLine && item) {
          outboxEnqueue({ path: '/api/collection/' + item.id, method: 'DELETE' });
          state.portfolio = null; toast('Removed offline — will sync when connected', 'info');
        } else { toast("Error: " + e.message, "error"); }
      }
    }
    hideSheet(); paintPortfolio();
  });
}

/* ============================================================
   Utilities
   ============================================================ */
function shareSet(set) {
  if (!set) return;
  const url = location.origin + location.pathname + "#/set/" + encodeURIComponent(set.set_num);
  if (navigator.share) navigator.share({ title: set.name, url }).catch(() => {});
  else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast("Link copied!", "success"));
  else toast("Share unavailable", "error");
}

function wireLongPress(el, fn) {
  let t = null;
  el.addEventListener("touchstart", () => { t = setTimeout(fn, 500); }, { passive: true });
  el.addEventListener("touchend", () => clearTimeout(t));
  el.addEventListener("touchmove", () => clearTimeout(t));
  el.addEventListener("contextmenu", e => { e.preventDefault(); fn(); });
}

/* ============================================================
   Pull-to-refresh + swipe-back
   ============================================================ */
function setupGestures() {
  let sy = 0, pulling = false;
  document.addEventListener("touchstart", e => {
    if (window.scrollY <= 0) { sy = e.touches[0].clientY; pulling = true; }
  }, { passive: true });
  document.addEventListener("touchmove", e => {
    if (!pulling) return;
    if (e.touches[0].clientY - sy > 30) $("#ptrIndicator").classList.add("show");
  }, { passive: true });
  document.addEventListener("touchend", e => {
    if (!pulling) return;
    const dy = (e.changedTouches[0]?.clientY ?? sy) - sy;
    if (dy > 80) {
      haptic("medium");
      state.portfolio = null; state.portfolioHistory = null; state.me = null;
      toast("Refreshed", "success");
      route();
    }
    pulling = false;
    setTimeout(() => $("#ptrIndicator").classList.remove("show"), 300);
  });

  // swipe-back from left edge
  let edgeSx = 0;
  document.addEventListener("touchstart", e => {
    if (e.touches[0].clientX < 44) edgeSx = e.touches[0].clientX;
    else edgeSx = 0;
  }, { passive: true });
  document.addEventListener("touchend", e => {
    if (edgeSx > 0 && e.changedTouches[0].clientX - edgeSx > 60) {
      if (history.length > 1) history.back();
    }
  });
}

/* ============================================================
   New Improvements — Parts 8 to 14
   ============================================================ */
function flipCalcHTML(set, entry) {
  const condition = entry?.condition || 'new';
  const market = parseFloat(set.ebay_value || set.current_value || 0);
  if (market <= 0) return '';
  
  let estPrice = market;
  if (condition.startsWith('used')) {
    const ratio = (set.used_value && set.current_value) ? (set.used_value / set.current_value) : 0.75;
    estPrice = market * ratio;
  }
  
  const ebayFee = estPrice * 0.1325;
  const paypalFee = estPrice * 0.029 + 0.30;
  const shipping = 5.00;
  const gross = estPrice;
  const totalFees = ebayFee + paypalFee + shipping;
  const net = Math.max(0, gross - totalFees);
  
  const purchasePrice = parseFloat(entry?.purchase_price || 0);
  let roiHTML = '';
  if (purchasePrice > 0) {
    const netRoi = ((net - purchasePrice) / purchasePrice) * 100;
    const roiColor = netRoi >= 0 ? 'var(--up)' : 'var(--bv-red)';
    roiHTML = `<div style="font-size:11px;margin-top:4px;">Net ROI: <strong style="color:${roiColor};">${netRoi >= 0 ? '+' : ''}${netRoi.toFixed(1)}%</strong></div>`;
  }
  
  return `
    <div class="flip-calc-wrap" style="margin-top:12px;padding:12px;background:var(--surface-3);border:1.5px solid var(--line-soft);border-radius:var(--r-2);">
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-mute);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;">Flip Calculator 💸</div>
      <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;text-align:center;font-size:12px;">
        <div>
          <div style="color:var(--ink-mute);font-size:10px;">Gross</div>
          <strong style="font-size:13px;">$${gross.toFixed(2)}</strong>
        </div>
        <div>
          <div style="color:var(--ink-mute);font-size:10px;">Fees & Ship</div>
          <span style="color:var(--bv-red);font-weight:600;">-$${totalFees.toFixed(2)}</span>
        </div>
        <div>
          <div style="color:var(--ink-mute);font-size:10px;">Est. Net</div>
          <strong style="color:var(--up);font-size:13px;">$${net.toFixed(2)}</strong>
        </div>
      </div>
      <div class="flip-result" style="text-align:left;">${roiHTML}</div>
    </div>`;
}

function updateFlipCalc(set, entry, storePrice) {
  const container = document.querySelector(".flip-calc-wrap");
  if (!container) return;
  const price = parseFloat(storePrice) || 0;
  const condition = entry?.condition || 'new';
  const market = parseFloat(set.ebay_value || set.current_value || 0);
  if (market <= 0) return;

  let estPrice = market;
  if (condition.startsWith('used')) {
    const ratio = (set.used_value && set.current_value) ? (set.used_value / set.current_value) : 0.75;
    estPrice = market * ratio;
  }
  const ebayFee = estPrice * 0.1325;
  const paypalFee = estPrice * 0.029 + 0.30;
  const shipping = 5.00;
  const gross = estPrice;
  const totalFees = ebayFee + paypalFee + shipping;
  const net = Math.max(0, gross - totalFees);

  const resultEl = container.querySelector(".flip-result");
  if (resultEl) {
    if (price > 0) {
      const netRoi = ((net - price) / price) * 100;
      const roiColor = netRoi >= 0 ? 'var(--up)' : 'var(--bv-red)';
      resultEl.innerHTML = `<div style="font-size:11px;margin-top:4px;">Net ROI: <strong style="color:${roiColor};">${netRoi >= 0 ? '+' : ''}${netRoi.toFixed(1)}%</strong></div>`;
    } else {
      resultEl.innerHTML = '';
    }
  }
}

async function triggerRevalue(setNum) {
  haptic("medium");
  const stripCells = document.querySelectorAll(".price-strip .ps-cell");
  const btn = document.getElementById("btnRevalue");
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = "0.5";
    btn.innerHTML = `<span class="spin" style="display:inline-flex;animation:spin 0.8s linear infinite;">${I.refresh({w: 12, h: 12})}</span>`;
  }
  stripCells.forEach(cell => cell.classList.add("loading-shimmer"));
  try {
    const res = await api(`/api/sets/${encodeURIComponent(setNum)}/revalue`, { method: 'POST' });
    if (res && res.set) {
      const oldEntry = state.detail.cache[setNum]?.entry || null;
      state.detail.cache[setNum] = { set: res.set, entry: oldEntry, ts: Date.now() };
      
      if (state.portfolio?.items) {
        const itemIdx = state.portfolio.items.findIndex(i => i.set_num === setNum);
        if (itemIdx !== -1) {
          state.portfolio.items[itemIdx].current_value = res.set.current_value;
          state.portfolio.items[itemIdx].used_value = res.set.used_value;
          state.portfolio.items[itemIdx].ebay_value = res.set.ebay_value;
          state.portfolio.items[itemIdx].retired = res.set.retired;
        }
      }
      
      paintSetDetail(res.set, oldEntry);
      toast("Set value updated!", "success");
    }
  } catch (e) {
    toast(e.message || "Revalue failed", "error");
  } finally {
    stripCells.forEach(cell => cell.classList.remove("loading-shimmer"));
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = "1";
      btn.innerHTML = I.refresh({w: 12, h: 12});
    }
  }
}

function trendBadgeHTML(trend) {
  if (trend === "rising") {
    return `<span class="trend-badge rising" style="display:inline-flex;align-items:center;gap:3px;font-size:10px;color:var(--up);font-weight:700;margin-left:6px;" title="Price trend: Rising">${I.trend({w:10, h:10})} ↑ Rising</span>`;
  }
  if (trend === "falling") {
    return `<span class="trend-badge falling" style="display:inline-flex;align-items:center;gap:3px;font-size:10px;color:var(--bv-red);font-weight:700;margin-left:6px;" title="Price trend: Falling">${I.trend({w:10, h:10})} ↓ Falling</span>`;
  }
  return "";
}

function bricklinkBuyURL(setNum) {
  const clean = setNum.replace(/-1$/, "");
  return `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${clean}-1`;
}

function refreshNavBadge() {
  const alerts = state.wishlistAlerts || [];
  const spikes = alerts.filter(a => a.alert_type === 'spike').length;
  const drops = alerts.filter(a => a.alert_type !== 'spike').length;
  const total = spikes + drops;
  
  const el = document.getElementById("wishlistBtn");
  if (!el) return;
  
  let badge = el.querySelector(".nav-badge");
  if (total > 0) {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "nav-badge";
      el.appendChild(badge);
    }
    badge.style.display = "inline-flex";
    badge.textContent = total;
    el.title = `Wishlist Alerts (${spikes} spikes, ${drops} price drops)`;
  } else {
    if (badge) badge.style.display = "none";
    el.removeAttribute("title");
  }
}

function cohortROIHTML(items) {
  const withPurchaseDate = items.filter(i => i.purchased_at && (Number(i.purchase_price) > 0 || Number(i.current_value) > 0));
  if (!withPurchaseDate.length) {
    return `<p style="color:var(--ink-mute);font-size:12px;text-align:center;padding:16px 0;">No sets with purchase dates in vault.</p>`;
  }
  
  const cohorts = {};
  for (const item of withPurchaseDate) {
    const year = new Date(item.purchased_at).getFullYear();
    if (!cohorts[year]) {
      cohorts[year] = { count: 0, totalPaid: 0, totalCurrent: 0 };
    }
    const qty = Number(item.quantity) || 1;
    cohorts[year].count += qty;
    cohorts[year].totalPaid += (Number(item.purchase_price) || 0) * qty;
    cohorts[year].totalCurrent += (Number(item.current_value) || 0) * qty;
  }
  
  const sortedYears = Object.keys(cohorts).sort((a, b) => b - a);
  let html = `<div class="insights-block" style="padding-top:8px;"><div class="insights-label">Cohort Performance by Purchase Year</div>`;
  
  sortedYears.forEach(year => {
    const c = cohorts[year];
    const gain = c.totalCurrent - c.totalPaid;
    const roi = c.totalPaid > 0 ? (gain / c.totalPaid) * 100 : 0;
    const roiColor = roi >= 0 ? 'var(--up)' : 'var(--bv-red)';
    
    const maxVal = Math.max(...Object.values(cohorts).map(x => x.totalCurrent));
    const pct = maxVal > 0 ? (c.totalCurrent / maxVal * 100).toFixed(1) : 0;
    
    html += `
      <div style="margin-bottom:12px;">
        <div style="display:flex;justify-content:between;align-items:center;font-size:12px;margin-bottom:4px;">
          <strong>Year ${year}</strong>
          <span style="color:var(--ink-mute);font-size:11px;margin-left:auto;">${c.count} set${c.count > 1 ? 's' : ''} · Paid ${fmtMoney(c.totalPaid, { cents: 0 })}</span>
        </div>
        <div class="theme-bar-row" style="margin-bottom:2px;">
          <div class="theme-bar-name" style="width:70px;">${fmtMoney(c.totalCurrent, { cents: 0 })}</div>
          <div class="theme-bar-track" style="flex:1;"><div class="theme-bar-fill" style="width:${pct}%;background:var(--bv-yellow);"></div></div>
          <div class="theme-bar-pct" style="color:${roiColor};font-weight:700;">${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%</div>
        </div>
      </div>`;
  });
  
  html += `</div>`;
  return html;
}

function insightsGeneralHTML(items) {
  const themeMap = {};
  for (const item of items) {
    const t = item.theme || "Other";
    themeMap[t] = (themeMap[t] || 0) + (Number(item.current_value) || 0) * (item.quantity || 1);
  }
  const themeTotal = Object.values(themeMap).reduce((a, b) => a + b, 0);
  const topThemes = Object.entries(themeMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const withRoi = items.filter(i => i.annualized_roi != null);
  const roiSorted = [...withRoi].sort((a, b) => b.annualized_roi - a.annualized_roi);
  const leaders = roiSorted.slice(0, 3);
  const losers = roiSorted.filter(i => i.annualized_roi < 0).slice(-3).reverse();

  const riskSorted = items
    .filter(i => !i.retired && (i.retirement_risk_score || 0) > 0)
    .sort((a, b) => (b.retirement_risk_score || 0) - (a.retirement_risk_score || 0))
    .slice(0, 5);

  let html = "";
  if (topThemes.length > 1) {
    html += `<div class="insights-block"><div class="insights-label">Value by theme</div>`;
    for (const [theme, val] of topThemes) {
      const pct = themeTotal > 0 ? (val / themeTotal * 100).toFixed(1) : 0;
      const tc = THEME_COLORS[theme] || `oklch(0.55 0.18 ${themeHue(theme)})`;
      html += `<div class="theme-bar-row">
        <div class="theme-bar-name">${escapeHtml(theme)}</div>
        <div class="theme-bar-track"><div class="theme-bar-fill" style="width:${pct}%;background:${tc};"></div></div>
        <div class="theme-bar-pct">${pct}%</div>
      </div>`;
    }
    html += `</div>`;
  }

  if (leaders.length > 0) {
    html += `<div class="insights-block"><div class="insights-label">Top performers (annualized ROI)</div>`;
    for (const item of leaders) {
      html += `<a href="#/set/${encodeURIComponent(item.set_num)}" class="insights-row">
        <span class="ir-name">${escapeHtml(item.name)}</span>
        <span class="ir-roi" style="color:var(--up);">+${(item.annualized_roi * 100).toFixed(1)}% / yr</span>
      </a>`;
    }
    html += `</div>`;
  }

  if (losers.length > 0) {
    html += `<div class="insights-block"><div class="insights-label">Underperformers</div>`;
    for (const item of losers) {
      html += `<a href="#/set/${encodeURIComponent(item.set_num)}" class="insights-row">
        <span class="ir-name">${escapeHtml(item.name)}</span>
        <span class="ir-roi" style="color:var(--down);">${(item.annualized_roi * 100).toFixed(1)}% / yr</span>
      </a>`;
    }
    html += `</div>`;
  }

  if (riskSorted.length > 0) {
    html += `<div class="insights-block"><div class="insights-label">Retirement risk — act now</div>`;
    for (const item of riskSorted) {
      const score = item.retirement_risk_score || 0;
      const barWidth = Math.min(100, score);
      const color = score >= 70 ? "var(--down)" : score >= 40 ? "var(--bv-yellow)" : "var(--up)";
      html += `<a href="#/set/${encodeURIComponent(item.set_num)}" class="insights-row">
        <span class="ir-name">${score >= 70 ? "🔥 " : ""}${escapeHtml(item.name)}</span>
        <div style="display:flex;align-items:center;gap:6px;">
          <div style="width:60px;height:4px;border-radius:2px;background:var(--line);overflow:hidden;">
            <div style="width:${barWidth}%;height:100%;background:${color};border-radius:2px;"></div>
          </div>
          <span class="ir-roi" style="color:${color};">${score}</span>
        </div>
      </a>`;
    }
    html += `</div>`;
  }
  return html;
}

function wireInsightsTabs(items) {
  const panel = $("#insightsPanel");
  if (!panel) return;
  panel.querySelectorAll(".insights-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      haptic("light");
      panel.querySelectorAll(".insights-tab").forEach(t => t.classList.toggle("active", t === tab));
      const activeTab = tab.dataset.tab;
      const contentEl = panel.querySelector("#insightsTabContent");
      if (contentEl) {
        if (activeTab === "general") {
          contentEl.innerHTML = insightsGeneralHTML(items);
        } else if (activeTab === "cohort") {
          contentEl.innerHTML = cohortROIHTML(items);
        }
      }
    });
  });
}

/* ============================================================
   Init
   ============================================================ */
// Global image-fallback handler. CSP (`script-src 'self'`) blocks inline
// onerror/onload attributes, so we delegate via a single capture-phase
// listener instead. When a photo fails, drop the `.has-photo` class on its
// container (revealing the brick-tile / silhouette placeholder) and remove
// the broken <img> so no broken-image icon shows.
const PHOTO_SEL = "img.set-photo, img.fig-photo, .scan-result-row .si img, .fig-detail-hero img.fig-photo";
document.addEventListener("error", (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (!img.matches(PHOTO_SEL)) return;
  const holder = img.closest(".sl-img, .set-card-img, .detail-img, .mini-img, .si, .fig-detail-hero");
  if (holder) {
    holder.classList.remove("has-photo");
    holder.classList.remove("photo-loaded");
  }
  img.remove();
}, true); // capture — image error events don't bubble

document.addEventListener("load", (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (!img.matches(PHOTO_SEL)) return;
  const holder = img.closest(".sl-img, .set-card-img, .detail-img, .mini-img, .si, .fig-detail-hero");
  if (holder) holder.classList.add("photo-loaded");
}, true); // capture — image load events don't bubble

// Handle already-cached/completed images on injection via MutationObserver
const photoObserver = new MutationObserver(() => {
  document.querySelectorAll(PHOTO_SEL).forEach(img => {
    if (img.complete && img.naturalWidth > 0) {
      const holder = img.closest(".sl-img, .set-card-img, .detail-img, .mini-img, .si, .fig-detail-hero");
      if (holder) holder.classList.add("photo-loaded");
    }
  });
});
photoObserver.observe(document.documentElement, { childList: true, subtree: true });

/* ============================================================
   Price strip (BrickLink new | Used | eBay avg)
   ============================================================ */
function priceStripHTML(set, entry) {
  const delta = entry?.purchase_price ? (set.current_value - entry.purchase_price) / entry.purchase_price : null;
  return `
    <div class="price-strip">
      <div class="ps-cell${entry ? " high" : ""}">
        <div class="ps-lbl">BrickLink new</div>
        <div class="ps-val">${set.current_value ? fmtMoney(set.current_value) : "—"}${set.trend ? trendBadgeHTML(set.trend) : ""}</div>
        ${delta != null ? `<div class="delta ${delta >= 0 ? "up" : "down"}"><span class="arrow">${delta >= 0 ? "▲" : "▼"}</span>${fmtPct(Math.abs(delta))}</div>` : ""}
      </div>
      <div class="ps-cell">
        <div class="ps-lbl">Used</div>
        <div class="ps-val${!set.used_value ? " muted" : ""}">${set.used_value ? fmtMoney(set.used_value) : "—"}</div>
      </div>
      <div class="ps-cell">
        <div class="ps-lbl">eBay avg</div>
        <div class="ps-val${!set.ebay_value ? " muted" : ""}">${set.ebay_value ? fmtMoney(set.ebay_value) : "—"}</div>
      </div>
    </div>
    <div class="ps-footnote" style="display:flex;align-items:center;justify-content:space-between;width:100%;">
      <span>BrickLink · BrickLink used · eBay last 20 sales</span>
      <button class="icon-btn" id="btnRevalue" title="Refresh prices" style="padding:4px;border:none;background:transparent;cursor:pointer;color:var(--ink-mute);display:inline-flex;align-items:center;margin-left:8px;">
        ${I.refresh({w: 12, h: 12})}
      </button>
    </div>`;
}

/* ============================================================
   In-store Deal Score
   ============================================================ */
function computeDealScore(set, storePrice) {
  const market = set.ebay_value || set.current_value;
  if (!market || !storePrice || storePrice <= 0) return null;
  const pct = (market - storePrice) / market;
  const greatThreshold = set.retired ? 0.05 : 0.15;
  let verdict, label;
  if (pct >= greatThreshold) {
    verdict = "great";
    label = `${fmtPct(pct)} below market — great deal!`;
  } else if (pct <= -0.05) {
    verdict = "over";
    label = `${fmtPct(Math.abs(pct))} above market — overpriced`;
  } else {
    verdict = "fair";
    label = `Within ${fmtPct(Math.abs(pct))} of market price`;
  }
  return { verdict, pct, label };
}

function dealScoreHTML(set) {
  return `
    <div class="deal-score-wrap" id="dealScoreWrap">
      <div class="deal-score-lbl">In-store price check</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input type="number" class="deal-price-input" id="dealPriceInput" placeholder="Enter store price…" min="0" step="0.01">
        <div class="deal-badge" id="dealBadge"></div>
      </div>
    </div>`;
}

function updateDealBadge(set, priceStr) {
  const badge = document.getElementById("dealBadge");
  if (!badge) return;
  const price = parseFloat(priceStr);
  if (!price || price <= 0) { badge.textContent = ""; badge.className = "deal-badge"; return; }
  const score = computeDealScore(set, price);
  if (!score) return;
  badge.className = `deal-badge ${score.verdict}`;
  const labels = { great: "GREAT DEAL", fair: "FAIR PRICE", over: "OVERPRICED" };
  badge.textContent = labels[score.verdict];
  badge.title = score.label;
}

/* ============================================================
   Spike alert card
   ============================================================ */
function spikeAlertCardHTML(a) {
  const gain = a.purchase_price && a.current_value
    ? (a.current_value - (a.purchase_price || 0)) / (a.purchase_price || 1) : 0;
  return `
    <div class="alert-card spike-alert" data-set="${escapeHtml(a.set_num || "")}">
      <div class="ah">${I.dollar()}Sell opportunity · ${daysAgo(a.triggered_at)}d ago</div>
      <div style="font-weight:600;">${escapeHtml(a.set_name || a.name || "")}</div>
      <div style="font-size:13px;margin-top:4px;">
        Now <strong>${fmtMoney(a.current_value)}</strong> — you paid ${fmtMoney(a.purchase_price || 0)}.
        <span style="color:var(--up);font-weight:700;"> +${fmtPct(Math.abs(gain))} gain</span>
      </div>
      <a href="#/set/${encodeURIComponent(a.set_num || "")}" class="btn-secondary" style="display:inline-flex;align-items:center;gap:6px;margin-top:10px;font-size:13px;padding:6px 14px;text-decoration:none;">Consider selling ${I.arrowR()}</a>
    </div>`;
}

/* ============================================================
   Advisor chat
   ============================================================ */
const ADVISOR_PROMPTS = [
  "Which sets should I sell this month?",
  "Best buy with $200 budget?",
  "Which of my sets might retire soon?",
  "How is my Star Wars collection doing?",
];

async function renderAdvisor() {
  const savedGeminiKey = localStorage.getItem('bv_gemini_key') || '';
  let chatHistory = [];
  try { chatHistory = JSON.parse(localStorage.getItem('bv_chat') || '[]'); } catch {}

  $("#root").innerHTML = `
    <div class="page" id="chatWrap">
      <div class="topbar">
        <div class="topbar-heading">
          <div class="topbar-eyebrow">AI-powered · knows your vault</div>
          <div class="topbar-title">Advisor</div>
        </div>
        ${chatHistory.length > 0 ? `<button class="icon-btn" id="clearChat" aria-label="Clear history">${I.trash()}</button>` : ""}
      </div>
      <div class="chat-history" id="chatHistory">
        ${chatHistory.length === 0 ? `
          <div class="chat-suggestions" id="chatSuggestions">
            ${!savedGeminiKey ? `
              <div class="chat-gemini-card">
                <div style="font-weight:600;font-size:13px;margin-bottom:4px;display:flex;align-items:center;gap:6px;">
                  ${I.flash({w:16})}<span>Get Free Gemini Key</span>
                </div>
                <div style="font-size:12px;color:var(--ink-mute);line-height:1.45;">
                  Unlock unlimited, fast AI advice and scans! Get a key in 30 seconds at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="color:var(--bv-red);font-weight:600;text-decoration:underline;">Google AI Studio</a> and save it in the <strong>Me</strong> tab.
                </div>
              </div>` : ""}
            <div style="font-size:14px;color:var(--ink-mute);text-align:center;margin-bottom:8px;">Ask about your collection…</div>
            ${ADVISOR_PROMPTS.map(p => `<button class="chat-suggestion-chip">${escapeHtml(p)}</button>`).join("")}
          </div>` :
          chatHistory.map(m => `<div class="chat-msg ${m.role === "user" ? "user" : "ai"}">${m.role === "ai" ? parseMarkdown(m.content) : escapeHtml(m.content)}</div>`).join("")
        }
      </div>
      <div class="chat-input-row">
        <textarea class="chat-input" id="chatInput" placeholder="Ask anything about your collection…" rows="1"></textarea>
        <button class="chat-send-btn" id="chatSend" aria-label="Send">${I.arrowU()}</button>
      </div>
    </div>`;

  $$(".chat-suggestion-chip").forEach(chip => {
    chip.addEventListener("click", () => sendAdvisorMessage(chip.textContent.trim()));
  });
  $("#clearChat")?.addEventListener("click", () => clearAdvisorHistory());

  const input = document.getElementById("chatInput");
  const sendBtn = document.getElementById("chatSend");

  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const q = input.value.trim();
      if (q) { input.value = ""; input.style.height = "auto"; sendAdvisorMessage(q); }
    }
  });
  input?.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });
  sendBtn?.addEventListener("click", () => {
    const q = input?.value.trim();
    if (q) { input.value = ""; input.style.height = "auto"; sendAdvisorMessage(q); }
  });

  const hist = document.getElementById("chatHistory");
  if (hist) hist.scrollTop = hist.scrollHeight;
}

async function sendAdvisorMessage(q) {
  document.getElementById("chatSuggestions")?.remove();

  const hist = document.getElementById("chatHistory");
  if (!hist) return;

  appendChatBubble("user", q);
  saveChatMessage("user", q);

  const aiBubble = appendChatBubble("ai", "", true);

  try {
    const geminiKey = localStorage.getItem('bv_gemini_key');
    const extraHeaders = geminiKey ? { 'X-Gemini-Key': geminiKey } : {};
    const resp = await api("/api/advisor", {
      method: "POST",
      body: { q },
      headers: extraHeaders,
      stream: true,
    });

    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let fullText = "";

    aiBubble.querySelector(".chat-typing")?.remove();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const parsed = JSON.parse(line.slice(6));
          if (parsed.text) {
            fullText += parsed.text;
            aiBubble.innerHTML = parseMarkdown(fullText);
            hist.scrollTop = hist.scrollHeight;
          }
          if (parsed.done) break;
        } catch {}
      }
    }
    if (fullText) saveChatMessage("ai", fullText);
  } catch (err) {
    aiBubble.querySelector(".chat-typing")?.remove();
    aiBubble.textContent = "Sorry, couldn't reach the advisor. " + (err.message || "");
    aiBubble.classList.add("error");
  }

  hist.scrollTop = hist.scrollHeight;

  if (!document.getElementById("clearChat")) {
    const topbar = document.querySelector("#chatWrap .topbar");
    if (topbar) {
      const btn = document.createElement("button");
      btn.className = "icon-btn"; btn.id = "clearChat";
      btn.setAttribute("aria-label", "Clear history");
      btn.innerHTML = I.trash();
      btn.addEventListener("click", () => clearAdvisorHistory());
      topbar.appendChild(btn);
    }
  }
}

function appendChatBubble(role, content, streaming = false) {
  const hist = document.getElementById("chatHistory");
  if (!hist) return null;
  const el = document.createElement("div");
  el.className = `chat-msg ${role === "user" ? "user" : "ai"}`;
  if (streaming) {
    el.innerHTML = `<span class="chat-typing"><span></span><span></span><span></span></span>`;
  } else {
    el.innerHTML = role === "ai" ? parseMarkdown(content) : escapeHtml(content);
  }
  hist.appendChild(el);
  hist.scrollTop = hist.scrollHeight;
  return el;
}

function saveChatMessage(role, content) {
  try {
    const msgs = JSON.parse(localStorage.getItem('bv_chat') || '[]');
    msgs.push({ role, content });
    localStorage.setItem('bv_chat', JSON.stringify(msgs.slice(-20)));
  } catch {}
}

function clearAdvisorHistory() {
  localStorage.removeItem('bv_chat');
  renderAdvisor();
}

/* ============================================================
   Public collection profile
   ============================================================ */
async function renderPublicProfile(handle) {
  let profile;
  try {
    const r = await fetch((window.WORKER_BASE || '') + "/api/users/" + encodeURIComponent(handle) + "/profile");
    if (!r.ok) throw new Error(r.status === 404 ? "Profile not found or private" : "Couldn't load profile");
    profile = await r.json();
  } catch (err) {
    const nav = document.getElementById("nav");
    if (nav) nav.style.display = "";
    $("#root").innerHTML = `<div class="page">
      <div class="topbar">
        <div class="topbar-heading"><div class="topbar-title">Profile</div></div>
        <button class="icon-btn" id="pubBack">${I.chevL()}</button>
      </div>
      <div class="empty card">
        <div class="empty-icon">${I.user()}</div>
        <h3>Profile not found</h3>
        <p>${escapeHtml(err.message)}</p>
      </div>
    </div>`;
    document.getElementById("pubBack")?.addEventListener("click", () => { if (history.length > 1) history.back(); else location.hash = "#/"; });
    return;
  }
  const nav = document.getElementById("nav");
  if (nav) nav.style.display = "";
  $("#root").innerHTML = `
    <div class="page">
      <div class="topbar">
        <div class="topbar-heading">
          <div class="topbar-eyebrow">@${escapeHtml(profile.handle || handle)}</div>
          <div class="topbar-title">${escapeHtml(profile.display_name || handle)}</div>
        </div>
        <button class="icon-btn" id="pubBack" aria-label="Back">${I.chevL()}</button>
      </div>
      ${publicStatsHTML(profile)}
      ${(profile.showcase || []).length > 0 ? `
        <div class="section-title">Trophy Shelf</div>
        ${trophyShelfHTML(profile.showcase)}` : ""}
    </div>`;
  document.getElementById("pubBack")?.addEventListener("click", () => { if (history.length > 1) history.back(); else location.hash = "#/"; });
}

function publicStatsHTML(profile) {
  const themeTotal = (profile.top_themes || []).reduce((s, t) => s + (t.value || 0), 0);
  return `
    <div class="summary-grid" style="margin-bottom:14px;">
      <div class="summary-cell"><div class="lbl">Sets</div><div class="val">${profile.set_count || 0}</div></div>
      <div class="summary-cell"><div class="lbl">Collection value</div><div class="val">${fmtMoneyShort(profile.total_value || 0)}</div></div>
    </div>
    ${(profile.top_themes || []).length > 1 ? `
      <div class="card" style="padding:14px 16px;margin-bottom:14px;">
        <div style="font-family:var(--mono);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-mute);margin-bottom:10px;">Top themes</div>
        ${profile.top_themes.map(t => {
          const pct = themeTotal > 0 ? (t.value / themeTotal * 100).toFixed(1) : 0;
          const tc = THEME_COLORS[t.theme] || `oklch(0.55 0.18 ${themeHue(t.theme || "")})`;
          return `<div class="theme-bar-row">
            <div class="theme-bar-name">${escapeHtml(t.theme || "Other")}</div>
            <div class="theme-bar-track"><div class="theme-bar-fill" style="width:${pct}%;background:${tc};"></div></div>
            <div class="theme-bar-pct">${pct}%</div>
          </div>`;
        }).join("")}
      </div>` : ""}`;
}

function trophyShelfHTML(sets) {
  return `<div class="trophy-shelf">${(sets || []).map(s => {
    const hasImg = s.image_url && !s.image_url.startsWith("data:");
    const h = setHue(s);
    return `<a href="#/set/${encodeURIComponent(s.set_num)}" class="trophy-card">
      <div class="set-card-img${hasImg ? " has-photo" : ""}">
        <div class="brick-tile" style="--h:${h};width:64%;height:64%;"></div>
        ${hasImg ? `<img class="set-photo" src="${escapeHtml(s.image_url)}" alt="" loading="lazy">` : ""}
        ${s.retired ? `<span class="retired-tag">RETIRED</span>` : ""}
      </div>
      <div class="trophy-card-name">${escapeHtml(s.name)}</div>
      <div class="trophy-card-val">${fmtMoney(s.current_value)}</div>
    </a>`;
  }).join("")}</div>`;
}

function publicProfileSectionHTML(me) {
  let handle = me.handle || "";
  if (handle && !/^[a-zA-Z0-9-]{3,30}$/.test(handle)) {
    handle = "";
  }
  const isPublic = !!me.is_public;
  const shareUrl = handle ? `${location.origin}/#/u/${encodeURIComponent(handle)}` : "";
  return `
    <div class="section-title">Public Profile</div>
    <div>
      <div class="setting-row">
        <div class="lbl-wrap">
          <div class="lbl">Public profile</div>
          <div class="desc">${isPublic ? "Your profile is visible to anyone with the link." : "Enable to share your collection publicly."}</div>
        </div>
        <button class="toggle ${isPublic ? "on" : ""}" id="publicToggle" aria-pressed="${isPublic}"></button>
      </div>
      <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
        <div class="lbl-wrap">
          <div class="lbl">Handle</div>
          <div class="desc">Your public URL: <code>/#/u/${escapeHtml(handle || "your-handle")}</code></div>
        </div>
        <div style="display:flex;gap:8px;width:100%;">
          <input type="text" id="handleInput" value="${escapeHtml(handle)}" placeholder="your-handle"
            style="flex:1;padding:10px;border:1.5px solid var(--line);border-radius:var(--r-2);background:var(--surface-2);color:var(--ink);font-size:13px;font-family:var(--mono);outline:none;">
          <button class="btn-secondary" id="saveHandle" style="white-space:nowrap;">Save</button>
        </div>
      </div>
      ${isPublic && shareUrl ? `
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Share link</div><div class="desc" style="word-break:break-all;">${escapeHtml(shareUrl)}</div></div>
          <button class="import-btn" id="copyShareLink" aria-label="Copy link">${I.share()}</button>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Trophy shelf</div><div class="desc">Choose up to 6 sets for your public profile.</div></div>
          <button class="import-btn" id="editShowcaseBtn" aria-label="Edit showcase">${I.pencil()}</button>
        </div>` : ""}
    </div>`;
}

async function showShowcaseSheet() {
  const me = state.me;
  if (!me?.handle) { toast("Set a handle first to create a showcase", "info"); return; }
  const items = state.portfolio?.items || [];

  let current = [];
  try {
    const r = await fetch((window.WORKER_BASE || '') + "/api/users/" + encodeURIComponent(me.handle) + "/profile");
    if (r.ok) { const p = await r.json(); current = (p.showcase || []).map(s => s.set_num); }
  } catch {}

  let selected = [...current];

  function buildSheetHTML() {
    return `
      <div style="font-family:var(--serif);font-size:20px;font-weight:500;margin:0 4px 12px;">Trophy Shelf <span style="font-size:14px;color:var(--ink-mute);">(${selected.length}/6)</span></div>
      <div id="showcaseGrid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-height:55vh;overflow-y:auto;padding-bottom:8px;">
        ${items.map(item => {
          const sel = selected.includes(item.set_num);
          const rank = selected.indexOf(item.set_num) + 1;
          const hasImg = item.image_url && !item.image_url.startsWith("data:");
          const h = setHue(item);
          return `<button class="showcase-pick${sel ? " sel" : ""}" data-set="${escapeHtml(item.set_num)}" style="position:relative;border-radius:var(--r-2);padding:6px;border:2px solid ${sel ? "var(--bv-red)" : "var(--line)"};background:var(--surface-2);text-align:left;">
            <div class="set-card-img${hasImg ? " has-photo" : ""}" style="height:70px;border-radius:var(--r-1);">
              <div class="brick-tile" style="--h:${h};width:64%;height:64%;"></div>
              ${hasImg ? `<img class="set-photo" src="${escapeHtml(item.image_url)}" alt="" loading="lazy">` : ""}
            </div>
            <div style="font-size:11px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:4px;">${escapeHtml(item.name)}</div>
            ${sel ? `<span style="position:absolute;top:4px;right:4px;background:var(--bv-red);color:#fff;font-size:10px;font-weight:700;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;line-height:1;">${rank}</span>` : ""}
          </button>`;
        }).join("")}
      </div>
      <button class="btn-primary" id="saveShowcase" style="width:100%;margin-top:14px;">${I.check()}<span>Save showcase</span></button>`;
  }

  showSheet(buildSheetHTML());

  function wireShowcase() {
    $$(".showcase-pick").forEach(btn => btn.addEventListener("click", () => {
      const setNum = btn.dataset.set;
      const idx = selected.indexOf(setNum);
      if (idx >= 0) { selected.splice(idx, 1); }
      else if (selected.length < 6) { selected.push(setNum); }
      else { toast("Max 6 sets for the showcase", "info"); return; }
      const sheet = document.getElementById("sheet");
      if (sheet) { sheet.innerHTML = `<div class="sheet-handle"></div>` + buildSheetHTML(); wireShowcase(); }
    }));
    document.getElementById("saveShowcase")?.addEventListener("click", async () => {
      try {
        await api("/api/users/" + encodeURIComponent(me.handle) + "/showcase", {
          method: "POST", body: { set_nums: selected },
        });
        hideSheet();
        toast("Showcase updated", "success");
      } catch (err) { toast("Error: " + err.message, "error"); }
    });
  }
  wireShowcase();
}

/* ============================================================
   eBay Listing Generator
   ============================================================ */
async function showListingSheet(set, entry) {
  showSheet(`
    <div style="font-family:var(--serif);font-size:20px;font-weight:500;margin:0 4px 12px;">Generate eBay Listing</div>
    <div class="listing-sheet" id="listingContent">
      <div style="text-align:center;padding:40px 0;color:var(--ink-mute);">
        ${I.sparkles()}
        <div style="margin-top:8px;font-size:13px;">Generating listing…</div>
      </div>
    </div>`);

  try {
    const geminiKey = localStorage.getItem('bv_gemini_key');
    const extraHeaders = geminiKey ? { 'X-Gemini-Key': geminiKey } : {};
    const draft = await api("/api/sets/" + encodeURIComponent(set.set_num) + "/listing-draft", {
      method: "POST", headers: extraHeaders,
    });

    const content = document.getElementById("listingContent");
    if (!content) return;

    content.innerHTML = `
      <div class="listing-field-label">Title</div>
      <input class="listing-title-input" id="listTitle" type="text" value="${escapeHtml(draft.title || "")}">

      <div class="listing-field-label" style="margin-top:14px;">Description</div>
      <textarea class="listing-desc-textarea" id="listDesc" rows="6">${escapeHtml(draft.description || "")}</textarea>

      <div class="listing-price-row">
        <div>
          <div class="listing-field-label">Suggested price</div>
          <div style="font-family:var(--mono);font-size:22px;font-weight:600;">${fmtMoney(draft.suggested_price)}</div>
        </div>
      </div>
      ${draft.price_reasoning ? `<div class="listing-reasoning">${escapeHtml(draft.price_reasoning)}</div>` : ""}

      <div class="listing-actions">
        <button class="btn-secondary" id="copyListTitle">${I.check()}<span>Copy title</span></button>
        <button class="btn-secondary" id="copyListDesc">${I.check()}<span>Copy description</span></button>
        <a class="btn-primary listing-ebay-btn" href="${escapeHtml(`https://www.ebay.com/sl/list?title=${encodeURIComponent((draft.title || "").slice(0, 80))}`)}" target="_blank" rel="noopener">${I.arrowR()}<span>Open eBay</span></a>
      </div>`;

    document.getElementById("copyListTitle")?.addEventListener("click", () => copyListingField(draft.title || "", "Title"));
    document.getElementById("copyListDesc")?.addEventListener("click", () => copyListingField(draft.description || "", "Description"));
  } catch (err) {
    const content = document.getElementById("listingContent");
    if (content) content.innerHTML = `<p style="color:var(--down);font-size:13px;padding:16px 0;">Error: ${escapeHtml(err.message)}</p>`;
  }
}

function copyListingField(text, label) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => toast(`${label} copied`, "success"))
      .catch(() => _fallbackCopy(text, label));
  } else {
    _fallbackCopy(text, label);
  }
}

function _fallbackCopy(text, label) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); toast(`${label} copied`, "success"); } catch {}
  document.body.removeChild(ta);
}

async function hydrateFromIDB() {
  const MAX_AGE = 3_600_000; // 1 hour
  const now = Date.now();
  try {
    const [p, c, b] = await Promise.all([
      bvIDB.get('portfolio'), bvIDB.get('catalog'), bvIDB.get('blind'),
    ]);
    if (p?.ts && now - p.ts < MAX_AGE) state.portfolio = p.data;
    if (c?.ts && now - c.ts < MAX_AGE && c.data?.items?.length) {
      Object.assign(state.catalog, c.data);
      state.catalog._stale = true;
    }
    if (b?.ts && now - b.ts < MAX_AGE && b.data?.items?.length) {
      Object.assign(state.blind, b.data);
      state.blind._stale = true;
    }
  } catch {}
}

document.addEventListener("DOMContentLoaded", async () => {
  // Load session and Supabase config before any routing.
  _authSession = loadSession();
  try {
    const cfg = await fetch((window.WORKER_BASE || '') + "/api/config").then(r => r.json());
    _sbUrl = cfg.supabase_url || "";
    _sbAnonKey = cfg.supabase_anon_key || "";
  } catch {}

  // Detect Supabase OAuth return (hash fragment: #access_token=...&refresh_token=...&expires_in=...)
  if (location.hash.includes('access_token=')) {
    try {
      const hp = new URLSearchParams(location.hash.slice(1));
      if (hp.has('access_token')) {
        const oauthSess = {
          access_token: hp.get('access_token'),
          refresh_token: hp.get('refresh_token'),
          expires_at: Date.now() / 1000 + parseInt(hp.get('expires_in') || '3600'),
        };
        saveSession(oauthSess);
        _authSession = oauthSess;
        history.replaceState(null, '', location.pathname + location.search);
      }
    } catch {}
  }

  // Wire nav icons using icon library
  const icons = { "/": I.home, "/add": I.search, "/minifigs": I.figure, "/advisor": I.advisor, "/me": I.user };
  $$("#nav .nav-tab").forEach(t => {
    const r = t.dataset.route;
    const iconFn = icons[r];
    const iconEl = t.querySelector(".nav-icon");
    if (iconFn && iconEl) iconEl.innerHTML = iconFn();
    const orb = t.querySelector(".scan-orb");
    if (orb) orb.innerHTML = I.scan();
    t.addEventListener("click", () => {
      haptic("light");
      if (t.classList.contains("active")) window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  // Re-assert the stored theme (the inline bootstrap set it pre-paint; this
  // wires up meta theme-color + keeps state consistent after hydration).
  applyTheme(getThemePref());

  // PWA install prompt — preventDefault so we can surface our own install card.
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); state.pwa.deferredPrompt = e; });

  // Offline indicator
  const offlineHandler = () => document.body.classList.toggle("offline", !navigator.onLine);
  window.addEventListener("online", () => { offlineHandler(); drainOutbox(); });
  window.addEventListener("offline", offlineHandler);
  offlineHandler();

  setupGestures();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js")
      .then(reg => reg.update())
      .catch(() => {});
    navigator.serviceWorker.addEventListener("controllerchange", () => location.reload());
  }

  // Hydrate in-memory state from IDB so first tab visit is instant.
  if (_authSession) await hydrateFromIDB();

  // Initial route — after config and session are loaded.
  await route();
});

window.addEventListener("hashchange", route);
window.bv = { openScan, closeScan, capturePhoto };
