import { $, $$, haptic, escapeHtml, fmtMoney, toast, themeHue, debounce, bvIDB, SEARCH_DEBOUNCE_MS, mount } from '../utils.js';
import { state } from '../state.js';
import { api, getSessionUserId } from '../api.js';
import { I } from '../icons.js';
import { showSheet, hideSheet } from '../components/sheet.js';
import { skelPage, skelCardList } from '../components/skeleton.js';

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
  const top = _seriesList.slice(0, 6);
  const sel = f.figSeries && f.figSeries !== 'all' ? f.figSeries : null;
  const inTop = top.some(s => s.series === sel);
  return `<button class="chip ${!sel ? 'active' : ''}" data-fig-series="all">All series</button>` +
    (sel && !inTop ? `<button class="chip active" data-fig-series="${escapeHtml(sel)}">${escapeHtml(sel)}</button>` : '') +
    top.map(s => `<button class="chip ${sel === s.series ? 'active' : ''}" data-fig-series="${escapeHtml(s.series)}">${escapeHtml(s.series)}</button>`).join('') +
    (_seriesList.length > 6 ? `<button class="chip" id="moreSeriesChip">${I.filter()}<span>More…</span></button>` : '');
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
          <div class="topbar-eyebrow" id="blindCount">${ownedCount}/${b.total.toLocaleString()} collected</div>
          <h1 class="topbar-title">Minifigs</h1>
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

      <div id="rareFindsSection"></div>

      <div class="fig-filter-bar">
        <div class="search-wrap open" style="margin-bottom:10px;">
          <span class="s-icon">${I.search()}</span>
          <input class="search-input" id="figSearch" placeholder="Search minifigs…" autocomplete="off" value="${escapeHtml(f.figQ)}">
        </div>
        <div class="filter-row">
          <button class="chip ${f.figRarity === 'all' ? 'active' : ''}" data-fig-rarity="all">All</button>
          ${rarities.map(r => `<button class="chip ${f.figRarity === r ? 'active' : ''} rarity-chip-${r}" data-fig-rarity="${r}">${r.charAt(0).toUpperCase() + r.slice(1)}</button>`).join('')}
          <button class="chip fig-owned-chip ${f.figOwned !== 'all' ? 'active' : ''}" id="figOwnedChip">${ownedChipLabel}</button>
        </div>
        <div class="filter-row" id="figSeriesChips" style="margin-top:-2px;margin-bottom:4px;">
          ${seriesChipsHTML(f)}
        </div>
        <div class="filter-row" style="margin-top:2px;gap:6px;">
          <span style="font-size:11px;color:var(--ink-mute);display:inline-flex;align-items:center;margin-right:2px;font-family:var(--mono);font-weight:600;">SORT:</span>
          ${FIG_SORTS.map(o => `<button class="chip ${(f.figSort === o.asc || f.figSort === o.desc) ? 'active' : ''}" data-fig-sort-base="${o.base}">${figSortChipText(o, f.figSort)}</button>`).join('')}
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

  // Series filter: top series as quick chips, the rest behind a "More…" picker.
  // The facet list loads async; re-render the chip row once it arrives.
  wireSeriesChips();
  loadSeriesList().then(() => { if (location.hash === '#/minifigs') refreshSeriesChips(); });


  wireMiniCards();
  mountBlindSentinel();
  loadRareFinds();
}

// "Rare finds in your collection" — surfaces the signed-in user's owned
// rare/legendary figs as a tappable highlight row above the catalog. Empty for
// guests / collections with none, so it self-hides. Loaded lazily (non-blocking).
async function loadRareFinds() {
  let figs = [];
  try { const r = await api('/api/minifigs/rare-finds'); figs = (r && r.figs) || []; } catch { return; }
  const el = $('#rareFindsSection');
  if (!el || !figs.length) return;
  el.innerHTML = `
    <h2 class="section-title" style="margin-top:0;">Rare finds in your collection</h2>
    <div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:6px;margin-bottom:14px;-webkit-overflow-scrolling:touch;">
      ${figs.map((f) => {
        const r = f.rarity || 'rare';
        return `<button class="rare-find-card" data-fig="${escapeHtml(String(f.fig_num))}" style="flex:0 0 auto;width:120px;background:var(--surface-2);border:1px solid var(--line-soft);border-radius:var(--r-2);padding:10px;text-align:center;cursor:pointer;">
          <div style="height:72px;display:flex;align-items:center;justify-content:center;margin-bottom:6px;">
            ${f.image_url ? `<img src="${escapeHtml(String(f.image_url))}" alt="" loading="lazy" style="max-width:100%;max-height:72px;object-fit:contain;">` : `<div style="width:48px;height:64px;background:var(--surface-3);border-radius:6px;"></div>`}
          </div>
          <div style="font-size:11px;font-weight:600;color:var(--ink);line-height:1.25;height:28px;overflow:hidden;">${escapeHtml(String(f.name || ''))}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;gap:4px;">
            <span class="mini-rarity-tag rarity-${r}" style="font-size:8px;padding:1px 5px;">${escapeHtml(r)}</span>
            ${f.current_value ? `<span style="font-size:12px;font-weight:700;color:var(--ink);">${fmtMoney(f.current_value, { cents: 0 })}</span>` : ''}
          </div>
        </button>`;
      }).join('')}
    </div>`;
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
  mount(grid, state.blind.items.map(f => miniCardHTML(f)).join(''));
  wireMiniCards();
  mountBlindSentinel();
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
  const totalEl = countEl?.nextElementSibling;
  if (totalEl) totalEl.textContent = `of ${state.blind.total.toLocaleString()} figs`;
  if (valueEl) {
    const total = ownedItems.reduce((s, f) => s + (f.value ?? f.current_value ?? 0), 0);
    valueEl.textContent = fmtMoney(total, { cents: 0 });
  }
}

