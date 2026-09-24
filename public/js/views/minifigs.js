import { vaultNavigation, discoverNavigation, setPageFab } from '../components/collector-shell.js';
import { $, $$, haptic, escapeHtml, toast, debounce, bvIDB, SEARCH_DEBOUNCE_MS, mount, fmtDateUpdated, thumbImg, capturedMoneyContext, CURRENCY_SYMBOLS, setBtnLoading, snackbar } from '../utils.js';
import { t, tPlural } from '../lib/i18n.js';
import { state } from '../state.js';
import { api, getSessionUserId, getSessionOwnerSnapshot } from '../api.js';
import { showSheet, hideSheet } from '../components/sheet.js';
import { activeFigFilterCount } from '../lib/pure.js';
import { figFilterSummaryText } from '../lib/filter-summary.js';
import { confirmedMinifigHoldingResponse, parseMinifigHoldingForm, normalizeMinifigHolding } from '../lib/minifig-holding.js';
import { usdMoneyInputValue } from '../lib/money-input.js';
import { exportBlob } from '../lib/native-file-export.js';
import { icon, iconBtn, topbar, searchBar, chip, card, bar, emptyState, btn, sheetBody, sparkline, attrs, skeletonRows } from '../ui/kit.js';
import { tileAction } from '../ui/set-ui.js';
import { vaultTopbar, vaultSearchRow, sortButton, vaultToolbar, openChoiceSheet, openActionSheet, vaultFigTile, rarityLabel, rarityPill, figArtHtml, moneyWhole } from '../ui/vault-ui.js';

// Minifigures, in two modes on one route:
//  · Vault → Minifigs (#/minifigs?owned=1, or bare #/minifigs): the figures
//    you own — value hero, series progress, sort + series filter, 3-up grid.
//  · Discover → Minifigs (#/minifigs?owned=0[&series=…]): the whole catalogue
//    with one-tap add/owned toggles on every tile.
// Tapping a figure opens the figure sheet: value, where it comes from and the
// holding editor (copies, price paid, condition, date, notes).

let _blindGen = 0;
let _figDetailGen = 0;
let _seriesList = [];
let _seriesProgress = null;
let figSearchOpen = false;

const esc = (v) => escapeHtml(v == null ? '' : String(v));
const onFigs = () => location.hash.split('?')[0] === '#/minifigs';
const hashParams = () => new URLSearchParams(location.hash.split('?')[1] || '');
const ownedMode = () => state.filter.figOwned === 'owned';

// Bi-directional minifig sort options. The sort sheet offers both directions;
// the backend accepts all keys below.
const FIG_SORTS = [
  { base: "rarity",   asc: "rarity_asc",   desc: "rarity_desc", def: "rarity_desc", label: "Rarity" },
  { base: "scarcity", asc: "scarcity_asc", desc: "scarcity",    def: "scarcity",    label: "Rarest" },
  { base: "year",     asc: "year_asc",     desc: "year_desc",   def: "year_desc",   label: "Newest" },
  { base: "value",    asc: "value_asc",    desc: "value_desc",  def: "value_desc",  label: "Value" },
  { base: "name",     asc: "name_asc",     desc: "name_desc",   def: "name_asc",    label: "A-Z" },
];
const SORT_KEYS = {
  rarity_desc: 'figSortRarityDesc', rarity_asc: 'figSortRarityAsc', scarcity: 'figSortScarcity', scarcity_asc: 'figSortScarcityAsc',
  year_desc: 'figSortYearDesc', year_asc: 'figSortYearAsc', value_desc: 'figSortValueDesc', value_asc: 'figSortValueAsc',
  name_asc: 'figSortNameAsc', name_desc: 'figSortNameDesc',
};
const SHORT_KEYS = { rarity: 'figSortRarity', scarcity: 'figSortRarest', year: 'figSortYear', value: 'sortValue', name: 'sortAz' };
const sortShortLabel = (value) => {
  const o = FIG_SORTS.find(s => s.asc === value || s.desc === value) || FIG_SORTS[3];
  if (o.base === 'year' && value === 'year_asc') return t('bvVault.figSortOldest');
  if (o.base === 'name' && value === 'name_desc') return t('bvVault.figSortZa');
  return t(`bvVault.${SHORT_KEYS[o.base]}`);
};
const currentSort = () => (ownedMode() ? (state.filter.figOwnedSort || 'value_desc') : (state.filter.figSort || 'year_desc'));
const currentSeries = () => (ownedMode() ? (state.filter.figOwnedSeries || 'all') : (state.filter.figSeries || 'all'));
const currentQ = () => (ownedMode() ? (state.filter.figOwnedQ || '') : (state.filter.figQ || ''));

// Series names can be long ("Collectible Minifigures Series 21"); tiles and
// chips use the short collector form ("CMF Series 21").
function seriesShort(name = '') {
  return String(name).replace(/^Collectible Minifigures\s*/i, 'CMF ').replace(/^LEGO\s+/i, '').trim() || String(name);
}

// Distinct series with counts, for the series pickers. Fetched once and cached
// for the session (the catalog is static between deploys).
async function loadSeriesList() {
  if (_seriesList.length) return _seriesList;
  try {
    const res = await api('/api/minifigs/series');
    _seriesList = res.series || [];
  } catch { /* leave empty — the picker still offers "All series" */ }
  return _seriesList;
}

function applySeriesFilter(value) {
  if (ownedMode()) state.filter.figOwnedSeries = value; else state.filter.figSeries = value;
  haptic('light');
  reloadMiniView().catch(() => {});
}

function openSeriesSheet() {
  const current = currentSeries();
  const paint = (list) => openChoiceSheet({
    title: t('bvVault.figSeriesTitle'),
    current,
    options: [{ value: 'all', label: t('bvVault.figAllSeries') }]
      .concat(current !== 'all' && !list.some(s => s.series === current) ? [{ value: current, label: seriesShort(current) }] : [])
      .concat(list.map(s => ({ value: s.series, label: seriesShort(s.series), sub: tPlural('bvVault.figSeriesCount', s.n) }))),
    onPick: (value) => { if (value !== currentSeries()) applySeriesFilter(value); },
  });
  if (_seriesList.length) paint(_seriesList);
  else loadSeriesList().then(paint);
}

