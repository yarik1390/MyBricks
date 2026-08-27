import { $, $$, haptic, escapeHtml, fmtMoney, toast, debounce, bvIDB, SEARCH_DEBOUNCE_MS, mount, drawSparkline, fmtDateUpdated, thumbImg } from '../utils.js';
import { t, tPlural } from '../lib/i18n.js';
import { state } from '../state.js';
import { api, getSessionUserId } from '../api.js';
import { I } from '../icons.js';
import { showSheet, hideSheet } from '../components/sheet.js';
import { skelPage, skelCardList } from '../components/skeleton.js';

import { activeFigFilterCount } from '../lib/pure.js';
import { figFilterSummaryText } from '../lib/filter-summary.js';
import { figAvatarSVG } from '../lib/fig-avatar.js';
import { wireHorizontalRail } from '../lib/horizontal-rail.js';

const rarityLabel = (rarity) => {
  const value = String(rarity || 'common').toLowerCase();
  const suffix = value[0].toUpperCase() + value.slice(1);
  return t(`minifigs.filterSummaryRarity${suffix}`);
};

let _blindGen = 0;
let _seriesList = [];

// Bi-directional minifig sort options. Each click toggles direction; switching
// to a new sort uses its default. The backend accepts all keys below.
const FIG_SORTS = [
  { base: "rarity",   asc: "rarity_asc",   desc: "rarity_desc", def: "rarity_desc", label: "Rarity" },
  { base: "scarcity", asc: "scarcity_asc", desc: "scarcity",    def: "scarcity",    label: "Rarest" },
  { base: "year",     asc: "year_asc",     desc: "year_desc",   def: "year_desc",   label: "Newest" },
  { base: "value",    asc: "value_asc",    desc: "value_desc",  def: "value_desc",  label: "Value" },
  { base: "name",     asc: "name_asc",     desc: "name_desc",   def: "name_asc",    label: "A-Z" },
];
const figSortChipText = (o, cur) => {
  const active = cur === o.asc || cur === o.desc;
  return o.label + (active ? (cur === o.asc ? " ↑" : " ↓") : "");
};

// Distinct series with counts, for the series filter dropdown. Fetched once and
// cached for the session (the catalog is static between deploys).
async function loadSeriesList() {
  if (_seriesList.length) return _seriesList;
  try {
    const res = await api('/api/minifigs/series');
    _seriesList = res.series || [];
  } catch { /* leave empty — the dropdown still offers "All series" */ }
  return _seriesList;
}

// Top series shown as quick chips; the rest live behind a "More…" picker
// (40+ series — too many for a flat row). Mirrors the catalog theme chips.
function seriesChipsHTML(f) {
  const top = _seriesList.slice(0, quickSeriesCount());
  const sel = f.figSeries && f.figSeries !== 'all' ? f.figSeries : null;
  const inTop = top.some(s => s.series === sel);
  return `<button class="chip ${!sel ? 'active' : ''}" data-fig-series="all">All series</button>` +
    (sel && !inTop ? `<button class="chip active" data-fig-series="${escapeHtml(sel)}">${escapeHtml(sel)}</button>` : '') +
    top.map(s => `<button class="chip ${sel === s.series ? 'active' : ''}" data-fig-series="${escapeHtml(s.series)}">${escapeHtml(s.series)}</button>`).join('') +
    (_seriesList.length > 6 ? `<button class="chip" id="moreSeriesChip">${I.filter()}<span>More…</span></button>` : '');
}

function quickSeriesCount() {
  try { return window.matchMedia?.("(max-width: 480px)")?.matches ? 3 : 6; }
  catch { return 6; }
}

function applySeriesFilter(value) {
  state.filter.figSeries = value; haptic('light');
  loadBlind({ reset: true }).then(() => { if (location.hash === '#/minifigs' && $('#miniGrid')) { refreshMiniGrid(); refreshMiniStats(); } }).catch(() => {});
}

function refreshSeriesChips() {
  const row = document.getElementById('figSeriesChips');
  if (!row) return;
  row.innerHTML = seriesChipsHTML(state.filter);
  wireSeriesChips();
}

