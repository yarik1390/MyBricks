import { $, $$, haptic, escapeHtml, fmtMoney, toast, debounce, bvIDB, SEARCH_DEBOUNCE_MS, mount, drawSparkline, fmtDateUpdated, thumbImg, capturedMoneyContext, CURRENCY_SYMBOLS, setBtnLoading } from '../utils.js';
import { t, tPlural } from '../lib/i18n.js';
import { state } from '../state.js';
import { api, getSessionUserId, getSessionOwnerSnapshot } from '../api.js';
import { I } from '../icons.js';
import { showSheet, hideSheet } from '../components/sheet.js';
import { skelPage, skelCardList } from '../components/skeleton.js';

import { activeFigFilterCount } from '../lib/pure.js';
import { figFilterSummaryText } from '../lib/filter-summary.js';
import { figAvatarSVG } from '../lib/fig-avatar.js';
import { wireHorizontalRail } from '../lib/horizontal-rail.js';
import { confirmedMinifigHoldingResponse, parseMinifigHoldingForm, normalizeMinifigHolding } from '../lib/minifig-holding.js';
import { usdMoneyInputValue } from '../lib/money-input.js';
import { exportBlob } from '../lib/native-file-export.js';

const rarityLabel = (rarity) => {
  const value = String(rarity || 'common').toLowerCase();
  const suffix = value[0].toUpperCase() + value.slice(1);
  return t(`minifigs.filterSummaryRarity${suffix}`);
};