function openFigSortSheet() {
  haptic('light');
  openChoiceSheet({
    title: t('bvVault.figSortTitle'),
    current: currentSort(),
    options: FIG_SORTS.flatMap(o => (o.def === o.asc ? [o.asc, o.desc] : [o.desc, o.asc]).map(value => ({ value, label: t(`bvVault.${SORT_KEYS[value]}`) }))),
    onPick: (value) => {
      if (value === currentSort()) return;
      if (ownedMode()) state.filter.figOwnedSort = value; else state.filter.figSort = value;
      reloadMiniView().catch(() => {});
    },
  });
}

export async function renderBlind() {
  const requestedOwned = hashParams().get('owned');
  // Bare #/minifigs is the Vault's Minifigs tab; ?owned=0 is Discover.
  const requestedFilter = requestedOwned === '0' ? (state.filter.figOwned === 'unowned' ? 'unowned' : 'all') : 'owned';
  if (state.filter.figOwned !== requestedFilter) { state.filter.figOwned = requestedFilter; state.blind.items = []; }
  const requestedSeries = hashParams().get('series');
  if (!ownedMode() && requestedSeries && requestedSeries !== state.filter.figSeries) { state.filter.figSeries = requestedSeries; state.blind.items = []; }
  // Cached results (memory or the offline IndexedDB copy) belong to one mode.
  if (state.blind.mode && state.blind.mode !== state.filter.figOwned) state.blind.items = [];

  if (!state.blind.items.length) {
    $("#root").innerHTML = `<main class="bv-page vault-figs" aria-busy="true">${ownedMode() ? vaultTopbar() : topbar({ title: t('collector.discover') })}${skeletonRows(4)}</main>`;
    await loadBlind({ reset: true });
    if (isFigFilterDefault()) bvIDB.set('blind', { data: { items: state.blind.items, total: state.blind.total, hasMore: state.blind.hasMore, offset: state.blind.offset, mode: state.blind.mode }, ts: Date.now(), userId: getSessionUserId() }).catch(() => {});
  } else if (state.blind._stale) {
    state.blind._stale = false;
    loadBlind({ reset: true }).then(() => {
      if (onFigs() && $('#miniGrid')) {
        refreshMiniGrid();
        refreshMiniStats();
        if (isFigFilterDefault()) bvIDB.set('blind', { data: { items: state.blind.items, total: state.blind.total, hasMore: state.blind.hasMore, offset: state.blind.offset, mode: state.blind.mode }, ts: Date.now(), userId: getSessionUserId() }).catch(() => {});
      }
    }).catch(() => {});
  }
  if (!onFigs()) return;
  paintFigs();
  loadSeriesList();
  loadSeriesProgress();
}

