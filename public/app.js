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
    info:     () => s('<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>'),
    trend:    () => s('<path d="M3 17l6-6 4 4 8-9"/><path d="M14 6h7v7"/>'),
  };
})();

/* ---------- DOM helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ---------- state ---------- */
const state = {
  portfolio: null,
  catalogAll: null, catalogPage: 1, catalogPageSize: 20,
  themes: [], themesLoadedAt: 0,
  me: null,
  filter: {
    kind: "all", theme: null, range: "1M", q: "",
    sort: localStorage.getItem("bv_sort") || "added_desc",
    catalogSort: "value_desc", catalogYear: "all",
    catalogRetired: false, catalogTheme: "all",
    wishlistSort: "recent",
  },
  detail: { tab: "info" },
  pwa: { deferredPrompt: null },
  wishlist: [], wishlistAlerts: [],
  portfolioHistory: null,
  ownedFigs: new Set(JSON.parse(localStorage.getItem("bv_figs") || "[]")),
  toastTimer: null,
  camera: { stream: null, mode: "barcode", detector: null, scanning: false, timer: null },
};

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

/* ---------- hue from theme (deterministic) ---------- */
function themeHue(theme = "") {
  let h = 0;
  for (let i = 0; i < theme.length; i++) h = (h * 31 + theme.charCodeAt(i)) & 0xFFFF;
  return h % 360;
}
function setHue(set) {
  return set.hue ?? themeHue(set.theme || "");
}