let _blindGen = 0;
let _figDetailGen = 0;
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
  const ownedCount = b.ownedCount || 0;
  const ownedValue = b.ownedValue || 0;
  const activeFilterCount = activeFigFilterCount(f);

  $("#root").innerHTML = `
    <div class="page">
      <div class="topbar">
        <div class="topbar-heading">
          <div class="topbar-eyebrow" id="blindCount">${tPlural('counts.collected', ownedCount, { owned: ownedCount, total: b.total.toLocaleString() })}</div>
          <h1 class="topbar-title">Minifigs</h1>
        </div>
        <button class="btn-secondary" id="figExportBtn">${I.download ? I.download() : ''}<span>${escapeHtml(t('minifigs.exportCsv'))}</span></button>
      </div>

      <section class="fig-collection-overview" aria-label="Minifigure collection summary">
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
      </section>

      <div id="rareFindsSection"></div>

      <div class="fig-filter-bar fig-catalog-toolbar">
        <div class="fig-catalog-actions">
          <div class="search-wrap open">
            <span class="s-icon">${I.search()}</span>
            <input class="search-input" id="figSearch" name="minifig_search" type="search" aria-label="Search minifigures" aria-describedby="figResultsMeta" placeholder="Search minifigs…" autocomplete="off" value="${escapeHtml(f.figQ)}">
          </div>
          <button class="btn-secondary fig-filter-trigger ${activeFilterCount ? 'active' : ''}" id="figFilterChip" aria-haspopup="dialog" aria-controls="sheet" aria-expanded="false">
            ${I.filter()}<span>${escapeHtml(activeFilterCount ? tPlural('catalog.filtersWithCount', activeFilterCount) : t('catalog.filters'))}</span>
          </button>
        </div>
        <div class="fig-sort-toolbar">
          <span class="fig-sort-label">Sort</span>
          <div class="filter-row horizontal-rail fig-sort-row" aria-label="Sort minifigures">
            ${FIG_SORTS.map(o => `<button class="chip ${(f.figSort === o.asc || f.figSort === o.desc) ? 'active' : ''}" data-fig-sort-base="${o.base}">${figSortChipText(o, f.figSort)}</button>`).join('')}
          </div>
        </div>
        <div class="filter-summary" id="figFilterSummary">${escapeHtml(figFilterSummaryText(f, t, tPlural))}</div>
      </div>

      <div class="catalog-meta" id="figResultsMeta" role="status" aria-live="polite">${tPlural('counts.results', b.total)}</div>
      <div class="mini-grid" id="miniGrid">
        ${miniGridHTML()}
      </div>
      <div id="blindSentinel" class="load-sentinel" style="${b.hasMore ? "" : "display:none;"}">
        <div class="spinner"></div>
      </div>
    </div>`;

  const figSearchInput = $("#figSearch");
  figSearchInput?.addEventListener("input", (e) => { state.filter.figQ = e.target.value; debouncedFigSearch(); });

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
  $("#figExportBtn")?.addEventListener("click", exportMinifigHoldings);

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
    if (getSessionUserId() && res.aggregates) {
      b.ownedCount = Number(res.aggregates.owned_count) || 0;
      b.ownedValue = Number(res.aggregates.owned_value) || 0;
    } else {
      // Guest mode's complete local collection is authoritative, not this result page.
      const details = (() => { try { return JSON.parse(localStorage.getItem('bv_guest_fig_details') || '{}'); } catch { return {}; } })();
      b.ownedCount = [...state.ownedFigs].reduce((sum, num) => sum + (normalizeMinifigHolding(details[num]?.holding)?.quantity || 1), 0);
      b.ownedValue = [...state.ownedFigs].reduce((sum, num) => sum + (Number(details[num]?.current_value ?? details[num]?.value) || 0) * (normalizeMinifigHolding(details[num]?.holding)?.quantity || 1), 0);
    }
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
  state.filter.figSort = "year_desc";
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
  const trigger = $("#figFilterChip");
  trigger?.setAttribute("aria-expanded", "true");
  const f = state.filter;
  const activeCount = activeFigFilterCount(f);
  const rarityOptions = ['all', 'common', 'uncommon', 'rare', 'legendary'];
  const ownedOptions = [['all', 'All'], ['owned', 'Owned'], ['unowned', 'Unowned']];
  const sortOptions = FIG_SORTS.flatMap(o => [[o.asc, `${o.label} ↑`], [o.desc, `${o.label} ↓`]]);
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
      ${chipGroup('Sort', 'sort', sortOptions, f.figSort || 'year_desc')}
    </div>
    <div class="btn-row sheet-sticky-actions">
      <button class="btn-secondary" id="figFilterClear">Clear all</button>
      <button class="btn-primary" id="figFilterApply">Apply filters</button>
    </div>`);
  $("#sheet")?.addEventListener("sheet:closing", () => {
    trigger?.setAttribute("aria-expanded", "false");
  }, { once: true });

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
  const owned = state.blind.ownedCount || 0;
  el.textContent = tPlural('counts.collected', owned, { owned, total: state.blind.total.toLocaleString() });
}

function updateFigStats() {
  const { ownedCount = 0, ownedValue = 0 } = state.blind;
  const countEl = $("#figStatCount");
  const valueEl = $("#figStatValue");
  if (countEl) countEl.textContent = tPlural('minifigs.ownedCount', ownedCount);
  const totalEl = countEl?.nextElementSibling;
  if (totalEl) totalEl.textContent = tPlural('counts.ofFigs', state.blind.total, { total: state.blind.total.toLocaleString() });
  if (valueEl) {
    valueEl.textContent = fmtMoney(ownedValue, { cents: 0 });
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

async function exportMinifigHoldings() {
  const btn = $('#figExportBtn');
  if (btn?.disabled) return;
  const ownerSnapshot = getSessionOwnerSnapshot();
  setBtnLoading(btn, true);
  try {
    const blob = await api('/api/minifigs/export', { responseType: 'blob' });
    if (ownerSnapshot.generation !== getSessionOwnerSnapshot().generation) throw new Error(t('minifigs.accountChanged'));
    await exportBlob(blob, 'brickvault-minifigures.csv', { title: t('minifigs.exportTitle') });
    toast(t('minifigs.exportReady'), 'success');
  } catch (error) {
    toast(t('minifigs.exportFailed', { error: error?.message || error }), 'error');
  } finally {
    setBtnLoading(btn, false);
  }
}

function holdingFormHTML(holding, moneyContext) {
  const saved = normalizeMinifigHolding(holding);
  const condition = saved?.condition || 'unknown';
  const currency = moneyContext.currency;
  const symbol = CURRENCY_SYMBOLS[currency] || currency;
  return `
    <section class="detail-card" aria-labelledby="figHoldingTitle" style="margin-top:14px;">
      <div class="detail-card-title" id="figHoldingTitle">${escapeHtml(saved ? t('minifigs.editHolding') : t('minifigs.addHolding'))}</div>
      <p style="font-size:12.5px;color:var(--ink-mute);margin:0 0 12px;">${escapeHtml(t('minifigs.looseOnly'))}</p>
      <div class="manage-field-grid">
        <div class="field">
          <label class="field-lbl" for="figQuantity">${escapeHtml(t('minifigs.quantity'))}</label>
          <input id="figQuantity" type="number" inputmode="numeric" min="1" max="9999" step="1" value="${saved?.quantity || 1}">
        </div>
        <div class="field">
          <label class="field-lbl" for="figCondition">${escapeHtml(t('minifigs.condition'))}</label>
          <select id="figCondition">
            <option value="unknown" ${condition === 'unknown' ? 'selected' : ''}>${escapeHtml(t('minifigs.conditionUnknown'))}</option>
            <option value="new" ${condition === 'new' ? 'selected' : ''}>${escapeHtml(t('minifigs.conditionNew'))}</option>
            <option value="used_good" ${condition === 'used_good' ? 'selected' : ''}>${escapeHtml(t('minifigs.conditionUsedGood'))}</option>
            <option value="used_acceptable" ${condition === 'used_acceptable' ? 'selected' : ''}>${escapeHtml(t('minifigs.conditionUsedAcceptable'))}</option>
          </select>
        </div>
        <div class="field">
          <label class="field-lbl" for="figPurchasePrice">${escapeHtml(t('minifigs.purchasePrice', { currency, symbol }))}</label>
          <input id="figPurchasePrice" type="text" inputmode="decimal" autocomplete="off" value="${escapeHtml(usdMoneyInputValue(saved?.purchase_price, moneyContext))}" placeholder="${escapeHtml(t('minifigs.unknownIfBlank'))}">
        </div>
        <div class="field">
          <label class="field-lbl" for="figPurchasedAt">${escapeHtml(t('minifigs.purchasedAt'))}</label>
          <input id="figPurchasedAt" type="date" value="${escapeHtml(saved?.purchased_at || '')}">
        </div>
        <div class="field" style="grid-column:1/-1;">
          <label class="field-lbl" for="figNotes">${escapeHtml(t('minifigs.notes'))}</label>
          <textarea id="figNotes" maxlength="2000" placeholder="${escapeHtml(t('minifigs.notesPlaceholder'))}">${escapeHtml(saved?.notes || '')}</textarea>
        </div>
      </div>
      <div id="figHoldingError" role="alert" style="min-height:18px;color:var(--down);font-size:12px;margin-top:6px;"></div>
      <button class="btn-primary" id="figSaveHolding">${escapeHtml(saved ? t('common.save') : t('minifigs.addToVault'))}</button>
      ${saved ? `<div id="figRemoveActions" style="margin-top:10px;"><button class="btn-secondary" id="figRemoveHolding">${escapeHtml(t('minifigs.removeHolding'))}</button></div>` : ''}
    </section>`;
}

function updateFigHoldingState(f, previous, next) {
  const oldQuantity = previous?.quantity || 0;
  const newQuantity = next?.quantity || 0;
  if (next) state.ownedFigs.add(f.fig_num); else state.ownedFigs.delete(f.fig_num);
  f.owned_qty = newQuantity;
  saveFigs();
  const card = $(`.mini-card[data-fig="${CSS.escape(f.fig_num)}"]`);
  if (card) card.outerHTML = miniCardHTML(f);
  state.blind.ownedCount = Math.max(0, (state.blind.ownedCount || 0) + newQuantity - oldQuantity);
  state.blind.ownedValue = Math.max(0, (state.blind.ownedValue || 0) + (newQuantity - oldQuantity) * (Number(f.current_value ?? f.value) || 0));
  refreshMiniStats();
  if (state.filter.figOwned !== 'all' && !previous !== !next) {
    loadBlind({ reset: true }).then(() => {
      if (location.hash === '#/minifigs') { refreshMiniGrid(); refreshMiniStats(); }
    }).catch(() => {});
  }
}

function wireHoldingForm(f, initialHolding, detailGen, ownerSnapshot, moneyContext) {
  let holding = normalizeMinifigHolding(initialHolding);
  let priceChanged = false;
  let saving = false;
  const live = () => detailGen === _figDetailGen
    && ownerSnapshot.generation === getSessionOwnerSnapshot().generation
    && $('#figSaveHolding');
  const priceInput = $('#figPurchasePrice');
  const setBusy = (on, loadingButton) => {
    $('#figHoldingContainer')?.querySelectorAll('input, select, textarea, button').forEach(control => { control.disabled = on; });
    setBtnLoading(loadingButton, on);
  };
  priceInput?.addEventListener('input', () => { priceChanged = true; });
  $('#figSaveHolding')?.addEventListener('click', async () => {
    if (saving || !live()) return;
    const result = parseMinifigHoldingForm({
      quantity: $('#figQuantity')?.value,
      condition: $('#figCondition')?.value,
      purchase_price: priceInput?.value,
      purchased_at: $('#figPurchasedAt')?.value,
      notes: $('#figNotes')?.value,
    }, moneyContext, { priceChanged: !holding || priceChanged });
    const error = $('#figHoldingError');
    if (!result.valid) {
      if (error) error.textContent = t(`minifigs.error${result.field[0].toUpperCase()}${result.field.slice(1)}`);
      $(`#fig${result.field === 'purchase_price' ? 'PurchasePrice' : result.field === 'purchased_at' ? 'PurchasedAt' : result.field[0].toUpperCase() + result.field.slice(1)}`)?.focus();
      return;
    }
    if (error) error.textContent = '';
    saving = true;
    const button = $('#figSaveHolding');
    setBusy(true, button);
    try {
      const response = await api(`/api/minifigs/${encodeURIComponent(f.fig_num)}`, { method: 'PUT', body: result.payload, retry: false, offlineQueue: false });
      if (!live()) return;
      const saved = confirmedMinifigHoldingResponse(response, f.fig_num);
      if (!saved) throw new Error(t('minifigs.saveUnconfirmed'));
      updateFigHoldingState(f, holding, saved);
      holding = saved;
      toast(t('minifigs.saved'), 'success');
      const container = $('#figHoldingContainer');
      if (container) {
        container.innerHTML = holdingFormHTML(holding, moneyContext);
        wireHoldingForm(f, holding, detailGen, ownerSnapshot, moneyContext);
      }
    } catch (cause) {
      if (live() && error) error.textContent = t('minifigs.saveFailed', { error: cause?.message || cause });
    } finally {
      saving = false;
      if (live()) setBusy(false, $('#figSaveHolding'));
    }
  });

  const wireRemoveButton = () => $('#figRemoveHolding')?.addEventListener('click', () => {
    if (!live() || saving) return;
    const actions = $('#figRemoveActions');
    if (!actions) return;
    actions.innerHTML = `<p style="font-size:12.5px;color:var(--ink-mute);margin:0 0 8px;">${escapeHtml(t('minifigs.removeConfirm'))}</p><div class="btn-row"><button class="btn-danger" id="figConfirmRemove">${escapeHtml(t('minifigs.removeAction'))}</button><button class="btn-secondary" id="figCancelRemove">${escapeHtml(t('common.cancel'))}</button></div>`;
    $('#figCancelRemove')?.addEventListener('click', () => {
      actions.innerHTML = `<button class="btn-secondary" id="figRemoveHolding">${escapeHtml(t('minifigs.removeHolding'))}</button>`;
      wireRemoveButton();
    }, { once: true });
    $('#figConfirmRemove')?.addEventListener('click', async () => {
      if (saving || !live()) return;
      saving = true;
      const remove = $('#figConfirmRemove');
      setBusy(true, remove);
      try {
        await api(`/api/minifigs/${encodeURIComponent(f.fig_num)}`, { method: 'DELETE', retry: false, offlineQueue: false });
        if (!live()) return;
        updateFigHoldingState(f, holding, null);
        holding = null;
        toast(t('minifigs.removed'), 'success');
        const container = $('#figHoldingContainer');
        if (container) {
          container.innerHTML = holdingFormHTML(null, moneyContext);
          wireHoldingForm(f, null, detailGen, ownerSnapshot, moneyContext);
        }
      } catch (cause) {
        if (live()) {
          setBusy(false, remove);
          const error = $('#figHoldingError');
          if (error) error.textContent = t('minifigs.removeFailed', { error: cause?.message || cause });
        }
      } finally { saving = false; }
    });
  }, { once: true });
  wireRemoveButton();
}