function paintFigs() {
  const owned = ownedMode();
  const q = currentQ();
  const searchOpen = owned && (!!q || figSearchOpen);
  $("#root").innerHTML = owned ? `
    <main class="bv-page has-fab vault-figs is-owned" id="figsPage">
      ${vaultTopbar({ searchOpen, searchControls: 'figSearchRow', searchLabel: t('bvVault.figSearchOwned') })}
      ${searchOpen ? vaultSearchRow({ id: 'figSearch', rowId: 'figSearchRow', name: 'minifig_search', value: q, placeholder: t('bvVault.figSearchPlaceholder'), label: t('bvVault.figSearchLabel') }) : ''}
      ${searchOpen ? '' : ownedHeroHTML()}
      ${vaultNavigation('minifigs')}
      ${vaultToolbar(sortButton(sortShortLabel(currentSort()), { id: 'figSortBtn' }), chip(currentSeries() === 'all' ? t('bvVault.figAllSeries') : seriesShort(currentSeries()), { drop: true, id: 'figSeriesChip', pressed: currentSeries() !== 'all', attrs: { 'aria-haspopup': 'dialog' } }))}
      <p class="bv-sr" id="figResultsMeta" role="status" aria-live="polite">${esc(tPlural('bvVault.figResults', state.blind.total))}</p>
      <div class="bv-grid bv-grid--3 vault-fig-grid" id="miniGrid">${miniGridHTML()}</div>
      <div id="blindSentinel" class="vault-sentinel"${state.blind.hasMore ? '' : ' hidden'}><span class="bv-skel"></span></div>
    </main>` : `
    <main class="bv-page vault-figs is-discover" id="figsPage">
      ${topbar({ title: t('collector.discover'), actionsHtml: iconBtn({ icon: 'more', label: t('bvVault.moreOptions'), id: 'figMoreBtn', attrs: { 'aria-haspopup': 'dialog' } }) })}
      ${searchBar({ id: 'figSearch', name: 'minifig_search', value: q, placeholder: t('bvVault.figSearchPlaceholder'), label: t('bvVault.figSearchLabel') }).replace('<input', '<input aria-describedby="figResultsMeta"')}
      ${discoverNavigation('minifigs')}
      <div class="bv-chips vault-fig-chips">${discoverChipsHTML()}</div>
      <div id="figSeriesProgress">${seriesProgressHTML()}</div>
      <p class="bv-sr" id="figResultsMeta" role="status" aria-live="polite">${esc(tPlural('bvVault.figResults', state.blind.total))}</p>
      <div class="bv-grid bv-grid--3 vault-fig-grid" id="miniGrid">${miniGridHTML()}</div>
      <div id="blindSentinel" class="vault-sentinel"${state.blind.hasMore ? '' : ' hidden'}><span class="bv-skel"></span></div>
    </main>`;
  if (!owned) setPageFab(null);
  wireFigsPage();
  wireMiniCards();
  mountBlindSentinel();
  if (searchOpen && figSearchOpen) {
    const input = $('#figSearch');
    if (input && document.activeElement !== input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  }
}

function discoverChipsHTML() {
  const series = currentSeries();
  const n = activeFigFilterCount({ ...state.filter, figSeries: 'all', figQ: '', figOwned: 'all' });
  return chip(series === 'all' ? t('bvVault.figAllSeries') : seriesShort(series), { drop: true, id: 'figSeriesChip', pressed: series !== 'all', attrs: { 'aria-haspopup': 'dialog' } })
    + chip(t('bvVault.figNotOwned'), { id: 'figOwnedChip', pressed: state.filter.figOwned === 'unowned' })
    + chip(sortShortLabel(currentSort()), { icon: 'sort', drop: true, id: 'figSortBtn', attrs: { 'aria-haspopup': 'dialog', 'aria-label': t('bvVault.sortCurrent', { sort: sortShortLabel(currentSort()) }) } })
    // Rarity lives in More options → Minifig filters; an active one shows here.
    + (n ? chip(tPlural('catalog.filtersWithCount', n), { icon: 'filter', id: 'figFilterChip', pressed: true, attrs: { 'aria-haspopup': 'dialog', 'aria-controls': 'sheet', 'aria-expanded': 'false' } }) : '');
}

/* ---------------------------------------------------------------- owned hero + series progress */
function ownedHeroHTML() {
  const b = state.blind;
  const figures = tPlural('bvVault.figFigures', b.ownedCount || 0);
  const unique = tPlural('bvVault.figUnique', b.total || 0);
  return card(`<span class="vault-hero__head"><span class="vault-hero__label">${esc(t('bvVault.figValue'))}</span><span class="bv-label" id="figStatCount">${esc(`${figures} · ${unique}`)}</span></span>
    <span class="bv-hero__value" id="figStatValue">${esc(moneyWhole(b.ownedValue || 0))}</span>
    <span id="figSeriesProgress">${seriesProgressHTML()}</span>`, { cls: 'bv-hero vault-fig-hero', attrs: { 'aria-label': t('bvVault.figSummaryLabel') } });
}

function seriesProgressHTML() {
  const sp = _seriesProgress;
  const series = currentSeries();
  if (ownedMode()) {
    if (!sp || !sp.total) {
      return `<a class="vault-fig-progress" href="#/minifigs?owned=0"><span class="vault-fig-progress__text"><span class="vault-fig-progress__title">${esc(t('bvVault.figBrowse'))}</span></span><span class="bv-card__link">${esc(t('bvVault.figFind'))}${icon('chev', { size: 16 })}</span></a>`;
    }
    const left = Math.max(0, sp.total - sp.owned);
    return `<a class="vault-fig-progress" href="#/minifigs?owned=0&series=${encodeURIComponent(sp.series)}"><span class="vault-fig-progress__text"><span class="vault-fig-progress__title">${esc(tPlural('bvVault.figSeriesOf', sp.total, { series: seriesShort(sp.series), owned: sp.owned }))}</span>${bar((sp.owned / sp.total) * 100, { label: tPlural('bvVault.figSeriesOf', sp.total, { series: seriesShort(sp.series), owned: sp.owned }) })}</span>
      <span class="bv-card__link">${esc(left ? tPlural('bvVault.figToFind', left) : t('bvVault.figComplete'))}${icon('chev', { size: 16 })}</span></a>`;
  }
  if (series === 'all' || !sp || sp.series !== series || !sp.total) return '';
  const left = Math.max(0, sp.total - sp.owned);
  return card(`<span class="vault-fig-progress__head"><span class="vault-fig-progress__title">${esc(tPlural('bvVault.figSeriesOwnedOf', sp.total, { series: seriesShort(series).replace(/^CMF\s+/, ''), owned: sp.owned }))}</span><span class="bv-label">${esc(left ? tPlural('bvVault.figToFind', left) : t('bvVault.figComplete'))}</span></span>${bar((sp.owned / sp.total) * 100)}`, { cls: 'vault-fig-series' });
}

// The series you are furthest into (by owned figures), or the one Discover is
// filtered to, with owned / total counts.
async function loadSeriesProgress() {
  const owner = getSessionOwnerSnapshot();
  let series = null;
  if (ownedMode()) {
    const counts = new Map();
    for (const f of state.blind.items) if (f.series && /series|collectible|cmf/i.test(f.series)) counts.set(f.series, (counts.get(f.series) || 0) + 1);
    // Most owned first; ties go to the newest series ("Series 21" before "Series 13").
    series = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0], undefined, { numeric: true }))[0]?.[0] || null;
  } else if (currentSeries() !== 'all') series = currentSeries();
  if (!series) { if (_seriesProgress) { _seriesProgress = null; repaintProgress(); } return; }
  try {
    const q = (extra) => api(`/api/minifigs?${new URLSearchParams({ series, limit: '1', ...extra })}`);
    const [all, mine] = await Promise.all([q({}), getSessionUserId() ? q({ owned: 'yes' }) : Promise.resolve(null)]);
    const now = getSessionOwnerSnapshot();
    if (now.userId !== owner.userId || now.generation !== owner.generation) return;
    const owned = mine ? Number(mine.total) || 0
      : [...state.ownedFigs].filter(num => (state.blind.items.find(f => f.fig_num === num)?.series ?? guestFigSeries(num)) === series).length;
    _seriesProgress = { series, total: Number(all?.total) || 0, owned };
  } catch { _seriesProgress = null; }
  repaintProgress();
}
function guestFigSeries(num) {
  try { return JSON.parse(localStorage.getItem('bv_guest_fig_details') || '{}')[num]?.series; } catch { return undefined; }
}
function repaintProgress() {
  const host = $('#figSeriesProgress');
  if (host && onFigs()) host.innerHTML = seriesProgressHTML();
}

/* ---------------------------------------------------------------- data */
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
    let fresh = res.minifigs || [];
    fresh.forEach(f => { if (f.owned_qty > 0) state.ownedFigs.add(f.fig_num); });
    saveFigs();
    // Guest owned lists come back unfiltered from the device; apply the same
    // search, series and sort the server would.
    if (!getSessionUserId() && ownedMode()) fresh = localFigFilter(fresh);
    b.items = reset ? fresh : b.items.concat(fresh);
    b.total = (!getSessionUserId() && ownedMode()) ? b.items.length : (res.total ?? b.items.length);
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
    b.mode = state.filter.figOwned;
    return fresh;
  } catch (_e) {
    if (myGen === _blindGen) toast(t('bvVault.figLoadFailed'), "error");
    return [];
  } finally {
    if (myGen === _blindGen) b.loading = false;
  }
}