function wireSeriesChips() {
  $$('[data-fig-series]').forEach(btn => btn.addEventListener('click', () => {
    applySeriesFilter(btn.dataset.figSeries);
    refreshSeriesChips();
  }));
  $('#moreSeriesChip')?.addEventListener('click', () => {
    showSheet(`
      <h2 class="u-serif-h" style="margin:0 4px 12px;">Pick a series</h2>
      <div class="search-wrap" style="margin:0 4px 14px;">
        <span class="s-icon">${I.search()}</span>
        <input class="search-input" id="seriesPickerInput" placeholder="Search series…" autocomplete="off">
      </div>
      <div id="seriesPickerResults" class="scrollable u-col u-gap-1" style="max-height:320px;overflow-y:auto;margin:4px;"></div>
    `);
    const results = $('#seriesPickerResults');
    const inp = $('#seriesPickerInput');
    const paint = (q = '') => {
      const query = q.toLowerCase().trim();
      const matches = _seriesList.filter(s => !query || s.series.toLowerCase().includes(query));
      results.innerHTML = matches.length
        ? matches.map(s => `<button class="chip u-wfull ${state.filter.figSeries === s.series ? 'active' : ''}" data-pick-series="${escapeHtml(s.series)}" style="justify-content:flex-start;">${escapeHtml(s.series)} (${s.n})</button>`).join('')
        : `<div class="u-mute u-fs-base" style="text-align:center;padding:20px;">No series match</div>`;
      results.querySelectorAll('[data-pick-series]').forEach(b => b.addEventListener('click', () => {
        applySeriesFilter(b.dataset.pickSeries);
        hideSheet();
        refreshSeriesChips();
      }));
    };
    paint();
    inp?.addEventListener('input', e => paint(e.target.value));
  });
}

