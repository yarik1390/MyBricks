import { $, $$, haptic, escapeHtml, toast, setBtnLoading, setHue, fmtMoney, trendBadgeHTML, THEME_COLORS, bvIDB } from '../utils.js';
import { state } from '../state.js';
import { api, getSessionUserId } from '../api.js';
import { I } from '../icons.js';
import { showSheet, hideSheet } from '../components/sheet.js';
import { openScan } from '../components/scanner.js';

let _catalogGen = 0;

export async function renderAdd() {
  if (!state.themes.length) {
    try { const t = await api("/api/themes"); state.themes = t.themes || []; state.themesLoadedAt = Date.now(); } catch {}
  }
  if (!state.catalog.items.length) {
    await loadCatalog({ reset: true });
    if (isCatalogDefault()) bvIDB.set('catalog', { data: { items: state.catalog.items, total: state.catalog.total, hasMore: state.catalog.hasMore, offset: state.catalog.offset }, ts: Date.now(), userId: getSessionUserId() }).catch(() => {});
  } else if (state.catalog._stale) {
    state.catalog._stale = false;
    loadCatalog({ reset: true }).then(() => {
      if (location.hash === '#/add' && $('#catalogResults')) {
        refreshCatalogGrid();
        if (isCatalogDefault()) bvIDB.set('catalog', { data: { items: state.catalog.items, total: state.catalog.total, hasMore: state.catalog.hasMore, offset: state.catalog.offset }, ts: Date.now(), userId: getSessionUserId() }).catch(() => {});
      }
    }).catch(() => {});
  }
  paintAdd();
}

export async function loadCatalog({ reset = false } = {}) {
  const c = state.catalog;
  if (!reset && c.loading) return [];
  if (!reset && !c.hasMore) return [];
  if (reset) { _catalogGen++; c.offset = 0; c.hasMore = false; c.total = 0; }
  const myGen = _catalogGen;
  c.loading = true;
  try {
    const res = await api("/api/sets/search?" + catalogQuery());
    if (myGen !== _catalogGen) return [];
    const fresh = res.sets || [];
    c.items = reset ? fresh : c.items.concat(fresh);
    c.total = res.total ?? c.items.length;
    c.offset = c.items.length;
    c.hasMore = !!res.hasMore;
    return fresh;
  } catch (e) {
    if (myGen !== _catalogGen) return [];
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

function catalogResultsHTML() {
  const c = state.catalog;
  const f = state.filter;
  const listClass = state.compactView ? "compact-list" : "grid";
  return `
    <div id="catalogCount" class="result-count">${c.total.toLocaleString()} result${c.total === 1 ? "" : "s"}</div>
    ${c.items.length === 0 ? `
      <div class="empty card">
        <div class="empty-icon">${I.search()}</div>
        <h3>No sets found</h3>
        <p>${f.catalogQ ? `Nothing matches "${escapeHtml(f.catalogQ)}".` : "No sets match these filters."} Try a different search or clear filters.</p>
      </div>` : `
      <div class="${listClass}" id="catalogGrid">
        ${c.items.map(s => catalogCardHTML(s)).join("")}
      </div>
      <div id="catalogSentinel" class="load-sentinel" style="${c.hasMore ? "" : "display:none;"}">
        <div class="spinner"></div>
      </div>`}`;
}

function refreshCatalogGrid() {
  const results = $("#catalogResults");
  if (!results) return;
  results.innerHTML = catalogResultsHTML();
  wireCatalogCards();
  mountCatalogSentinel();
}

function wireCatalogCards() {
  $$(".set-card, .set-list-card.compact").forEach(c => c.addEventListener("click", () => { haptic("light"); location.hash = "#/set/" + encodeURIComponent(c.dataset.set); }));
}

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

  $("#root").innerHTML = `
    <div class="page">
      <div class="topbar">
        <div class="topbar-heading">
          <div class="topbar-eyebrow">Catalog</div>
          <div class="topbar-title">Find a set</div>
        </div>
        <div class="topbar-actions" style="margin-left:auto;">
          <button class="icon-btn" id="catalogLayoutToggle" aria-label="Toggle Layout">${state.compactView ? I.grid() : I.list()}</button>
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
  let catalogSearchTimer = null;
  catInput?.addEventListener("input", (e) => {
    const q = e.target.value;
    showSearchSpinner(".search-wrap", true);
    clearTimeout(catalogSearchTimer);
    catalogSearchTimer = setTimeout(async () => {
      state.filter.catalogQ = q;
      try {
        await loadCatalog({ reset: true });
        refreshCatalogGrid();
      } catch (err) {
        console.error(err);
      } finally {
        showSearchSpinner(".search-wrap", false);
      }
    }, 300);
  });

  const reloadGrid = async () => { await loadCatalog({ reset: true }); refreshCatalogGrid(); };

  $("#catalogLayoutToggle")?.addEventListener("click", () => {
    state.compactView = !state.compactView;
    localStorage.setItem("bv_compact_view", state.compactView);
    haptic("light");
    const toggleBtn = $("#catalogLayoutToggle");
    if (toggleBtn) toggleBtn.innerHTML = state.compactView ? I.grid() : I.list();
    refreshCatalogGrid();
  });

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

const showSearchSpinner = (containerSel, active) => {
  const wrap = document.querySelector(containerSel);
  if (!wrap) return;
  const icon = wrap.querySelector(".s-icon");
  if (!icon) return;
  if (active) {
    icon.innerHTML = `<span class="spin" style="display:inline-flex;animation:spin 0.8s linear infinite;">${I.refresh({w: 14, h: 14})}</span>`;
  } else {
    icon.innerHTML = I.search();
  }
};

function catalogRangesActive() {
  return Object.values(state.filter.catalogRanges).filter(v => v !== "" && v != null).length;
}

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
    <div style="font-family:var(--serif);font-size:22px;font-weight:500;margin:0 4px 16px;">Advanced Filters</div>
    <div class="scrollable" style="max-height: 55vh; overflow-y: auto; padding: 2px;">
      ${rangeField("Release Year", "min_year", "max_year", "Min year", "Max year")}
      ${rangeField("Piece Count", "min_pieces", "max_pieces", "Min pieces", "Max pieces")}
      ${rangeField("Current Value ($)", "min_value", "max_value", "Min value", "Max value")}
    </div>
    <div class="btn-row" style="margin-top:20px;">
      <button class="btn-secondary" id="filterClear">Clear all</button>
      <button class="btn-primary" id="filterApply">Apply filters</button>
    </div>`);

  $("#filterClear").addEventListener("click", () => {
    Object.keys(r).forEach(k => r[k] = "");
    hideSheet();
    onApply();
  });

  $("#filterApply").addEventListener("click", () => {
    Object.keys(r).forEach(k => {
      const el = document.getElementById("f_" + k);
      if (el) r[k] = el.value !== "" ? parseInt(el.value, 10) : "";
    });
    hideSheet();
    onApply();
  });
}