function localFigFilter(list) {
  const q = currentQ().toLowerCase().trim();
  const series = currentSeries();
  let rows = list.filter(f => (!q || String(f.name || '').toLowerCase().includes(q) || String(f.series || '').toLowerCase().includes(q))
    && (series === 'all' || f.series === series));
  const rarityRank = { legendary: 4, rare: 3, uncommon: 2 };
  const v = (f) => Number(f.current_value) || 0;
  const sorters = {
    value_desc: (a, b) => v(b) - v(a), value_asc: (a, b) => v(a) - v(b),
    name_asc: (a, b) => String(a.name).localeCompare(String(b.name)), name_desc: (a, b) => String(b.name).localeCompare(String(a.name)),
    year_desc: (a, b) => (Number(b.year) || 0) - (Number(a.year) || 0), year_asc: (a, b) => (Number(a.year) || 9999) - (Number(b.year) || 9999),
    rarity_desc: (a, b) => (rarityRank[b.rarity] || 1) - (rarityRank[a.rarity] || 1), rarity_asc: (a, b) => (rarityRank[a.rarity] || 1) - (rarityRank[b.rarity] || 1),
  };
  const sorter = sorters[currentSort()];
  if (sorter) rows = rows.slice().sort(sorter);
  return rows;
}

function blindQuery() {
  const f = state.filter;
  const b = state.blind;
  const p = new URLSearchParams({ limit: b.pageSize, offset: b.offset });
  const q = currentQ();
  const series = currentSeries();
  const rarity = ownedMode() ? (f.figOwnedRarity || 'all') : f.figRarity;
  if (q)                            p.set('q', q);
  if (rarity && rarity !== 'all')   p.set('rarity', rarity);
  if (series && series !== 'all')   p.set('series', series);
  if (f.figOwned === 'owned')       p.set('owned', 'yes');
  if (f.figOwned === 'unowned')     p.set('owned', 'no');
  p.set('sort', currentSort());
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
  const meta = $('#figResultsMeta');
  if (meta) meta.textContent = tPlural('bvVault.figResults', state.blind.total);
  const chips = $('.vault-fig-chips');
  if (chips) { chips.innerHTML = discoverChipsHTML(); wireChips(); }
  const sortBtn = $('.vault-figs.is-owned #figSortBtn');
  if (sortBtn) { sortBtn.outerHTML = sortButton(sortShortLabel(currentSort()), { id: 'figSortBtn' }); $('#figSortBtn')?.addEventListener('click', openFigSortSheet); }
  const seriesChip = $('.vault-figs.is-owned #figSeriesChip');
  if (seriesChip) {
    seriesChip.outerHTML = chip(currentSeries() === 'all' ? t('bvVault.figAllSeries') : seriesShort(currentSeries()), { drop: true, id: 'figSeriesChip', pressed: currentSeries() !== 'all', attrs: { 'aria-haspopup': 'dialog' } });
    $('#figSeriesChip')?.addEventListener('click', openSeriesSheet);
  }
}

async function reloadMiniView() {
  await loadBlind({ reset: true });
  if (onFigs() && $('#miniGrid')) {
    refreshMiniGrid();
    refreshMiniStats();
    loadSeriesProgress();
  }
}

function miniGridHTML() {
  if (state.blind.items.length) return state.blind.items.map(f => miniCardHTML(f)).join('');
  const q = currentQ();
  const hasFilters = !isFigFilterDefault() || !!q;
  if (ownedMode() && !hasFilters) {
    return `<div class="vault-fig-empty">${emptyState({ icon: 'fig', title: t('bvVault.figEmptyTitle'), body: t('bvVault.figEmptyBody'), actionsHtml: btn(t('bvVault.figBrowse'), { href: '#/minifigs?owned=0', icon: 'search' }) })}</div>`;
  }
  return `<div class="vault-fig-empty">${emptyState({ icon: 'fig', title: t('bvVault.figNoMatches'),
    body: q ? t('minifigs.emptySearchResults', { query: q }) : t('minifigs.emptyFilteredResults'),
    actionsHtml: hasFilters ? btn(t('bvVault.figClearFilters'), { kind: 'tonal', id: 'figClearFilters' }) : '' })}</div>`;
}

function clearFigFilters() {
  if (ownedMode()) {
    state.filter.figOwnedQ = '';
    state.filter.figOwnedSeries = 'all';
    state.filter.figOwnedRarity = 'all';
  } else {
    state.filter.figQ = "";
    state.filter.figRarity = "all";
    state.filter.figOwned = "all";
    state.filter.figSeries = "all";
    state.filter.figSort = "year_desc";
  }
  haptic("light");
  loadBlind({ reset: true }).then(() => {
    if (onFigs() && $('#miniGrid')) {
      const q = $("#figSearch");
      if (q) q.value = "";
      refreshMiniGrid();
      refreshMiniStats();
      loadSeriesProgress();
    }
  }).catch(() => {});
}