export async function renderBlind() {
  if (!state.blind.items.length) {
    $("#root").innerHTML = skelPage(skelCardList(6));
    await loadBlind({ reset: true });
    if (isFigFilterDefault()) bvIDB.set('blind', { data: { items: state.blind.items, total: state.blind.total, hasMore: state.blind.hasMore, offset: state.blind.offset }, ts: Date.now(), userId: getSessionUserId() }).catch(() => {});
  } else if (state.blind._stale) {
    state.blind._stale = false;
    loadBlind({ reset: true }).then(() => {
      if (location.hash === '#/minifigs' && $('#miniGrid')) {
        refreshMiniGrid();
        refreshMiniStats();
        if (isFigFilterDefault()) bvIDB.set('blind', { data: { items: state.blind.items, total: state.blind.total, hasMore: state.blind.hasMore, offset: state.blind.offset }, ts: Date.now(), userId: getSessionUserId() }).catch(() => {});
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
          <div class="topbar-eyebrow" id="blindCount">${tPlural('counts.collected', ownedCount, { owned: ownedCount, total: b.total.toLocaleString() })}</div>
          <h1 class="topbar-title">Minifigs</h1>
        </div>
      </div>

      <div class="fig-stats-row">
        <div class="fig-stat-pill">
          <div class="fig-stat-num" id="figStatCount">${tPlural('counts.owned', ownedCount)}</div>
          <div class="fig-stat-lbl">${tPlural('counts.ofFigs', b.total, { total: b.total.toLocaleString() })}</div>
        </div>
        <div class="fig-stat-pill">
          <div class="fig-stat-num" id="figStatValue">${fmtMoney(ownedValue, { cents: 0 })}</div>
          <div class="fig-stat-lbl">collection value</div>
        </div>
      </div>

      <div id="rareFindsSection"></div>

      <div class="fig-filter-bar">
        <div class="search-wrap open" style="margin-bottom:10px;">
          <span class="s-icon">${I.search()}</span>
          <input class="search-input" id="figSearch" name="minifig_search" type="search" aria-label="Search minifigures" placeholder="Search minifigs…" autocomplete="off" value="${escapeHtml(f.figQ)}">
        </div>
        <div class="filter-row horizontal-rail" aria-label="Minifigure rarity filters">
          <button class="chip ${f.figRarity === 'all' ? 'active' : ''}" data-fig-rarity="all">All</button>
          ${rarities.map(r => `<button class="chip ${f.figRarity === r ? 'active' : ''} rarity-chip-${r}" data-fig-rarity="${r}">${r.charAt(0).toUpperCase() + r.slice(1)}</button>`).join('')}
          <button class="chip fig-owned-chip ${f.figOwned !== 'all' ? 'active' : ''}" id="figOwnedChip">${ownedChipLabel}</button>
        </div>
        <div class="filter-row horizontal-rail" id="figSeriesChips" aria-label="Minifigure series filters" style="margin-top:-2px;margin-bottom:4px;">
          ${seriesChipsHTML(f)}
        </div>
        <div class="filter-row horizontal-rail" aria-label="Minifigure sort controls" style="margin-top:2px;gap:6px;">
          <span class="filter-row-label">Sort</span>
          ${FIG_SORTS.map(o => `<button class="chip ${(f.figSort === o.asc || f.figSort === o.desc) ? 'active' : ''}" data-fig-sort-base="${o.base}">${figSortChipText(o, f.figSort)}</button>`).join('')}
          <button class="chip ${activeFigFilterCount(f) ? 'active' : ''}" id="figFilterChip">${I.filter()}<span>${escapeHtml(activeFigFilterCount(f) ? tPlural('catalog.filtersWithCount', activeFigFilterCount(f)) : t('catalog.filters'))}</span></button>
        </div>
        <div class="filter-summary" id="figFilterSummary">${escapeHtml(figFilterSummaryText(f, t, tPlural))}</div>
      </div>

      <div class="mini-grid" id="miniGrid">
        ${miniGridHTML()}
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
    loadBlind({ reset: true }).then(() => { if (location.hash === '#/minifigs' && $('#miniGrid')) { refreshMiniGrid(); refreshMiniStats(); } }).catch(() => {});
  }));

  const ownedCycle = { all: 'owned', owned: 'unowned', unowned: 'all' };
  $("#figOwnedChip")?.addEventListener("click", () => {
    state.filter.figOwned = ownedCycle[state.filter.figOwned] || 'all'; haptic("light");
    const labels = { all: 'All', owned: 'Owned', unowned: 'Unowned' };
    const chip = $("#figOwnedChip");
    if (chip) { chip.textContent = labels[state.filter.figOwned]; chip.classList.toggle("active", state.filter.figOwned !== 'all'); }
    loadBlind({ reset: true }).then(() => { if (location.hash === '#/minifigs' && $('#miniGrid')) { refreshMiniGrid(); refreshMiniStats(); } }).catch(() => {});
  });

  $$("[data-fig-sort-base]").forEach(btn => btn.addEventListener("click", () => {
    const o = FIG_SORTS.find(s => s.base === btn.dataset.figSortBase);
    if (!o) return;
    const cur = state.filter.figSort;
    // Same sort active → flip direction; new sort → its default direction.
    state.filter.figSort = cur === o.desc ? o.asc : cur === o.asc ? o.desc : o.def;
    haptic("light");
    $$("[data-fig-sort-base]").forEach(x => {
      const xo = FIG_SORTS.find(s => s.base === x.dataset.figSortBase);
      if (!xo) return;
      x.classList.toggle("active", state.filter.figSort === xo.asc || state.filter.figSort === xo.desc);
      x.textContent = figSortChipText(xo, state.filter.figSort);
    });
    loadBlind({ reset: true }).then(() => { if (location.hash === '#/minifigs' && $('#miniGrid')) { refreshMiniGrid(); refreshMiniStats(); } }).catch(() => {});
  }));

  $("#figFilterChip")?.addEventListener("click", () => showFigFilterSheet());

  // Series filter: top series as quick chips, the rest behind a "More…" picker.
  // The facet list loads async; re-render the chip row once it arrives.
  wireSeriesChips();
  loadSeriesList().then(() => { if (location.hash === '#/minifigs') refreshSeriesChips(); });


  wireMiniCards();
  mountBlindSentinel();
  document.querySelectorAll('.fig-filter-bar .horizontal-rail').forEach(wireHorizontalRail);
  loadRareFinds();
}

// "Rare finds in your vault" — surfaces the signed-in user's owned
// rare/legendary figs as a tappable highlight row above the catalog. Empty for
// guests / collections with none, so it self-hides. Loaded lazily (non-blocking).
async function loadRareFinds() {
  let figs = [];
  try { const r = await api('/api/minifigs/rare-finds'); figs = (r && r.figs) || []; } catch { return; }
  const el = $('#rareFindsSection');
  if (!el || !figs.length) return;
  el.innerHTML = `
    <h2 class="section-title" style="margin-top:0;">Rare finds in your vault</h2>
    <div class="rare-finds-rail horizontal-rail" aria-label="Rare minifigures in your vault">
      ${figs.map((f) => {
        const r = f.rarity || 'rare';
        const spokenLabel = `${String(f.name || 'Minifigure')}, ${rarityLabel(r)}${f.current_value ? `, ${fmtMoney(f.current_value, { cents: 0 })}` : ''}`;
        return `<button class="rare-find-card" data-fig="${escapeHtml(String(f.fig_num))}" aria-label="${escapeHtml(spokenLabel)}">
          <div class="rare-find-image">
            ${f.image_url ? `<img src="${escapeHtml(thumbImg(String(f.image_url)))}" alt="" loading="lazy" decoding="async" style="max-width:100%;max-height:72px;object-fit:contain;">` : figAvatarSVG(String(f.fig_num), String(f.name || ''))}
          </div>
          <div class="rare-find-name">${escapeHtml(String(f.name || ''))}</div>
          <div class="rare-find-meta">
            <span class="mini-rarity-tag rarity-${r}">${escapeHtml(rarityLabel(r))}</span>
            ${f.current_value ? `<span class="rare-find-value">${fmtMoney(f.current_value, { cents: 0 })}</span>` : ''}
          </div>
        </button>`;
      }).join('')}
    </div>`;
  wireHorizontalRail(el.querySelector('.rare-finds-rail'));
  el.querySelectorAll('.rare-find-card').forEach((btn) => btn.addEventListener('click', () => {
    const fig = figs.find((x) => String(x.fig_num) === btn.dataset.fig);
    if (fig) { haptic('light'); showFigDetail(fig); }
  }));
}

export async function loadBlind({ reset = false } = {}) {
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
    fresh.forEach(f => { if (f.owned_qty > 0) state.ownedFigs.add(f.fig_num); });
    saveFigs();
    b.items = reset ? fresh : b.items.concat(fresh);
    b.total = res.total ?? b.items.length;
    b.offset = b.items.length;
    b.hasMore = !!res.hasMore;
    return fresh;
  } catch (_e) {
    if (myGen === _blindGen) toast("Couldn't load minifigs", "error");
    return [];
  } finally {
    if (myGen === _blindGen) b.loading = false;
  }
}