function refreshMiniStats() {
  updateBlindCount();
  updateFigStats();
}

function showFigDetail(f) {
  const owned = state.ownedFigs.has(f.fig_num);
  const realVal = f.current_value ?? null;
  const rarity = f.rarity || 'common';
  const n = f.appears_in_sets ?? null;
  const scarcityTxt = (n != null && n > 0)
    ? (n === 1 ? 'Set-exclusive' : `Appears in ${n} sets`)
    : null;
  const hue = f.hue ?? themeHue(f.series || f.fig_num);
  const hasImg = f.image_url;
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
        ${realVal != null && realVal > 0 ? `
        <div class="fig-detail-value">
          <span class="fig-detail-value-lbl">Est. resale value</span>
          <span class="fig-detail-value-num">${fmtMoney(realVal, { cents: 0 })}</span>
        </div>` : ''}
        ${(scarcityTxt || f.year || f.num_parts) ? `
        <div class="fig-detail-facts" style="display:flex;gap:14px;flex-wrap:wrap;margin:4px 0 12px;font-size:12.5px;color:var(--ink-mute);">
          ${scarcityTxt ? `<span>${scarcityTxt}</span>` : ''}
          ${f.year ? `<span>First seen ${f.year}</span>` : ''}
          ${f.num_parts ? `<span>${f.num_parts} part${f.num_parts > 1 ? 's' : ''}</span>` : ''}
          <span style="text-transform:capitalize;">${escapeHtml(rarity)} rarity</span>
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

  // Lazily load the sets this minifig appears in — a navigable hub from the fig
  // to each set's detail. (Hidden if the fig isn't mapped to any catalog sets.)
  (async () => {
    try {
      const r = await api('/api/minifigs/' + encodeURIComponent(f.fig_num) + '/sets');
      const sets = (r && r.sets) || [];
      const el = $('#figSetsSection');
      if (!el || !sets.length) return;
      el.innerHTML = `
        <div class="fig-detail-series" style="margin-bottom:8px;">Appears in ${sets.length} set${sets.length > 1 ? 's' : ''}</div>
        <div class="u-col" style="gap:8px;">
          ${sets.map((s) => `
            <button class="fig-set-row" data-set="${escapeHtml(String(s.set_num))}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:var(--surface-2);border:1px solid var(--line-soft);border-radius:var(--r-2);padding:8px 10px;cursor:pointer;">
              ${s.image_url ? `<img src="${escapeHtml(String(s.image_url))}" alt="" loading="lazy" style="width:40px;height:40px;object-fit:contain;background:var(--surface-3);border-radius:6px;flex:0 0 auto;">` : `<div style="width:40px;height:40px;background:var(--surface-3);border-radius:6px;flex:0 0 auto;"></div>`}
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
  const hue = f.hue ?? themeHue(f.series || f.fig_num);
  const hasImg = f.image_url;
  const realVal = f.current_value ?? null;
  const rarity = f.rarity || "common";
  const n = f.appears_in_sets ?? null;
  // Honest footer: a real market price when we have one, otherwise a true fact
  // (set-exclusivity / debut year) — never a fabricated rarity-constant price.
  const scarcityLabel = (n != null && n > 0)
    ? (n === 1 ? 'Set-exclusive' : `In ${n} sets`)
    : (f.year ? String(f.year) : '');
  const valHTML = realVal != null && realVal > 0
    ? `<div class="mini-value">${fmtMoney(realVal, { cents: 0 })}</div>`
    : (scarcityLabel ? `<div class="mini-value mini-value-est">${scarcityLabel}</div>` : '');
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
          ${valHTML}
          ${owned ? `<span class="mini-owned-badge">${I.check()}</span>` : ''}
        </div>
      </div>
    </button>`;
}