function showFigFilterSheet() {
  const trigger = $("#figFilterChip");
  trigger?.setAttribute("aria-expanded", "true");
  const f = state.filter;
  const owned = ownedMode();
  const rarityOptions = [['all', t('common.all')], ...['common', 'uncommon', 'rare', 'legendary'].map(r => [r, rarityLabel(r)])];
  const ownedOptions = [['all', t('common.all')], ['owned', t('minifigs.filterSummaryOwned')], ['unowned', t('minifigs.filterSummaryUnowned')]];
  const sortOptions = FIG_SORTS.flatMap(o => (o.def === o.asc ? [o.asc, o.desc] : [o.desc, o.asc]).map(value => [value, t(`bvVault.${SORT_KEYS[value]}`)]));
  const chipGroup = (label, id, values, current) => `
    <section class="vault-facet">
      <h3 class="vault-actions__title">${esc(label)}</h3>
      <div class="bv-chips bv-chips--wrap" data-fig-facet="${esc(id)}">
        ${values.map(([value, labelText]) => chip(labelText, { pressed: current === value, attrs: { 'data-fval': value } })).join('')}
      </div>
    </section>`;
  const seenSeries = new Set();
  const seriesNow = currentSeries();
  const seriesValues = [['all', t('bvVault.figAllSeries')]]
    .concat(seriesNow !== 'all' ? [[seriesNow, seriesShort(seriesNow)]] : [])
    .concat(_seriesList.slice(0, 10).map(s => [s.series, seriesShort(s.series)]))
    .filter(([value]) => {
      if (seenSeries.has(value)) return false;
      seenSeries.add(value);
      return true;
    });
  const summary = figFilterSummaryText(owned ? { ...f, figOwned: 'all', figRarity: f.figOwnedRarity || 'all', figSeries: seriesNow, figQ: currentQ() } : f, t, tPlural);
  showSheet(sheetBody({
    title: t('bvVault.figFiltersTitle'), sub: summary,
    inner: `<div class="vault-facets">
      ${chipGroup(t('bvVault.figRarity'), 'rarity', rarityOptions, (owned ? f.figOwnedRarity : f.figRarity) || 'all')}
      ${owned ? '' : chipGroup(t('bvVault.figOwnership'), 'owned', ownedOptions, f.figOwned || 'all')}
      ${chipGroup(t('bvVault.figSeriesTitle'), 'series', seriesValues, seriesNow)}
      ${chipGroup(t('bvVault.figSortTitle'), 'sort', sortOptions, owned ? currentSort() : (f.figSort || 'year_desc'))}
    </div>
    <div class="bv-btn-row vault-facets__actions">${btn(t('bvVault.figClearAll'), { kind: 'outline', id: 'figFilterClear' })}${btn(t('bvVault.figApply'), { id: 'figFilterApply' })}</div>`,
  }));
  $("#sheet")?.addEventListener("sheet:closing", () => {
    $("#figFilterChip")?.setAttribute("aria-expanded", "false");
  }, { once: true });

  $$("[data-fig-facet]").forEach(group => group.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fval]");
    if (!b) return;
    group.querySelectorAll("[data-fval]").forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  }));
  const readFacet = (id) => document.querySelector(`[data-fig-facet="${id}"] [aria-pressed="true"]`)?.dataset.fval || 'all';
  $("#figFilterClear")?.addEventListener("click", () => {
    hideSheet();
    clearFigFilters();
  });
  $("#figFilterApply")?.addEventListener("click", () => {
    if (owned) {
      state.filter.figOwnedRarity = readFacet('rarity');
      state.filter.figOwnedSeries = readFacet('series');
      state.filter.figOwnedSort = readFacet('sort');
    } else {
      state.filter.figRarity = readFacet('rarity');
      state.filter.figOwned = readFacet('owned') === 'owned' ? 'all' : readFacet('owned');
      state.filter.figSeries = readFacet('series');
      state.filter.figSort = readFacet('sort');
    }
    hideSheet();
    haptic("light");
    reloadMiniView().catch(() => {});
  });
}

const debouncedFigSearch = debounce(async () => {
  await loadBlind({ reset: true });
  if (!onFigs()) return;
  refreshMiniGrid();
  refreshMiniStats();
}, SEARCH_DEBOUNCE_MS);

function openFigMoreSheet() {
  haptic('light');
  const owned = ownedMode();
  openActionSheet({
    title: t('bvVault.moreOptions'),
    groups: [{ rows: [
      { id: 'figMoreFilters', icon: 'filter', label: t('bvVault.figFiltersTitle'), sub: t('bvVault.figFiltersSub'), onClick: showFigFilterSheet },
      { id: 'figExportBtn', icon: 'download', label: t('minifigs.exportCsv'), sub: t('bvVault.figExportSub'), onClick: exportMinifigHoldings },
      owned ? { id: 'figMoreDiscover', icon: 'search', label: t('bvVault.figBrowse'), href: '#/minifigs?owned=0' } : { id: 'figMoreOwned', icon: 'fig', label: t('bvVault.figYours'), href: '#/minifigs?owned=1' },
      owned ? { id: 'figMoreChanges', icon: 'bell', label: t('bvVault.whatChanged'), href: '#/changes' } : null,
    ] }],
  });
}

function wireChips() {
  $('#figSeriesChip')?.addEventListener('click', openSeriesSheet);
  $('#figSortBtn')?.addEventListener('click', openFigSortSheet);
  $('#figFilterChip')?.addEventListener('click', () => showFigFilterSheet());
  $('#figOwnedChip')?.addEventListener('click', () => {
    state.filter.figOwned = state.filter.figOwned === 'unowned' ? 'all' : 'unowned';
    haptic('light');
    reloadMiniView().catch(() => {});
  });
}

function wireFigsPage() {
  const figSearchInput = $("#figSearch");
  figSearchInput?.addEventListener("input", (e) => {
    if (ownedMode()) state.filter.figOwnedQ = e.target.value; else state.filter.figQ = e.target.value;
    debouncedFigSearch();
  });
  $('#vaultSearchBtn')?.addEventListener('click', () => {
    haptic('light');
    const wasOpen = !!$('#figSearch');
    figSearchOpen = !wasOpen;
    if (wasOpen && state.filter.figOwnedQ) {
      state.filter.figOwnedQ = '';
      reloadMiniView().then(() => { if (onFigs()) paintFigs(); }).catch(() => {});
    }
    paintFigs();
  });
  $('#vaultMoreBtn')?.addEventListener('click', openFigMoreSheet);
  $('#figMoreBtn')?.addEventListener('click', openFigMoreSheet);
  wireChips();
}

function wireMiniCards() {
  const grid = $("#miniGrid");
  if (!grid || grid._delegated) return;
  grid._delegated = true;
  grid.addEventListener("click", (evt) => {
    if (evt.target.closest("#figClearFilters")) { clearFigFilters(); return; }
    const tile = evt.target.closest("[data-fig-num]");
    if (!tile) return;
    const num = tile.dataset.figNum;
    const f = state.blind.items.find(x => x.fig_num === num);
    if (!f) return;
    haptic("light");
    if (evt.target.closest('[data-fig-add]')) { quickAdd(f); return; }
    showFigDetail(f);
  });
}