function blindQuery() {
  const f = state.filter;
  const b = state.blind;
  const p = new URLSearchParams({ limit: b.pageSize, offset: b.offset });
  if (f.figQ)                       p.set('q', f.figQ);
  if (f.figRarity !== 'all')        p.set('rarity', f.figRarity);
  if (f.figSeries && f.figSeries !== 'all') p.set('series', f.figSeries);
  if (f.figOwned === 'owned')       p.set('owned', 'yes');
  if (f.figOwned === 'unowned')     p.set('owned', 'no');
  if (f.figSort)                    p.set('sort', f.figSort);
  return p.toString();
}

function saveFigs() {
  try { localStorage.setItem("bv_figs", JSON.stringify([...state.ownedFigs])); } catch {}
}

function refreshMiniGrid() {
  const grid = $('#miniGrid');
  if (!grid) return;
  mount(grid, miniGridHTML());
  refreshFigFilterSummary();
  wireMiniCards();
  mountBlindSentinel();
}

function refreshFigFilterSummary() {
  const el = $('#figFilterSummary');
  if (el) el.textContent = figFilterSummaryText(state.filter, t, tPlural);
  const chip = $('#figFilterChip');
  if (chip) {
    const n = activeFigFilterCount(state.filter);
    chip.classList.toggle('active', n > 0);
    const span = chip.querySelector('span');
    if (span) span.textContent = n ? tPlural('catalog.filtersWithCount', n) : t('catalog.filters');
  }
}