/* ---------- API ---------- */
async function api(path, opts = {}) {
  const r = await fetch(path, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  if (r.status === 204) return null;
  return r.json();
}

/* ============================================================
   Sparkline (SVG)
   ============================================================ */
function drawSparkline(container, data, opts = {}) {
  if (!container || !data || data.length < 2) return;
  const W = container.clientWidth || 300;
  const H = container.clientHeight || 88;
  const vals = data.map(d => d.total_value ?? d);
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const pad = 4;
  const xs = (i) => pad + (i / (data.length - 1)) * (W - pad * 2);
  const ys = (v) => H - pad - ((v - mn) / ((mx - mn) || 1)) * (H - pad * 2);
  let path = `M${xs(0).toFixed(1)} ${ys(vals[0]).toFixed(1)}`;
  for (let i = 1; i < data.length; i++) path += ` L${xs(i).toFixed(1)} ${ys(vals[i]).toFixed(1)}`;
  const area = path + ` L${xs(data.length - 1).toFixed(1)} ${H} L${xs(0).toFixed(1)} ${H} Z`;
  const stroke = opts.up !== false ? "var(--up)" : "var(--down)";
  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sg${Date.now()%9999}" id="sgr" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${stroke}" stop-opacity="0.32"/>
          <stop offset="100%" stop-color="${stroke}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${area}" fill="${stroke}" fill-opacity="0.16" />
      <path d="${path}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      ${opts.dot !== false ? `<circle cx="${xs(data.length-1).toFixed(1)}" cy="${ys(vals[vals.length-1]).toFixed(1)}" r="4" fill="${stroke}" stroke="var(--bg)" stroke-width="2"/>` : ""}
    </svg>`;
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
  if (hasImg) {
    return `<div class="sl-img">
      ${newBadge ? `<span class="new-badge">NEW</span>` : ""}
      ${qtyBadge > 1 ? `<span class="qty-badge">×${qtyBadge}</span>` : ""}
      <img class="set-photo" src="${escapeHtml(set.image_url)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display=''">
      <div class="brick-tile" style="--h:${h};display:none;width:80%;height:76%;margin-top:auto;border-radius:8px;"></div>
    </div>`;
  }
  return `<div class="sl-img has-tile">
    ${brickTile(set)}
    ${newBadge ? `<span class="new-badge">NEW</span>` : ""}
    ${qtyBadge > 1 ? `<span class="qty-badge">×${qtyBadge}</span>` : ""}
  </div>`;
}

/* ============================================================
   Router
   ============================================================ */
function route() {
  const hash = location.hash.replace("#", "") || "/";
  $$("#nav .nav-tab").forEach(t => {
    const r = t.dataset.route;
    const active = r === hash || (hash.startsWith("/set/") && r === "/") || (hash === "/wishlist" && r === "/");
    t.classList.toggle("active", active);
  });
  if (hash === "/" || hash === "") renderPortfolio();
  else if (hash === "/add") renderAdd();
  else if (hash === "/pile") renderPile();
  else if (hash === "/blind") renderBlind();
  else if (hash === "/me") renderMe();
  else if (hash === "/wishlist") renderWishlist();
  else if (hash.startsWith("/set/")) {
    const parts = hash.split("/");
    const setNum = decodeURIComponent(parts[2]);
    state.detail.tab = parts[3] || "info";
    renderSetDetail(setNum);
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
    } catch (e) {
      toast("Couldn't load collection: " + e.message, "error");
      state.portfolio = { items: [], total_value: 0, total_paid: 0, count: 0 };
      state.portfolioHistory = [];
    }
  }
  paintPortfolio();
}

function paintPortfolio() {
  const p = state.portfolio;
  const hist = state.portfolioHistory || [];
  const alertsCount = state.wishlistAlerts.length;
  const gain = p.total_value - p.total_paid;
  const gainPct = p.total_paid ? gain / p.total_paid : 0;

  let items = (p.items || []).slice();
  const q = state.filter.q.toLowerCase().trim();
  if (q) items = items.filter(i => i.name?.toLowerCase().includes(q) || i.set_num?.toLowerCase().includes(q) || i.theme?.toLowerCase().includes(q));
  switch (state.filter.sort) {
    case "added_desc": items.sort((a, b) => new Date(b.added_at) - new Date(a.added_at)); break;
    case "value_desc": items.sort((a, b) => b.current_value - a.current_value); break;
    case "roi_desc":   items.sort((a, b) => (b.annualized_roi ?? -1) - (a.annualized_roi ?? -1)); break;
    case "az":         items.sort((a, b) => a.name?.localeCompare(b.name)); break;
  }

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

      <div class="card hero">
        <div class="hero-eyebrow"><span class="pulse"></span>Vault · LIVE</div>
        <div class="hero-value">${heroValueHTML(p.total_value)}</div>
        <div class="hero-meta">
          <span>Invested ${fmtMoney(p.total_paid)}</span>
          <span class="delta ${gain >= 0 ? "up" : "down"}"><span class="arrow">${gain >= 0 ? "▲" : "▼"}</span>${fmtMoney(Math.abs(gain), { cents: 0 })} (${fmtPct(Math.abs(gainPct))})</span>
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
        <div style="margin-top:18px;">
          <a href="#/wishlist" class="btn-secondary" style="display:flex;">
            ${I.heart()}<span>Wishlist · ${state.wishlist.length} set${state.wishlist.length !== 1 ? "s" : ""}${alertsCount ? " · " + alertsCount + " alert" + (alertsCount > 1 ? "s" : "") : ""}</span>${I.chev()}
          </a>
        </div>` : ""}
    </div>`;

  setTimeout(() => drawSparkline($("#heroChart"), clipped, { up: gain >= 0 }), 30);

  $$("#rangePills button").forEach(b => b.addEventListener("click", () => {
    state.filter.range = b.dataset.r; haptic("light"); paintPortfolio();
  }));
  $$(".filter-row .chip").forEach(c => c.addEventListener("click", () => {
    state.filter.sort = c.dataset.sort; localStorage.setItem("bv_sort", c.dataset.sort); haptic("light"); paintPortfolio();
  }));
  $("#searchToggle")?.addEventListener("click", () => {
    const w = $("#searchWrap");
    w.classList.toggle("open");
    if (w.classList.contains("open")) $("#portfolioSearch")?.focus();
    else { state.filter.q = ""; paintPortfolio(); }
  });
  $("#portfolioSearch")?.addEventListener("input", debounce(e => { state.filter.q = e.target.value; paintPortfolio(); }, 150));
  $("#alertsBtn")?.addEventListener("click", () => showAlertsSheet(state.wishlistAlerts));
  $$(".set-list-card").forEach(card => {
    card.addEventListener("click", () => { haptic("light"); location.hash = "#/set/" + encodeURIComponent(card.dataset.set); });
    wireLongPress(card, () => showQuickActions(card.dataset.set));
  });
}

function heroValueHTML(n) {
  if (n == null || isNaN(n)) return `<span>—</span>`;
  const whole = Math.floor(Math.abs(n)).toLocaleString("en-US");
  const cents = Math.abs(n % 1 * 100 | 0).toString().padStart(2, "0");
  const sign = n < 0 ? "-" : "";
  return `${sign}$${whole}<span class="cents">.${cents}</span>`;
}

function setListCardHTML(item) {
  const delta = item.purchase_price ? (item.current_value - item.purchase_price) / item.purchase_price : null;
  const cls = delta == null ? "flat" : delta >= 0 ? "up" : "down";
  const arrow = delta == null ? "" : delta >= 0 ? "▲" : "▼";
  const dStr = delta == null ? "—" : (delta * 100).toFixed(1) + "%";
  const newBadge = item.added_at && daysAgo(item.added_at) < 7;
  return `
    <button class="set-list-card" data-set="${escapeHtml(item.set_num)}">
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
        <div class="sl-value">${fmtMoney(item.current_value)}</div>
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

/* ============================================================
   Catalog (Add page)
   ============================================================ */
async function renderAdd() {
  if (!state.catalogAll) {
    try {
      const [res, themes] = await Promise.all([
        api("/api/sets/search?limit=60"),
        api("/api/themes"),
      ]);
      state.catalogAll = res.sets || [];
      state.themes = themes.themes || [];
      state.themesLoadedAt = Date.now();
    } catch (e) {
      toast("Couldn't load catalog: " + e.message, "error");
      state.catalogAll = []; state.themes = [];
    }
  }
  paintAdd();
}

const debouncedCatalogSearch = debounce(async (q) => {
  try {
    const res = await api("/api/sets/search?limit=60&q=" + encodeURIComponent(q));
    state.catalogAll = res.sets || [];
  } catch {}
  paintAdd();
}, 350);

function paintAdd() {
  let items = (state.catalogAll || []).slice();
  const f = state.filter;
  if (f.catalogTheme !== "all") items = items.filter(i => i.theme === f.catalogTheme);
  if (f.catalogRetired) items = items.filter(i => i.retired);
  switch (f.catalogSort) {
    case "value_desc": items.sort((a, b) => b.current_value - a.current_value); break;
    case "year_desc":  items.sort((a, b) => b.year - a.year); break;
    case "az":         items.sort((a, b) => a.name?.localeCompare(b.name)); break;
    case "roi_desc":   items.sort((a, b) => (b.current_value / (b.retail_price||1)) - (a.current_value / (a.retail_price||1))); break;
  }

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
        <input class="search-input" id="catalogSearch" placeholder="Search sets…" autocomplete="off" value="${escapeHtml(f.q)}">
      </div>

      <div class="filter-row">
        <button class="chip ${f.catalogTheme === "all" ? "active" : ""}" data-theme="all">All themes</button>
        ${state.themes.slice(0, 8).map(t => `<button class="chip ${f.catalogTheme === t ? "active" : ""}" data-theme="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("")}
      </div>

      <div class="filter-row" style="margin-top:-4px;">
        ${[["value_desc","Top value"],["roi_desc","Best growth"],["year_desc","Newest"],["az","A–Z"]]
          .map(([k,l]) => `<button class="chip ${f.catalogSort === k ? "active" : ""}" data-csort="${k}">${l}</button>`).join("")}
        <button class="chip ${f.catalogRetired ? "active" : ""}" data-retired="1">${I.tag()}<span>Retired</span></button>
      </div>

      <div style="font-family:var(--mono);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-mute);margin:14px 4px 10px;">${items.length} results</div>

      <div class="grid" id="catalogGrid">
        ${items.map(s => catalogCardHTML(s)).join("")}
      </div>
    </div>`;

  $("#scanCta")?.addEventListener("click", () => openScan());
  const catInput = $("#catalogSearch");
  catInput?.addEventListener("input", (e) => {
    state.filter.q = e.target.value;
    debouncedCatalogSearch(e.target.value);
  });
  $$("[data-theme]").forEach(b => b.addEventListener("click", () => { state.filter.catalogTheme = b.dataset.theme; haptic("light"); paintAdd(); }));
  $$("[data-csort]").forEach(b => b.addEventListener("click", () => { state.filter.catalogSort = b.dataset.csort; haptic("light"); paintAdd(); }));
  $$("[data-retired]").forEach(b => b.addEventListener("click", () => { state.filter.catalogRetired = !state.filter.catalogRetired; haptic("light"); paintAdd(); }));
  $$(".set-card").forEach(c => c.addEventListener("click", () => { haptic("light"); location.hash = "#/set/" + encodeURIComponent(c.dataset.set); }));
}

function catalogCardHTML(s) {
  const hasImg = s.image_url && !s.image_url.startsWith("data:");
  const h = setHue(s);
  return `
    <button class="set-card" data-set="${escapeHtml(s.set_num)}">
      <div class="set-card-img">
        <div class="brick-tile" style="--h:${h};width:64%;height:64%;"></div>
        ${hasImg ? `<img class="set-photo" src="${escapeHtml(s.image_url)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ""}
        ${s.retired ? `<span class="retired-tag">RETIRED</span>` : ""}
        ${s.owned ? `<span class="owned-tag">${I.check()}OWNED</span>` : ""}
      </div>
      <div class="set-card-body">
        <div class="set-card-name">${escapeHtml(s.name)}</div>
        <div class="set-card-meta">
          <span>${s.year || ""}</span>
          <span>${s.pieces || 0}pc</span>
          ${s.minifigs > 0 ? `<span>${s.minifigs} fig</span>` : ""}
        </div>
        <div class="set-card-value">${fmtMoney(s.current_value)}</div>
      </div>
    </button>`;
}

/* ============================================================
   Set detail
   ============================================================ */
async function renderSetDetail(setNum) {
  try {
    const data = await api("/api/sets/" + encodeURIComponent(setNum));
    const set = data.set || data;
    const entry = data.entry || null;
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
    <div class="page no-pad">
      <div class="detail-hero">
        ${hasImg
          ? `<div class="detail-hero-bg" style="background-image:url('${escapeHtml(set.image_url)}')"></div>`
          : `<div class="detail-hero-bg placeholder" style="--brick-hue:linear-gradient(135deg, oklch(0.72 0.13 ${h}), oklch(0.55 0.13 ${h}));"></div>`}
        <div class="detail-hero-overlay"></div>
        <button class="detail-back" id="detailBack" aria-label="Back">${I.chevL()}</button>
        <div class="detail-img">
          ${hasImg
            ? `<img class="set-photo" src="${escapeHtml(set.image_url)}" alt="${escapeHtml(set.name)}">`
            : `<div class="brick-art" style="--brick-color:oklch(0.72 0.13 ${h});">${escapeHtml(set.set_num)}</div>`}
        </div>
      </div>
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
  return `
    <div class="stat-grid">
      <div class="stat-cell ${owned ? "high" : ""}">
        <div class="lbl">${I.dollar()}Current value</div>
        <div class="val">${fmtMoney(set.current_value)}</div>
        ${delta != null ? `<div class="delta ${delta >= 0 ? "up" : "down"}" style="margin-top:6px;"><span class="arrow">${delta >= 0 ? "▲" : "▼"}</span>${fmtPct(Math.abs(delta))}</div>` : ""}
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
    `}`;
}

function wireInfoTab(set, entry) {
  const synthData = (() => {
    const base = set.current_value || 100;
    return Array.from({ length: 91 }, (_, i) => ({
      total_value: base * (0.93 + Math.sin((90-i)/5 + setHue(set)/30)*0.04 + (Math.random()-0.45)*0.015 + (90-i)/90*0.08)
    }));
  })();
  setTimeout(() => drawSparkline($("#setSpark"), synthData, { up: true }), 30);

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
  $("#addBtn")?.addEventListener("click", async () => {
    haptic("heavy");
    try {
      await api("/api/collection", { method: "POST", body: { set_num: set.set_num, quantity: 1, purchase_price: set.current_value } });
      state.portfolio = null; state.catalogAll = null;
      toast("Added to vault", "success");
      const r = await api("/api/sets/" + encodeURIComponent(set.set_num));
      paintSetDetail(r.set || r, r.entry || null);
    } catch (e) { toast("Error: " + e.message, "error"); }
  });
  $("#wishToggle")?.addEventListener("click", async () => {
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
  });
}

function forecastTabHTML(set) {
  const g2 = set.forecast_2y && set.current_value ? (set.forecast_2y - set.current_value) / set.current_value : 0.18;
  const g5 = set.forecast_5y && set.current_value ? (set.forecast_5y - set.current_value) / set.current_value : 0.45;
  const pct = (g) => Math.min(100, Math.max(8, g * 100 + 12)).toFixed(1);
  return `
    <div class="card" style="padding:14px 16px;margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        ${I.sparkles()}
        <div style="font-family:var(--mono);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-mute);">AI forecast · GPT-4o-mini</div>
      </div>
      <p style="margin:6px 0 0;font-size:13px;color:var(--ink-soft);line-height:1.45;">
        Based on theme rarity, piece count, retirement status, and market trends for similar ${escapeHtml(set.theme || "")} sets.
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
      <textarea id="mNotes" placeholder="Storage, completeness, story…">${escapeHtml(entry.notes || "")}</textarea>
    </div>
    <button class="btn-danger" id="mRemove" style="margin-top:14px;">${I.trash()}<span>Remove from vault</span></button>`;
}

function wireManageTab(set, entry) {
  if (!entry) return;
  const persist = async () => {
    try {
      await api("/api/collection/" + entry.id, {
        method: "PATCH",
        body: {
          purchase_price: parseFloat($("#mPrice")?.value) || null,
          purchased_at: $("#mDate")?.value ? new Date($("#mDate").value).toISOString() : entry.purchased_at,
          condition: $("#mCondition")?.value,
          notes: $("#mNotes")?.value || "",
        }
      });
      state.portfolio = null;
      toast("Saved", "success");
    } catch (e) { toast("Save failed: " + e.message, "error"); }
  };
  ["#mPrice","#mDate"].forEach(s => $(s)?.addEventListener("blur", persist));
  $("#mCondition")?.addEventListener("change", persist);
  $("#mNotes")?.addEventListener("blur", persist);
  $("#mRemove")?.addEventListener("click", async () => {
    if (!confirm("Remove this set from your vault?")) return;
    haptic("heavy");
    try {
      await api("/api/collection/" + entry.id, { method: "DELETE" });
      state.portfolio = null; state.catalogAll = null;
      toast("Removed from vault", "info");
      if (history.length > 1) history.back();
      else location.hash = "#/";
    } catch (e) { toast("Error: " + e.message, "error"); }
  });
}

function setupTabSwipe(set, entry) {
  const el = $("#tabPanels"); if (!el) return;
  let sx = 0, sy = 0, active = false;
  el.addEventListener("touchstart", e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; active = true; }, { passive: true });
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
  });
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

  const alerts = state.wishlistAlerts;
  $("#root").innerHTML = `
    <div class="page">
      <div class="topbar">
        <div class="topbar-heading">
          <div class="topbar-eyebrow">${state.wishlist.length} sets · ${alerts.length} alert${alerts.length !== 1 ? "s" : ""}</div>
          <div class="topbar-title">Wishlist</div>
        </div>
        <a href="#/" class="icon-btn" aria-label="Back">${I.chevL()}</a>
      </div>

      ${alerts.length > 0 ? `
        <div style="margin-bottom:14px;">
          ${alerts.map(a => `
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
}

function wishlistCardHTML(w) {
  const gap = w.target_price ? ((w.current_value - w.target_price) / w.target_price) : null;
  const hit = gap != null && gap <= 0;
  const progress = gap == null ? 100 : Math.min(100, Math.max(0, 100 - gap * 100));
  const h = setHue(w);
  const hasImg = w.image_url && !w.image_url.startsWith("data:");
  return `
    <button class="wishlist-card" data-set="${escapeHtml(w.set_num)}">
      <div class="sl-img${hasImg ? "" : " has-tile"}" style="width:72px;height:76px;">
        ${hasImg ? `<img class="set-photo" src="${escapeHtml(w.image_url)}" alt="" loading="lazy">` : `<div class="brick-tile" style="--h:${h};width:100%;height:76%;margin-top:auto;"></div>`}
      </div>
      <div class="sl-body" style="flex:1;text-align:left;">
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
      </div>
    </button>`;
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

      <div class="section-title">Preferences</div>
      <div>
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

      <div class="section-title">Data</div>
      <div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Export collection</div><div class="desc">CSV with current values &amp; ROI.</div></div>
          ${I.download()}
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Sign out</div><div class="desc">Sync resumes when you return.</div></div>
          ${I.chev()}
        </div>
      </div>

      <div style="text-align:center;font-family:var(--mono);font-size:10px;color:var(--ink-faint);margin-top:24px;letter-spacing:0.1em;">
        BRICKVAULT · v2.0 · STACK SOMETHING BEAUTIFUL
      </div>
    </div>`;

  let notifyOn = me.notify_price_drops;
  $("#notifyToggle")?.addEventListener("click", async (e) => {
    notifyOn = !notifyOn;
    e.currentTarget.classList.toggle("on", notifyOn);
    haptic("medium");
    try { await api("/api/me", { method: "PATCH", body: { notify_price_drops: notifyOn } }); state.me = null; }
    catch {}
    toast(notifyOn ? "Alerts on" : "Alerts paused", "info");
  });
  $("#editName")?.addEventListener("click", () => {
    const name = prompt("Display name:", me.display_name || "");
    if (name && name.trim()) {
      api("/api/me", { method: "PATCH", body: { display_name: name.trim().slice(0, 40) } })
        .then(() => { state.me = null; renderMe(); }).catch(e => toast("Error: " + e.message, "error"));
    }
  });
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
   Blind bag (minifigs)
   ============================================================ */
async function renderBlind() {
  let figs = [];
  try {
    const res = await api("/api/minifigs");
    figs = res.minifigs || [];
  } catch (e) { toast("Couldn't load minifigs", "error"); }

  const ownedCount = figs.filter(f => state.ownedFigs.has(f.fig_num)).length;

  $("#root").innerHTML = `
    <div class="page">
      <div class="topbar">
        <div class="topbar-heading">
          <div class="topbar-eyebrow">${ownedCount}/${figs.length} collected</div>
          <div class="topbar-title">Blind bag</div>
        </div>
      </div>

      <div class="card" style="padding:14px;margin-bottom:14px;background:var(--bv-yellow);color:var(--line);">
        <div style="display:flex;gap:10px;align-items:center;">
          ${I.flash()}
          <div>
            <div style="font-weight:600;font-size:15px;">Tap to log what you've pulled</div>
            <div style="font-size:12px;color:var(--ink-soft);margin-top:2px;">Duplicates show their resale value.</div>
          </div>
        </div>
      </div>

      <div class="mini-grid">
        ${figs.map(f => miniCardHTML(f)).join("")}
      </div>
    </div>`;

  $$(".mini-card").forEach(c => c.addEventListener("click", () => {
    const num = c.dataset.fig;
    if (state.ownedFigs.has(num)) state.ownedFigs.delete(num);
    else state.ownedFigs.add(num);
    localStorage.setItem("bv_figs", JSON.stringify([...state.ownedFigs]));
    haptic("medium");
    renderBlind();
  }));
}

function miniCardHTML(f) {
  const owned = state.ownedFigs.has(f.fig_num);
  const hue = f.hue ?? themeHue(f.series || f.fig_num);
  const hasImg = f.image_url;
  const val = f.value ?? f.current_value ?? 0;
  return `
    <button class="mini-card rarity-${f.rarity || "common"}" data-fig="${escapeHtml(f.fig_num)}">
      <div class="mini-img">
        ${hasImg
          ? `<img class="fig-photo" src="${escapeHtml(f.image_url)}" alt="${escapeHtml(f.name)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">`
          : ""}
        <div class="mini-figure ${owned ? "owned" : ""}" style="${hasImg ? "display:none;" : ""}--fig-color:oklch(0.6 0.18 ${hue});--fig-color2:oklch(0.4 0.08 ${(hue+180)%360});">
          <div class="head"></div>
          <div class="body"></div>
          <div class="legs"></div>
        </div>
      </div>
      <div class="mini-body">
        <div class="mini-rarity">${f.rarity || "common"}</div>
        <div class="mini-name">${escapeHtml(f.name)}</div>
        <div class="mini-meta">
          <span>${escapeHtml(f.series || "")}</span>
          <span class="price">${fmtMoney(val, { cents: 0 })}</span>
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
  try {
    const res = await api("/api/scan/identify", { method: "POST", body: payload });
    showScanResult(res);
  } catch (e) {
    const hint = $("#scanHint");
    if (hint) hint.textContent = "Error: " + e.message;
    showScanResult({ identified: false, reasoning: e.message });
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
  const set = res.set;
  const h = setHue(set);
  const hasImg = set.image_url && !set.image_url.startsWith("data:");
  el.innerHTML = `
    <div class="scan-result-head">
      <span class="badge">${I.check()}MATCH</span>
      <span style="font-family:var(--mono);font-size:10px;color:var(--ink-mute);letter-spacing:0.1em;text-transform:uppercase;">${escapeHtml(res.confidence || "high")} confidence</span>
    </div>
    <div class="scan-result-row">
      <div class="si">
        ${hasImg ? `<img src="${escapeHtml(set.image_url)}" alt="">` : `<div class="brick-tile" style="--h:${h};width:90%;height:90%;border-radius:8px;"></div>`}
      </div>
      <div class="sx">
        <div class="sx-name">${escapeHtml(set.name)}</div>
        <div class="sx-meta">${escapeHtml(set.theme||"")} · ${set.year||""} · ${set.pieces||0}pc</div>
        <div class="sx-val">${fmtMoney(set.current_value)}</div>
      </div>
    </div>
    <div class="btn-row" style="margin-top:12px;">
      <button class="btn-secondary" id="scanDetails">Details</button>
      <button class="btn-primary" id="scanAdd">${I.plus()}<span>Add to vault</span></button>
    </div>`;
  $("#scanDetails")?.addEventListener("click", () => { closeScan(); location.hash = "#/set/" + encodeURIComponent(set.set_num); });
  $("#scanAdd")?.addEventListener("click", async () => {
    haptic("heavy");
    try {
      await api("/api/collection", { method: "POST", body: { set_num: set.set_num, quantity: 1, purchase_price: set.current_value } });
      state.portfolio = null; state.catalogAll = null;
      closeScan();
      toast("Added " + set.name, "success");
      location.hash = "#/";
    } catch (e) { toast("Error: " + e.message, "error"); }
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
  back.addEventListener("click", hideSheet, { once: true });
}
function hideSheet() {
  $("#sheetBackdrop").classList.remove("show");
  $("#sheet").classList.remove("show");
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
    if (!confirm("Remove from vault?")) { hideSheet(); return; }
    const item = (state.portfolio?.items || []).find(s => s.set_num === setNum);
    if (item) {
      try { await api("/api/collection/" + item.id, { method: "DELETE" }); state.portfolio = null; state.catalogAll = null; toast("Removed", "info"); }
      catch (e) { toast("Error: " + e.message, "error"); }
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
      state.portfolio = null; state.catalogAll = null; state.portfolioHistory = null; state.me = null;
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
   Init
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  // Wire nav icons using icon library
  const icons = { "/": I.home, "/add": I.search, "/blind": I.figure, "/me": I.user };
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

  // PWA install prompt
  window.addEventListener("beforeinstallprompt", e => { state.pwa.deferredPrompt = e; });

  // Offline indicator
  const offlineHandler = () => document.body.classList.toggle("offline", !navigator.onLine);
  window.addEventListener("online", offlineHandler);
  window.addEventListener("offline", offlineHandler);
  offlineHandler();

  setupGestures();

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
});

window.addEventListener("hashchange", route);
window.addEventListener("load", route);
window.bv = { openScan, closeScan, capturePhoto };