// One-tap add from Discover: optimistic tile + counts, then the holding write,
// with Undo in the snackbar (never a new screen).
async function quickAdd(f) {
  if (state.ownedFigs.has(f.fig_num)) { showFigDetail(f); return; }
  const ownerSnapshot = getSessionOwnerSnapshot();
  const next = { quantity: 1, condition: 'unknown', purchase_price: null, purchased_at: null, notes: null };
  updateFigHoldingState(f, null, next);
  try {
    const response = await api(`/api/minifigs/${encodeURIComponent(f.fig_num)}`, { method: 'PUT', body: { quantity: 1 }, retry: false, offlineQueue: false });
    if (ownerSnapshot.generation !== getSessionOwnerSnapshot().generation) return;
    const saved = confirmedMinifigHoldingResponse(response, f.fig_num) || next;
    snackbar(t('bvVault.figAdded', { name: f.name || f.fig_num }), { actions: [{ label: t('common.undo'), kind: 'undo', onClick: async () => {
      try {
        await api(`/api/minifigs/${encodeURIComponent(f.fig_num)}`, { method: 'DELETE', retry: false, offlineQueue: false });
        updateFigHoldingState(f, saved, null);
      } catch (cause) { toast(t('minifigs.removeFailed', { error: cause?.message || cause }), 'error'); }
    } }] });
  } catch (cause) {
    updateFigHoldingState(f, next, null);
    toast(t('minifigs.saveFailed', { error: cause?.message || cause }), 'error');
  }
}

function updateBlindCount() {
  const el = $("#figStatCount");
  if (!el) return;
  el.textContent = [tPlural('bvVault.figFigures', state.blind.ownedCount || 0), tPlural('bvVault.figUnique', ownedMode() ? state.blind.total : state.ownedFigs.size)].join(' · ');
}

function updateFigStats() {
  const { ownedCount = 0, ownedValue = 0 } = state.blind;
  const valueEl = $("#figStatValue");
  if (valueEl) valueEl.textContent = moneyWhole(ownedValue);
  const meta = $('#figResultsMeta');
  if (meta) meta.textContent = tPlural('bvVault.figResults', state.blind.total);
  // Owned figures across the collection, for the Discover progress card.
  if (_seriesProgress && ownedCount >= 0) repaintProgress();
}

function refreshMiniStats() {
  updateBlindCount();
  updateFigStats();
}

// Attribution label for a fig's market value. Per the source-naming policy we
// name the API sources (BrickLink, eBay) and fall back to a neutral estimate.
function figSourceLabel(source) {
  if (source === 'bricklink+ebay') return t('bvVault.figSourceBlEbay');
  if (source === 'bricklink') return t('bvVault.figSourceBl');
  return t('bvVault.figSourceBlend');
}

async function exportMinifigHoldings() {
  const btnEl = $('#figExportBtn');
  if (btnEl?.disabled) return;
  const ownerSnapshot = getSessionOwnerSnapshot();
  setBtnLoading(btnEl, true);
  try {
    const blob = await api('/api/minifigs/export', { responseType: 'blob' });
    if (ownerSnapshot.generation !== getSessionOwnerSnapshot().generation) throw new Error(t('minifigs.accountChanged'));
    await exportBlob(blob, 'brickvault-minifigures.csv', { title: t('minifigs.exportTitle') });
    toast(t('minifigs.exportReady'), 'success');
  } catch (error) {
    toast(t('minifigs.exportFailed', { error: error?.message || error }), 'error');
  } finally {
    setBtnLoading(btnEl, false);
  }
}

/* ---------------------------------------------------------------- figure sheet + holding editor */
function holdingFormHTML(holding, moneyContext) {
  const saved = normalizeMinifigHolding(holding);
  const condition = saved?.condition || 'unknown';
  const currency = moneyContext.currency;
  const symbol = CURRENCY_SYMBOLS[currency] || currency;
  const option = (value, key) => `<option value="${value}"${condition === value ? ' selected' : ''}>${esc(t(key))}</option>`;
  return `
    <section class="vault-fig-form" aria-labelledby="figHoldingTitle">
      <h3 class="bv-sr" id="figHoldingTitle">${esc(saved ? t('minifigs.editHolding') : t('minifigs.addHolding'))}</h3>
      <div class="bv-form-grid">
        <div class="bv-field">
          <label for="figQuantity">${esc(t('bvVault.figCopies'))}</label>
          <div class="bv-field__box vault-stepper">${iconBtn({ icon: 'minus', label: t('bvVault.figOneFewer'), id: 'figQtyDown' })}<input id="figQuantity" class="bv-mono-input" type="number" inputmode="numeric" min="1" max="9999" step="1" value="${saved?.quantity || 1}">${iconBtn({ icon: 'plus', label: t('bvVault.figOneMore'), id: 'figQtyUp' })}</div>
        </div>
        <div class="bv-field">
          <label for="figPurchasePrice">${esc(t('bvVault.figPricePaid'))}</label>
          <div class="bv-field__box"><span class="bv-field__prefix">${esc(symbol)}</span><input id="figPurchasePrice" class="bv-mono-input" type="text" inputmode="decimal" autocomplete="off" value="${esc(usdMoneyInputValue(saved?.purchase_price, moneyContext))}" placeholder="${esc(t('bvVault.figOptional'))}" aria-label="${esc(t('minifigs.purchasePrice', { currency, symbol }))}"></div>
        </div>
        <div class="bv-field">
          <label for="figCondition">${esc(t('minifigs.condition'))}</label>
          <div class="bv-field__box"><select id="figCondition">${option('unknown', 'minifigs.conditionUnknown')}${option('new', 'minifigs.conditionNew')}${option('used_good', 'minifigs.conditionUsedGood')}${option('used_acceptable', 'minifigs.conditionUsedAcceptable')}</select></div>
        </div>
        <div class="bv-field">
          <label for="figPurchasedAt">${esc(t('minifigs.purchasedAt'))}</label>
          <div class="bv-field__box"><input id="figPurchasedAt" type="date" value="${esc(saved?.purchased_at || '')}"></div>
        </div>
      </div>
      <div class="bv-field">
        <label for="figNotes">${esc(t('minifigs.notes'))}</label>
        <div class="bv-field__box"><textarea id="figNotes" rows="2" maxlength="2000" placeholder="${esc(t('minifigs.notesPlaceholder'))}">${esc(saved?.notes || '')}</textarea></div>
      </div>
      <p class="bv-field__help">${esc(t('minifigs.looseOnly'))}</p>
      <p class="bv-field__error" id="figHoldingError" role="alert"></p>
      ${btn(saved ? t('common.save') : t('minifigs.addToVault'), { id: 'figSaveHolding', full: true, size: 'lg' })}
      ${saved ? `<div id="figRemoveActions">${btn(t('bvVault.figRemove'), { kind: 'danger', full: true, id: 'figRemoveHolding' })}</div>` : ''}
    </section>`;
}