async function reloadMiniView() {
  await loadBlind({ reset: true });
  if (location.hash === '#/minifigs' && $('#miniGrid')) {
    refreshSeriesChips();
    refreshMiniGrid();
    refreshMiniStats();
  }
}

function miniGridHTML() {
  if (state.blind.items.length) return state.blind.items.map(f => miniCardHTML(f)).join('');
  const hasFilters = !isFigFilterDefault() || !!state.filter.figQ;
  return `
    <div class="empty card" style="grid-column:1/-1;">
      <div class="empty-icon">${I.figure()}</div>
      <h3>No minifigs found</h3>
      <p>${escapeHtml(state.filter.figQ
        ? t('minifigs.emptySearchResults', { query: state.filter.figQ })
        : t('minifigs.emptyFilteredResults'))}</p>
      ${hasFilters ? `<button class="btn-secondary" id="figClearFilters" style="margin-top:12px;">Clear filters</button>` : ""}
    </div>`;
}

function clearFigFilters() {
  state.filter.figQ = "";
  state.filter.figRarity = "all";
  state.filter.figOwned = "all";
  state.filter.figSeries = "all";
  state.filter.figSort = "rarity_desc";
  haptic("light");
  loadBlind({ reset: true }).then(() => {
    if (location.hash === '#/minifigs' && $('#miniGrid')) {
      const q = $("#figSearch");
      if (q) q.value = "";
      $$("[data-fig-rarity]").forEach(x => x.classList.toggle("active", x.dataset.figRarity === "all"));
      const owned = $("#figOwnedChip");
      if (owned) {
        owned.textContent = "All";
        owned.classList.remove("active");
      }
      $$("[data-fig-sort-base]").forEach(btn => {
        const opt = FIG_SORTS.find(s => s.base === btn.dataset.figSortBase);
        if (!opt) return;
        btn.classList.toggle("active", state.filter.figSort === opt.asc || state.filter.figSort === opt.desc);
        btn.textContent = figSortChipText(opt, state.filter.figSort);
      });
      refreshSeriesChips();
      refreshMiniGrid();
      refreshMiniStats();
    }
  }).catch(() => {});
}