function showFigDetail(f) {
  const detailGen = ++_figDetailGen;
  const detailFigNum = f.fig_num;
  const ownerSnapshot = getSessionOwnerSnapshot();
  const moneyContext = capturedMoneyContext();
  const realVal = f.current_value ?? null;
  const rarity = f.rarity || 'common';
  const n = f.appears_in_sets ?? null;
  const scarcityTxt = (n != null && n > 0)
    ? (n === 1 ? t('minifigs.setExclusive') : tPlural('minifigs.appearsInSets', n))
    : null;
  const hasImg = f.image_url;
  const rbUrl = `https://rebrickable.com/minifigs/${encodeURIComponent(f.fig_num)}/`;

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
        <div id="figHoldingContainer" aria-live="polite"><div class="spinner" aria-label="${escapeHtml(t('minifigs.loadingHolding'))}"></div></div>
        <a class="fig-detail-link" href="${rbUrl}" target="_blank" rel="noopener noreferrer">
          ${I.extLink()}<span>View on Rebrickable</span>
        </a>
        <div id="figSetsSection" style="margin-top:16px;"></div>
      </div>
    </div>`);

  (async () => {
    try {
      const response = await api('/api/minifigs/' + encodeURIComponent(f.fig_num));
      if (detailGen !== _figDetailGen || ownerSnapshot.generation !== getSessionOwnerSnapshot().generation) return;
      const holding = normalizeMinifigHolding(response?.holding);
      if (response?.minifig) Object.assign(f, response.minifig);
      const container = $('#figHoldingContainer');
      if (!container) return;
      container.innerHTML = holdingFormHTML(holding, moneyContext);
      wireHoldingForm(f, holding, detailGen, ownerSnapshot, moneyContext);
    } catch (cause) {
      if (detailGen !== _figDetailGen || ownerSnapshot.generation !== getSessionOwnerSnapshot().generation) return;
      const container = $('#figHoldingContainer');
      if (!container) return;
      container.innerHTML = `<div role="alert" style="color:var(--down);font-size:13px;margin-bottom:10px;">${escapeHtml(t('minifigs.loadHoldingFailed', { error: cause?.message || cause }))}</div><button class="btn-secondary" id="figRetryHolding">${escapeHtml(t('common.retry'))}</button>`;
      $('#figRetryHolding')?.addEventListener('click', () => showFigDetail(f), { once: true });
    }
  })();

  // Lazily load the 90-day price history and draw the trend sparkline (mirrors
  // the set detail chart). Only shown once we have ≥2 snapshots.
  if (realVal != null && realVal > 0) {
    (async () => {
      try {
        const r = await api('/api/minifigs/' + encodeURIComponent(f.fig_num) + '/history?days=90');
        if (detailGen !== _figDetailGen || detailFigNum !== f.fig_num) return;
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
      if (detailGen !== _figDetailGen || detailFigNum !== f.fig_num) return;
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