function updateFigHoldingState(f, previous, next) {
  const oldQuantity = previous?.quantity || 0;
  const newQuantity = next?.quantity || 0;
  if (next) state.ownedFigs.add(f.fig_num); else state.ownedFigs.delete(f.fig_num);
  f.owned_qty = newQuantity;
  saveFigs();
  const tile = $(`#miniGrid [data-fig-num="${CSS.escape(f.fig_num)}"]`);
  if (tile) tile.outerHTML = miniCardHTML(f);
  state.blind.ownedCount = Math.max(0, (state.blind.ownedCount || 0) + newQuantity - oldQuantity);
  state.blind.ownedValue = Math.max(0, (state.blind.ownedValue || 0) + (newQuantity - oldQuantity) * (Number(f.current_value ?? f.value) || 0));
  if (_seriesProgress && f.series === _seriesProgress.series && !previous !== !next) {
    _seriesProgress = { ..._seriesProgress, owned: Math.max(0, _seriesProgress.owned + (next ? 1 : -1)) };
  }
  refreshMiniStats();
  if (state.filter.figOwned !== 'all' && !previous !== !next) {
    loadBlind({ reset: true }).then(() => {
      if (onFigs()) { refreshMiniGrid(); refreshMiniStats(); }
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
  const qty = $('#figQuantity');
  const step = (d) => { if (!qty || qty.disabled) return; qty.value = String(Math.min(9999, Math.max(1, (Number(qty.value) || 1) + d))); haptic('light'); };
  $('#figQtyDown')?.addEventListener('click', () => step(-1));
  $('#figQtyUp')?.addEventListener('click', () => step(1));
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
    const saveBtn = $('#figSaveHolding');
    setBusy(true, saveBtn);
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
    actions.innerHTML = `<p class="bv-field__help">${esc(t('minifigs.removeConfirm'))}</p><div class="bv-btn-row">${btn(t('minifigs.removeAction'), { kind: 'danger-fill', id: 'figConfirmRemove' })}${btn(t('common.cancel'), { kind: 'tonal', id: 'figCancelRemove' })}</div>`;
    $('#figCancelRemove')?.addEventListener('click', () => {
      actions.innerHTML = btn(t('bvVault.figRemove'), { kind: 'danger', full: true, id: 'figRemoveHolding' });
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
  const rbUrl = `https://rebrickable.com/minifigs/${encodeURIComponent(f.fig_num)}/`;
  const facts = [scarcityTxt, f.year ? t('bvVault.figFirstSeen', { year: f.year }) : '', f.num_parts ? tPlural('minifigs.parts', f.num_parts) : ''].filter(Boolean);

  showSheet(`<div class="bv-sheet vault-fig-sheet">
    <div class="vault-fig-sheet__head">
      <span class="vault-fig-sheet__art">${figArtHtml(f, { size: 76, width: 320 })}</span>
      <div class="vault-fig-sheet__title">${rarityPill(rarity) || `<span class="bv-pill">${esc(rarityLabel(rarity))}</span>`}<h2>${esc(f.name)}</h2><span class="bv-label">${esc(f.series || t('bvVault.figMinifig'))}</span></div>
      <button type="button" class="bv-iconbtn" data-bv-sheet-close aria-label="${esc(t('common.close'))}">${icon('x')}</button>
    </div>
    <div class="vault-fig-sheet__facts">
      <div><span class="bv-label">${esc(t('bvVault.figMarketValue'))}</span><span class="bv-num vault-fig-sheet__value">${realVal != null && realVal > 0 ? esc(moneyWhole(realVal)) : '—'}</span>${realVal != null && realVal > 0 ? `<span class="bv-field__help">${esc(figSourceLabel(f.source))}${f.cached_at ? ` · ${esc(fmtDateUpdated(f.cached_at))}` : ''}</span>` : ''}</div>
      <div id="figComesIn"><span class="bv-label">${esc(t('bvVault.figComesIn'))}</span><span class="vault-fig-sheet__comes">${esc(f.series ? seriesShort(f.series) : '—')}</span></div>
    </div>
    <div class="vault-fig-sheet__spark" id="figSparkWrap" hidden></div>
    ${facts.length ? `<p class="vault-fig-sheet__meta">${esc(facts.join(' · '))}</p>` : ''}
    <div id="figHoldingContainer" aria-live="polite"><div class="bv-skel" style="height:52px" aria-label="${esc(t('minifigs.loadingHolding'))}"></div></div>
    <div id="figSetsSection"></div>
    <a class="bv-btn bv-btn--text vault-fig-sheet__ext" href="${rbUrl}" target="_blank" rel="noopener noreferrer">${icon('ext', { size: 20 })}<span>${esc(t('bvVault.figRebrickable'))}</span></a>
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
      container.innerHTML = `<p class="bv-field__error" role="alert">${esc(t('minifigs.loadHoldingFailed', { error: cause?.message || cause }))}</p>${btn(t('common.retry'), { kind: 'tonal', id: 'figRetryHolding' })}`;
      $('#figRetryHolding')?.addEventListener('click', () => showFigDetail(f), { once: true });
    }
  })();

  // Lazily load the 90-day price history (shown only with ≥2 snapshots).
  if (realVal != null && realVal > 0) {
    (async () => {
      try {
        const r = await api('/api/minifigs/' + encodeURIComponent(f.fig_num) + '/history?days=90');
        if (detailGen !== _figDetailGen || detailFigNum !== f.fig_num) return;
        const hist = (r && r.history) || [];
        if (hist.length < 2) return;
        const wrap = $('#figSparkWrap');
        if (!wrap) return;
        wrap.hidden = false;
        wrap.innerHTML = `<span class="bv-label">${esc(tPlural('detail.priceHistoryShort', 90))}</span>${sparkline(hist.map(h => Number(h.current_value)), { width: 340, height: 48, label: tPlural('detail.priceHistoryShort', 90) })}`;
      } catch { /* non-fatal — the chart just stays hidden */ }
    })();
  }

  // Lazily load the sets this minifig appears in — "Comes in" plus a navigable
  // list of every set (hidden if the fig isn't mapped to any catalog sets).
  (async () => {
    try {
      const r = await api('/api/minifigs/' + encodeURIComponent(f.fig_num) + '/sets');
      if (detailGen !== _figDetailGen || detailFigNum !== f.fig_num) return;
      const sets = (r && r.sets) || [];
      if (!sets.length) return;
      const comes = $('#figComesIn');
      if (comes) comes.outerHTML = `<a id="figComesIn" class="vault-fig-sheet__comes-link" href="#/set/${encodeURIComponent(String(sets[0].set_num))}"><span class="bv-label">${esc(t('bvVault.figComesIn'))}</span><span class="vault-fig-sheet__comes">${esc(String(sets[0].name || sets[0].set_num))}${icon('chev', { size: 16 })}</span></a>`;
      const el = $('#figSetsSection');
      if (!el || sets.length < 2) return;
      el.innerHTML = `<h3 class="vault-actions__title">${esc(tPlural('minifigs.appearsInSets', sets.length))}</h3><div class="bv-group__box">${sets.map((s) => `<a class="bv-row vault-fig-set" href="#/set/${encodeURIComponent(String(s.set_num))}"${attrs({ 'data-set': s.set_num })}>
          ${s.image_url ? `<span class="bv-thumb" style="--size:40px"><img class="set-photo" src="${esc(thumbImg(String(s.image_url)))}" alt="" loading="lazy" decoding="async"></span>` : icon('brick', { size: 22 })}
          <span class="bv-row__text"><span class="bv-row__title">${esc(String(s.name || s.set_num))}</span><span class="bv-row__sub">${esc([String(s.set_num).replace(/-\d+$/, ''), s.year].filter(Boolean).join(' · '))}</span></span>
          ${s.value ? `<span class="bv-row__trail bv-num">${esc(moneyWhole(s.value))}</span>` : ''}</a>`).join('')}</div>`;
    } catch { /* non-fatal — the section just stays empty */ }
  })();
}

function mountBlindSentinel() {
  const grid = $("#miniGrid");
  const sentinel = $("#blindSentinel");
  if (!grid || !sentinel) return;
  if (state._blindObserver) state._blindObserver.disconnect();
  sentinel.hidden = !state.blind.hasMore;
  if (!state.blind.hasMore) return;
  state._blindObserver = new IntersectionObserver(async (entries) => {
    if (!entries[0].isIntersecting || state.blind.loading) return;
    const fresh = await loadBlind();
    if (fresh.length) {
      grid.insertAdjacentHTML("beforeend", fresh.map(f => miniCardHTML(f)).join(""));
      wireMiniCards();
    }
    sentinel.hidden = !state.blind.hasMore;
    if (!state.blind.hasMore) state._blindObserver.disconnect();
  }, { rootMargin: "400px" });
  state._blindObserver.observe(sentinel);
}

function isFigFilterDefault() {
  const f = state.filter;
  if (ownedMode()) return !f.figOwnedQ && (!f.figOwnedSeries || f.figOwnedSeries === 'all') && (!f.figOwnedRarity || f.figOwnedRarity === 'all');
  return !f.figQ && f.figRarity === 'all' && f.figOwned === 'all' && (!f.figSeries || f.figSeries === 'all');
}

function miniCardHTML(f) {
  const owned = state.ownedFigs.has(f.fig_num);
  const realVal = f.current_value ?? null;
  const n = f.appears_in_sets ?? null;
  // Honest footer: a real market price when we have one, otherwise a true fact
  // (set-exclusivity / debut year) — never a fabricated rarity-constant price.
  const scarcityLabel = (n != null && n > 0)
    ? (n === 1 ? t('minifigs.setExclusive') : tPlural('minifigs.inSets', n))
    : (f.year ? String(f.year) : '');
  const hasValue = realVal != null && realVal > 0;
  const valueHtml = hasValue ? null : (scarcityLabel ? `<span class="bv-tile__meta vault-fig__fact">${esc(scarcityLabel)}</span>` : '');
  const series = currentSeries() !== 'all' && !ownedMode() ? seriesShort(f.series || '').replace(/^CMF\s+/, '') : seriesShort(f.series || t('bvVault.figMinifig'));
  const rar = String(f.rarity || '').toLowerCase();
  const label = [f.name, (rar === 'rare' || rar === 'legendary') ? rarityLabel(rar) : '', hasValue ? moneyWhole(realVal) : scarcityLabel, owned && !ownedMode() ? t('bvVault.figInVault') : ''].filter(Boolean).join(', ');
  const action = ownedMode() ? '' : tileAction({ owned, label: owned ? t('bvVault.figEditOwned', { name: f.name }) : t('bvVault.figAddOne', { name: f.name }), attrs: { 'data-fig-add': '1', 'aria-pressed': null } });
  return vaultFigTile(f, { meta: series, value: hasValue ? realVal : null, valueHtml, qty: Number(f.owned_qty) || 0, actionHtml: action, label });
}

window.addEventListener('bv:owner-changed', () => { _seriesProgress = null; figSearchOpen = false; });
window.addEventListener('hashchange', () => { if (!onFigs()) figSearchOpen = false; });