function showFigFilterSheet() {
  const f = state.filter;
  const activeCount = activeFigFilterCount(f);
  const rarityOptions = ['all', 'common', 'uncommon', 'rare', 'legendary'];
  const ownedOptions = [['all', 'All'], ['owned', 'Owned'], ['unowned', 'Unowned']];
  const sortOptions = FIG_SORTS.map(o => [o.def, o.label]);
  const chipGroup = (label, id, values, current) => `
    <section class="filter-sheet-section">
      <div class="field-lbl">${escapeHtml(label)}</div>
      <div class="sheet-chip-grid sheet-facet" data-fig-facet="${escapeHtml(id)}">
        ${values.map(v => {
          const value = Array.isArray(v) ? v[0] : v;
          const labelText = Array.isArray(v) ? v[1] : (value === 'all' ? 'All' : value.charAt(0).toUpperCase() + value.slice(1));
          return `<button class="chip ${current === value ? 'active' : ''}" data-fval="${escapeHtml(value)}">${escapeHtml(labelText)}</button>`;
        }).join('')}
      </div>
    </section>`;
  const seenSeries = new Set();
  const seriesValues = [['all', 'All series']]
    .concat((f.figSeries && f.figSeries !== 'all' ? [[f.figSeries, f.figSeries]] : []))
    .concat(_seriesList.slice(0, 10).map(s => [s.series, `${s.series} (${s.n})`]))
    .filter(([value]) => {
      if (seenSeries.has(value)) return false;
      seenSeries.add(value);
      return true;
    });
  showSheet(`
    <div class="sheet-title-row">
      <h2 class="u-serif-h" style="margin:0;">Minifig Filters</h2>
      ${activeCount ? `<span class="trust-badge warn">${tPlural('catalog.activeFilters', activeCount)}</span>` : `<span class="trust-badge neutral">None active</span>`}
    </div>
    <div class="filter-active-line">${escapeHtml(figFilterSummaryText(f, t, tPlural))}</div>
    <div class="scrollable advanced-filter-sheet">
      ${chipGroup('Rarity', 'rarity', rarityOptions, f.figRarity || 'all')}
      ${chipGroup('Ownership', 'owned', ownedOptions, f.figOwned || 'all')}
      ${chipGroup('Series', 'series', seriesValues, f.figSeries || 'all')}
      ${chipGroup('Sort', 'sort', sortOptions, f.figSort || 'rarity_desc')}
    </div>
    <div class="btn-row sheet-sticky-actions">
      <button class="btn-secondary" id="figFilterClear">Clear all</button>
      <button class="btn-primary" id="figFilterApply">Apply filters</button>
    </div>`);

  $$("[data-fig-facet]").forEach(group => group.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-fval]");
    if (!btn) return;
    group.querySelectorAll("[data-fval]").forEach(x => x.classList.toggle("active", x === btn));
  }));
  const readFacet = (id) => document.querySelector(`[data-fig-facet="${id}"] .chip.active`)?.dataset.fval || 'all';
  $("#figFilterClear")?.addEventListener("click", () => {
    hideSheet();
    clearFigFilters();
  });
  $("#figFilterApply")?.addEventListener("click", () => {
    state.filter.figRarity = readFacet('rarity');
    state.filter.figOwned = readFacet('owned');
    state.filter.figSeries = readFacet('series');
    state.filter.figSort = readFacet('sort');
    hideSheet();
    haptic("light");
    reloadMiniView().catch(() => {});
  });
}

const debouncedFigSearch = debounce(async () => {
  await loadBlind({ reset: true });
  refreshMiniGrid();
  refreshMiniStats();
}, SEARCH_DEBOUNCE_MS);