function sourceCueHTML(s) {
  const freshness = s.freshness || (s.cached_at && (Date.now() - new Date(s.cached_at).getTime() > 60 * 24 * 3600 * 1000) ? 'stale' : 'fresh');
  const confidence = s.confidence || (s.valuation_method === 'formula_bulk' ? 'estimated' : 'medium');
  if (freshness === 'fresh' && (confidence === 'high' || confidence === 'medium')) return '';
  const label = freshness === 'expired' ? 'Refresh due'
    : freshness === 'stale' ? 'Stale'
    : confidence === 'estimated' ? 'Estimate'
    : 'Low confidence';
  const color = freshness === 'expired' ? 'var(--bv-red)' : 'var(--bv-yellow)';
  return `<span class="source-cue" title="${escapeHtml(s.valuation_explanation || label)}" style="display:inline-flex;align-items:center;gap:4px;font-family:var(--mono);font-size:9px;color:${color};font-weight:700;text-transform:uppercase;">${escapeHtml(label)}</span>`;
}

function catalogCardHTML(s) {
  const hasImg = s.image_url && !s.image_url.startsWith("data:");
  const h = setHue(s);
  
  if (state.compactView) {
    return `
      <button class="set-list-card compact" data-set="${escapeHtml(s.set_num)}">
        <div class="sl-img${hasImg ? " has-photo" : ""}" style="width:42px;height:42px;">
          <div class="brick-tile" style="--h:${h};width:100%;height:100%;border-radius:var(--r-1);"></div>
          ${hasImg ? `<img class="set-photo" src="${escapeHtml(s.image_url)}" alt="" loading="lazy">` : ""}
        </div>
        <div class="sl-body" style="flex: 1; min-width: 0;">
          <div class="sl-name" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left;">
            ${(s.retirement_risk_score || 0) >= 70 && !s.retired ? '🔥 ' : ''}${escapeHtml(s.name)}
          </div>
          <div class="sl-meta" style="text-align: left;">
            <span>${escapeHtml(s.set_num)}</span>
            <span class="dot"></span>
            <span>${escapeHtml(s.theme || "")}</span>
            ${s.owned ? `<span style="color:var(--up);font-weight:700;margin-left:4px;">OWNED</span>` : ""}
            ${sourceCueHTML(s)}
          </div>
        </div>
        <div class="sl-right-compact">
          <div class="sl-value" style="display:flex;align-items:center;">
            ${fmtMoney(s.current_value)}
            ${s.trend ? trendBadgeHTML(s.trend) : ""}
          </div>
          <div class="sl-delta" style="color:var(--ink-mute);">${s.pieces || 0}pc</div>
        </div>
      </button>`;
  }

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
          <span style="display:inline-flex;align-items:center;gap:6px;">${sourceCueHTML(s)}${s.trend ? trendBadgeHTML(s.trend) : ""}</span>
        </div>
      </div>
    </button>`;
}

export function renderPile() {
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