function wireMiniCards() {
  const grid = $("#miniGrid");
  if (!grid || grid._delegated) return;
  grid._delegated = true;
  grid.addEventListener("click", (evt) => {
    if (evt.target.closest("#figClearFilters")) { clearFigFilters(); return; }
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
  el.textContent = tPlural('counts.collected', owned, { owned, total: state.blind.total.toLocaleString() });
}

function updateFigStats() {
  const ownedItems = state.blind.items.filter(f => state.ownedFigs.has(f.fig_num));
  const countEl = $("#figStatCount");
  const valueEl = $("#figStatValue");
  if (countEl) countEl.textContent = tPlural('minifigs.ownedCount', ownedItems.length);
  const totalEl = countEl?.nextElementSibling;
  if (totalEl) totalEl.textContent = tPlural('counts.ofFigs', state.blind.total, { total: state.blind.total.toLocaleString() });
  if (valueEl) {
    const total = ownedItems.reduce((s, f) => s + (f.value ?? f.current_value ?? 0), 0);
    valueEl.textContent = fmtMoney(total, { cents: 0 });
  }
}

function refreshMiniStats() {
  updateBlindCount();
  updateFigStats();
}

// Attribution label for a fig's market value. Per the source-naming policy we
// name the API sources (BrickLink, eBay) and fall back to a neutral estimate.
function figSourceLabel(source) {
  if (source === 'bricklink+ebay') return 'via BrickLink + eBay sold comps';
  if (source === 'bricklink') return 'via BrickLink price guide';
  return 'Blended market estimate';
}

function showFigDetail(f) {
  const owned = state.ownedFigs.has(f.fig_num);
  const realVal = f.current_value ?? null;
  const rarity = f.rarity || 'common';
  const n = f.appears_in_sets ?? null;
  const scarcityTxt = (n != null && n > 0)
    ? (n === 1 ? t('minifigs.setExclusive') : tPlural('minifigs.appearsInSets', n))
    : null;
  const hasImg = f.image_url;
  const rbUrl = `https://rebrickable.com/minifigs/${encodeURIComponent(f.fig_num)}/`;

  const renderBtn = (isOwned) => isOwned
    ? `${I.check()}<span>Owned</span>`
    : `<span>Mark as owned</span>`;

  showSheet(`
    <div class="fig-detail">
      <div class="fig-detail-hero${hasImg ? ' has-photo' : ''}">
        ${figAvatarSVG(String(f.fig_num), String(f.name || ''))}
        ${hasImg ? `<img class="fig-photo" src="${escapeHtml(thumbImg(f.image_url))}" alt="${escapeHtml(f.name)}" loading="lazy" decoding="async">` : ''}
        <span class="mini-rarity-tag rarity-${rarity}">${escapeHtml(rarityLabel(rarity))}</span>
      </div>
      <div class="fig-detail-body">
        <div class="fig-detail-series">${escapeHtml(f.series || 'Minifig')}</div>
        <div class="fig-detail-name">${escapeHtml(f.name)}</div>
        ${realVal != null && realVal > 0 ? `
        <div class="fig-detail-value">
          <span class="fig-detail-value-lbl">Est. resale value</span>
          <span class="fig-detail-value-num">${fmtMoney(realVal, { cents: 0 })}</span>
        </div>
        <div class="fig-detail-source">${figSourceLabel(f.source)}${f.cached_at ? ` · ${escapeHtml(fmtDateUpdated(f.cached_at))}` : ''}</div>
        <div class="fig-spark-wrap" id="figSparkWrap" style="display:none;">
          <div class="fig-spark-lbl">${tPlural('detail.priceHistoryShort', 90)}</div>
          <div class="fig-spark" id="figSparkline" style="height:72px;"></div>
        </div>` : ''}
        ${(scarcityTxt || f.year || f.num_parts) ? `
        <div class="fig-detail-facts" style="display:flex;gap:14px;flex-wrap:wrap;margin:4px 0 12px;font-size:12.5px;color:var(--ink-mute);">
          ${scarcityTxt ? `<span>${scarcityTxt}</span>` : ''}
          ${f.year ? `<span>First seen ${f.year}</span>` : ''}
          ${f.num_parts ? `<span>${escapeHtml(tPlural('minifigs.parts', f.num_parts))}</span>` : ''}
          <span>${escapeHtml(t('minifigs.filterSummaryRarity', { rarity: rarityLabel(rarity) }))}</span>
        </div>` : ''}
        <button class="btn-primary fig-own-btn${owned ? ' is-owned' : ''}" id="figOwnBtn">
          ${renderBtn(owned)}
        </button>
        <a class="fig-detail-link" href="${rbUrl}" target="_blank" rel="noopener noreferrer">
          ${I.extLink()}<span>View on Rebrickable</span>
        </a>
        <div id="figSetsSection" style="margin-top:16px;"></div>
      </div>
    </div>`);

  // Lazily load the 90-day price history and draw the trend sparkline (mirrors
  // the set detail chart). Only shown once we have ≥2 snapshots.
  if (realVal != null && realVal > 0) {
    (async () => {
      try {
        const r = await api('/api/minifigs/' + encodeURIComponent(f.fig_num) + '/history?days=90');
        const hist = (r && r.history) || [];
        if (hist.length < 2) return;
        const wrap = $('#figSparkWrap');
        const el = $('#figSparkline');
        if (!wrap || !el) return;
        const first = Number(hist[0].current_value) || 0;
        const last = Number(hist[hist.length - 1].current_value) || 0;
        wrap.style.display = '';
        drawSparkline(el, hist, {
          up: last >= first,
          series: [{ key: 'ebay_value', color: 'var(--ink-mute)', dash: '4 3' }],
        });
      } catch { /* non-fatal — the chart just stays hidden */ }
    })();
  }

  // Lazily load the sets this minifig appears in — a navigable hub from the fig
  // to each set's detail. (Hidden if the fig isn't mapped to any catalog sets.)
  (async () => {
    try {
      const r = await api('/api/minifigs/' + encodeURIComponent(f.fig_num) + '/sets');
      const sets = (r && r.sets) || [];
      const el = $('#figSetsSection');
      if (!el || !sets.length) return;
      el.innerHTML = `
        <div class="fig-detail-series" style="margin-bottom:8px;">${escapeHtml(tPlural('minifigs.appearsInSets', sets.length))}</div>
        <div class="u-col" style="gap:8px;">
          ${sets.map((s) => `
            <button class="fig-set-row" data-set="${escapeHtml(String(s.set_num))}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:var(--surface-2);border:1px solid var(--line-soft);border-radius:var(--r-2);padding:8px 10px;cursor:pointer;">
              ${s.image_url ? `<img src="${escapeHtml(thumbImg(String(s.image_url)))}" alt="" loading="lazy" decoding="async" style="width:40px;height:40px;object-fit:contain;background:var(--surface-3);border-radius:6px;flex:0 0 auto;">` : figAvatarSVG(String(s.fig_num || s.set_num), String(s.name || ''))}
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:600;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(String(s.name || s.set_num))}</div>
                <div style="font-size:11px;color:var(--ink-mute);font-family:var(--mono);">#${escapeHtml(String(s.set_num).replace(/-\d+$/, ''))}${s.year ? ` · ${s.year}` : ''}</div>
              </div>
              ${s.value ? `<span style="font-size:13px;font-weight:700;color:var(--ink);flex:0 0 auto;">${fmtMoney(s.value, { cents: 0 })}</span>` : ''}
            </button>`).join('')}
        </div>`;
      el.querySelectorAll('.fig-set-row').forEach((b) => b.addEventListener('click', () => {
        haptic('light');
        location.hash = '#/set/' + encodeURIComponent(b.dataset.set);
      }));
    } catch { /* non-fatal — the section just stays empty */ }
  })();

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
      const sheetBtn = $('#figOwnBtn');
      if (sheetBtn) {
        sheetBtn.innerHTML = renderBtn(!nowOwned);
        sheetBtn.classList.toggle('is-owned', !nowOwned);
      }
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

function isFigFilterDefault() {
  const f = state.filter;
  return !f.figQ && f.figRarity === 'all' && f.figOwned === 'all' && (!f.figSeries || f.figSeries === 'all');
}

function miniCardHTML(f) {
  const owned = state.ownedFigs.has(f.fig_num);
  const hasImg = f.image_url;
  const realVal = f.current_value ?? null;
  const rarity = f.rarity || "common";
  const n = f.appears_in_sets ?? null;
  // Honest footer: a real market price when we have one, otherwise a true fact
  // (set-exclusivity / debut year) — never a fabricated rarity-constant price.
  const scarcityLabel = (n != null && n > 0)
    ? (n === 1 ? t('minifigs.setExclusive') : tPlural('minifigs.inSets', n))
    : (f.year ? String(f.year) : '');
  const valHTML = realVal != null && realVal > 0
    ? `<div class="mini-value">${fmtMoney(realVal, { cents: 0 })}</div>`
    : (scarcityLabel ? `<div class="mini-value mini-value-est">${scarcityLabel}</div>` : '');
  return `
    <button class="mini-card rarity-${rarity}" data-fig="${escapeHtml(f.fig_num)}" aria-label="${escapeHtml(f.name)}">
      <div class="mini-img${hasImg ? " has-photo" : ""}">
        ${figAvatarSVG(String(f.fig_num), String(f.name || ''))}
        ${hasImg ? `<img class="fig-photo" src="${escapeHtml(thumbImg(f.image_url))}" alt="" loading="lazy" decoding="async">` : ""}
        <span class="mini-rarity-tag rarity-${rarity}">${escapeHtml(rarityLabel(rarity))}</span>
      </div>
      <div class="mini-body">
        <div class="mini-name">${escapeHtml(f.name)}</div>
        <div class="mini-meta">
          <span>${escapeHtml(f.series || "Minifig")}</span>
        </div>
        <div class="mini-card-footer">
          ${valHTML}
          ${owned ? `<span class="mini-owned-badge">${I.check()}</span>` : ''}
        </div>
      </div>
    </button>`;
}
