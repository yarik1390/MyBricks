import { discoverNavigation } from '../components/collector-shell.js';
import { $, $$, haptic, escapeHtml, setHue, bvIDB, SEARCH_DEBOUNCE_MS, mount, toast, thumbImg, snackbar } from '../utils.js';
import { icon as kitIcon, iconBtn as kitIconBtn, row as kitRow, sectionTitle as kitSectionTitle, thumb as kitThumb, pill as kitPill, topbar as kitTopbar, searchBar as kitSearchBar, sheetBody as kitSheetBody, emptyState as kitEmptyState, field as kitField } from '../ui/kit.js';
import { setRow as kitSetRow, money0 } from '../ui/set-ui.js';
import { t, tPlural, kidsXpMessage, kidsBadgeLabel } from '../lib/i18n.js';
import { state, invalidatePortfolio } from '../state.js';
import { api, getSessionUserId, photoScanNeedsSetup, outboxEnqueue } from '../api.js';
import { getModePref } from '../theme.js';
import { showSheet, hideSheet } from '../components/sheet.js';
import { openScan, lookupScanInput } from '../components/scanner-lazy.js';
import { trustBadgeHTML } from '../components/trust.js';
import { activeCatalogFilterCount, pricePerPiece, estMark, displayValueOf, cleanFacetList } from '../lib/pure.js';
import { catalogFilterSummaryText } from '../lib/filter-summary.js';
import { skelPage, skelCardList } from '../components/skeleton.js';

let _catalogGen = 0;

// URL filter persistence: read/write filter state from/to the hash query string
// so catalog filters survive a page refresh and can be deep-linked.
function readCatalogURLParams() {
  const raw = location.hash.split('?')[1] || '';
  if (!raw) return;
  const p = new URLSearchParams(raw);
  const f = state.filter;
  if (p.has('q')) f.catalogQ = p.get('q');
  if (p.has('theme')) f.catalogTheme = p.get('theme');
  if (p.has('sort')) f.catalogSort = p.get('sort');
  if (p.has('retired')) f.catalogRetired = p.get('retired');
  if (p.has('deal')) f.catalogDeal = p.get('deal') === '1';
  if (p.has('theme_group')) f.catalogThemeGroup = p.get('theme_group');
  if (p.has('category')) f.catalogCategory = p.get('category');
  const ranges = f.catalogRanges;
  for (const k of Object.keys(ranges)) {
    if (p.has(k)) ranges[k] = p.get(k);
  }
}

function syncCatalogURL() {
  const f = state.filter;
  const p = new URLSearchParams();
  if (f.catalogQ) p.set('q', f.catalogQ);
  if (f.catalogTheme && f.catalogTheme !== 'all') p.set('theme', f.catalogTheme);
  if (f.catalogSort && f.catalogSort !== 'year_desc') p.set('sort', f.catalogSort);
  if (f.catalogRetired && f.catalogRetired !== 'all') p.set('retired', f.catalogRetired);
  if (f.catalogDeal) p.set('deal', '1');
  if (f.catalogThemeGroup && f.catalogThemeGroup !== 'all') p.set('theme_group', f.catalogThemeGroup);
  if (f.catalogCategory && f.catalogCategory !== 'all') p.set('category', f.catalogCategory);
  for (const [k, v] of Object.entries(f.catalogRanges)) {
    if (v !== '' && v != null) p.set(k, String(v));
  }
  const qs = p.toString();
  const target = '#/add' + (qs ? '?' + qs : '');
  if (location.hash !== target) history.replaceState(null, '', target);
}

// Bi-directional catalog sort options. Each click toggles between the two
// directions; switching to a new sort uses its default direction. The backend
// SORTS map accepts all eight keys.
const CATALOG_SORTS = [
  { base: "value",    tKey: "catalog.sortValue",    asc: "value_asc", desc: "value_desc", def: "value_desc", label: "Value" },
  { base: "roi",      tKey: "catalog.sortGrowth",   asc: "roi_asc",   desc: "roi_desc",   def: "roi_desc",   label: "Growth" },
  { base: "year",     tKey: "catalog.sortNewest",   asc: "year_asc",  desc: "year_desc",  def: "year_desc",  label: "Newest" },
  { base: "name",     asc: "az",        desc: "za",          def: "az",          label: "A–Z" },
  { base: "trending", tKey: "catalog.sortTrending", asc: "trending", desc: "trending",  def: "trending",   label: "Trending" },
];
const catalogSortChipText = (o, cur) => {
  const active = cur === o.asc || cur === o.desc;
  const label = o.tKey ? t(o.tKey) : o.label;
  return label + (active ? (cur === o.asc ? " ↑" : " ↓") : "");
};
const activeCatalogSortLabel = (cur) => {
  const option = CATALOG_SORTS.find(o => cur === o.asc || cur === o.desc) || CATALOG_SORTS[0];
  return catalogSortChipText(option, cur);
};

export async function renderAdd() {
  readCatalogURLParams();
  if (!state.catalog.items.length) $("#root").innerHTML = skelPage(skelCardList(6));
  if (!state.themes.length) {
    try {
      const t = await api("/api/themes");
      // Strip junk placeholders (":null", "N/A", "{t.b.a.}", …) from all facets.
      // Themes keep their popularity order (the quick-chip row shows the top 8);
      // the filter facets are sorted A→Z for scannability.
      state.themes = cleanFacetList(t.themes || []);
      state.themeGroups = cleanFacetList(t.theme_groups || [], { sort: true });
      state.categories = cleanFacetList(t.categories || [], { sort: true });
      state.themesLoadedAt = Date.now();
    } catch {}
  }
  // Coming-soon feed (G2b) — load in the background and surface it on the default
  // catalog view once ready (non-blocking; never delays the catalog paint).
  if (!state.catalog.upcomingLoaded) {
    api("/api/upcoming").then((r) => {
      state.catalog.upcoming = r.upcoming || [];
      state.catalog.upcomingLoaded = true;
      if (location.hash.startsWith("#/add") && $("#catalogResults") && isCatalogDefault()) refreshCatalogGrid();
    }).catch(() => { state.catalog.upcomingLoaded = true; });
  }
  if (!state.catalog.items.length) {
    await loadCatalog({ reset: true });
    if (isCatalogDefault()) bvIDB.set('catalog', { data: { items: state.catalog.items, total: state.catalog.total, hasMore: state.catalog.hasMore, offset: state.catalog.offset }, ts: Date.now(), userId: getSessionUserId() }).catch(() => {});
  } else if (state.catalog._stale) {
    state.catalog._stale = false;
    loadCatalog({ reset: true }).then(() => {
      if (location.hash.startsWith('#/add') && $('#catalogResults')) {
        refreshCatalogGrid();
        if (isCatalogDefault()) bvIDB.set('catalog', { data: { items: state.catalog.items, total: state.catalog.total, hasMore: state.catalog.hasMore, offset: state.catalog.offset }, ts: Date.now(), userId: getSessionUserId() }).catch(() => {});
      }
    }).catch(() => {});
  }
  // Flag owned sets (any mode). Seed synchronously from what we already have so
  // the first paint is usually correct, then backfill from the full collection
  // and refresh once if that revealed more.
  seedOwnedFromPortfolio();
  paintAdd();
  if (!state.ownedSetNumsLoaded) {
    const before = state.ownedSetNums.size;
    ensureOwnedSetNums().then(() => {
      if (state.ownedSetNums.size !== before && location.hash.startsWith("#/add") && $("#catalogResults")) refreshCatalogGrid();
    });
  }
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
    c._seed = false;
    return fresh;
  } catch (e) {
    if (myGen !== _catalogGen) return [];
    // Offline / API unreachable: fall back to the bundled seed catalog so a
    // fresh install with no network can still browse and search the top sets.
    try {
      const { searchSeedCatalog } = await import("../lib/seed-catalog.js");
      const params = Object.fromEntries(new URLSearchParams(catalogQuery()));
      const seed = await searchSeedCatalog(params);
      if (myGen === _catalogGen && seed && (seed.sets.length || reset)) {
        const fresh = seed.sets;
        c.items = reset ? fresh : c.items.concat(fresh);
        c.total = seed.total;
        c.offset = c.items.length;
        c.hasMore = seed.hasMore;
        c._seed = true;
        return fresh;
      }
    } catch { /* seed unavailable (web deploy without snapshot) — show the error */ }
    if (myGen !== _catalogGen) return [];
    const results = $("#catalogResults");
    if (results) {
      results.innerHTML = `<div class="empty card" style="margin-top:16px;">
        <h3>Couldn't load catalog</h3>
        <p>${t('catalog.loadFailedDetail', { error: escapeHtml(e.message) })}</p>
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
  return !f.catalogQ && f.catalogTheme === 'all' && (f.catalogThemeGroup || 'all') === 'all' && (f.catalogCategory || 'all') === 'all' && f.catalogYear === 'all' && (f.catalogRetired === 'all' || !f.catalogRetired) && !f.catalogDeal &&
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
  if (f.catalogThemeGroup && f.catalogThemeGroup !== "all") p.set("theme_group", f.catalogThemeGroup);
  if (f.catalogCategory && f.catalogCategory !== "all") p.set("category", f.catalogCategory);
  if (f.catalogRetired === "retired" || f.catalogRetired === true) p.set("retired", "1");
  else if (f.catalogRetired === "active") p.set("retired", "0");
  else if (f.catalogRetired === "retiring") p.set("retiring", "1");
  if (f.catalogDeal) p.set("deal", "1");
  for (const [k, v] of Object.entries(f.catalogRanges)) {
    if (v !== "" && v != null) p.set(k, v);
  }
  return p.toString();
}

// "Retiring soon" preview for the default Discover view (LEGO.com stock data).
async function loadRetiringPreview() {
  if (state.catalog.retiringPreviewLoaded) return;
  try {
    const r = await api("/api/sets/search?retiring=1&sort=value_desc&limit=3");
    state.catalog.retiringPreview = r.sets || [];
  } catch { state.catalog.retiringPreview = []; }
  state.catalog.retiringPreviewLoaded = true;
}

function wishFor(setNum) { return (state.wishlist || []).find((w) => w.set_num === setNum); }

// Buy-window pill for a retiring set: on your wishlist → Buy window; owned →
// Hold; a live buy signal → Buy window; else nothing (no fabricated advice).
function retiringPill(s) {
  if (isOwnedSet(s)) return kitPill(t("bvAdd.pillHold"));
  if (wishFor(s.set_num) || s.deal_signal === "buy") return kitPill(t("bvAdd.pillBuyWindow"), "acc");
  return "";
}

function retiringMeta(s) {
  const bits = [s.theme];
  if (isOwnedSet(s)) bits.push(t("bvAdd.youOwn"));
  else if (wishFor(s.set_num)) bits.push(t("bvAdd.onYourWishlist"));
  return bits.filter(Boolean).join(" · ");
}

function retiringSectionHTML() {
  const list = state.catalog.retiringPreview || [];
  if (!isCatalogDefault() || !list.length) return "";
  return `<section class="bv-discover__section" aria-labelledby="retiringTitle">
      ${kitSectionTitle(t("bvAdd.retiringSoon"), { id: "retiringTitle", trailHtml: `<a class="bv-card__link" href="#/retiring">${escapeHtml(t("common.seeAll"))}${kitIcon("chev", { size: 16 })}</a>` })}
      <div class="bv-group__box">${list.slice(0, 3).map((s) => setRowHTML(s, {
        meta: retiringMeta(s),
        endHtml: `<span class="bv-setrow__end"><span class="bv-setrow__value">${escapeHtml(money0(displayValueOf(s)))}</span>${retiringPill(s)}</span>`,
      })).join("")}</div>
    </section>`;
}

// "Coming soon" (upcoming LEGO releases): rows with Notify me (= wishlist).
function comingSoonSectionHTML() {
  const up = state.catalog.upcoming || [];
  if (!isCatalogDefault() || !up.length) return "";
  const isLoggedIn = !!getSessionUserId();
  const wish = new Set((state.wishlist || []).map((w) => w.set_num));
  const row = (u) => {
    const on = wish.has(u.set_num);
    return `<div class="bv-setrow cs-card" data-cs-open="${escapeHtml(String(u.set_num))}" role="link" tabindex="0">
        ${kitThumb({ color: `hsl(${setHue(u)} 45% 60%)`, size: 52 })}
        <span class="bv-setrow__body"><span class="bv-setrow__name">${escapeHtml(String(u.name || u.set_num))}</span><span class="bv-setrow__meta">${escapeHtml([String(u.set_num || "").replace(/-\d+$/, ""), u.availability || t("bvCommon.comingSoon")].join(" · "))}</span></span>
        <span class="bv-setrow__end">${u.price_usd ? `<span class="bv-setrow__value">${escapeHtml(money0(u.price_usd))}</span>` : ""}
          ${isLoggedIn ? `<button type="button" class="bv-pill bv-pill--info bv-notify cs-wish-btn${on ? " cs-wish-btn--on" : ""}" data-cs-wish="${escapeHtml(String(u.set_num))}" data-cs-name="${escapeHtml(String(u.name || ""))}" aria-pressed="${on}">${escapeHtml(t(on ? "bvAdd.notifying" : "bvAdd.notifyMe"))}</button>` : ""}</span>
      </div>`;
  };
  return `<section class="bv-discover__section coming-soon-wrap" aria-labelledby="comingSoonTitle">
      ${kitSectionTitle(t("catalog.comingSoon"), { id: "comingSoonTitle", trailHtml: up.length > 3 ? `<button type="button" class="bv-card__link bv-linkbtn" id="comingSoonAll">${escapeHtml(t("common.seeAll"))}${kitIcon("chev", { size: 16 })}</button>` : "" })}
      <div class="bv-group__box" id="comingSoonList">${up.slice(0, state.catalog.showAllUpcoming ? 40 : 3).map(row).join("")}</div>
    </section>`;
}

function themeBrowseHTML() {
  if (!isCatalogDefault() || !state.themes.length) return "";
  return `<section class="bv-discover__section" aria-labelledby="browseThemesTitle">
      ${kitSectionTitle(t("bvAdd.browseThemes"), { id: "browseThemesTitle" })}
      <div class="bv-chips bv-chips--wrap bv-discover__themes">${popularThemes(state.themes, 8).map((th) => `<button type="button" class="bv-chip" data-cat-theme="${escapeHtml(th)}">${escapeHtml(th)}</button>`).join("")}
        ${state.themes.length > 8 ? `<button type="button" class="bv-chip" id="moreThemesChip">${kitIcon("filter", { size: 18 })}<span>${escapeHtml(t("bvAdd.moreThemes"))}</span></button>` : ""}</div>
    </section>`;
}

function toolbarHTML() {
  const f = state.filter;
  const n = activeCatalogFilterCount(f);
  const retiredOn = f.catalogRetired === "retired";
  return `<div class="bv-discover__toolbar catalog-primary-toolbar" aria-label="${escapeHtml(t("bvAdd.catalogControls"))}">
      <div class="bv-chips bv-discover__chips">
        <button type="button" class="bv-chip${n ? " is-on" : ""}" id="filterChip" aria-pressed="${n > 0}">${kitIcon("filter", { size: 18 })}<span>${escapeHtml(n ? tPlural('catalog.filtersWithCount', n) : t('catalog.filters'))}</span></button>
        <button type="button" class="bv-chip" id="catalogSortBtn" aria-label="${escapeHtml(t("bvAdd.sortBy", { sort: activeCatalogSortLabel(f.catalogSort) }))}">${kitIcon("sort", { size: 18 })}<span>${escapeHtml(activeCatalogSortLabel(f.catalogSort))}</span>${kitIcon("down", { size: 16 })}</button>
        <button type="button" class="bv-chip" id="retiredQuick" aria-pressed="${retiredOn}">${escapeHtml(t("bvCommon.retired"))}</button>
      </div>
      <button type="button" class="bv-iconbtn" id="catalogLayoutToggle" aria-label="${escapeHtml(state.compactView ? "View as grid" : "View as list")}" aria-pressed="${state.compactView}">${kitIcon(state.compactView ? "grid" : "list")}</button>
    </div>`;
}

function catalogResultsHTML() {
  const c = state.catalog;
  const f = state.filter;
  const def = isCatalogDefault();
  return `
    ${retiringSectionHTML()}
    ${comingSoonSectionHTML()}
    ${themeBrowseHTML()}
    ${def ? kitSectionTitle(t("bvAdd.allSets"), { id: "allSetsTitle" }) : ""}
    ${toolbarHTML()}
    <p id="catalogCount" class="bv-discover__count result-count">${escapeHtml(tPlural('counts.results', c.total))}${c._seed ? ` · ${escapeHtml(t("bvAdd.offlineCatalog"))}` : ""}</p>
    ${c.items.length === 0 ? kitEmptyState({
      icon: "search",
      title: t("bvAdd.noSets"),
      body: f.catalogQ ? t('catalog.emptySearchResults', { query: f.catalogQ }) : t('catalog.emptyFilteredResults'),
      actionsHtml: !def ? `<button type="button" class="bv-btn bv-btn--outline bv-btn--full" id="catalogClearFilters">${escapeHtml(t("bvAdd.clearFilters"))}</button>` : "",
    }) : `
      <div class="${state.compactView ? "bv-group__box bv-discover__list" : "bv-grid bv-discover__grid"}" id="catalogGrid">
        ${c.items.map((s) => catalogCardHTML(s)).join("")}
      </div>
      <div id="catalogSentinel" class="load-sentinel" style="${c.hasMore ? "" : "display:none;"}">
        <div class="spinner"></div>
      </div>`}`;
}

function refreshCatalogSummary() {
  // The toolbar (Filters · N chip, sort label, Retired quick chip) is part of
  // the results region, so a grid refresh repaints it; keep the live-region
  // summary for screen readers.
  const el = $("#catalogFilterSummary");
  if (el) el.textContent = catalogFilterSummaryText(state.filter, t, tPlural);
}

function tileTagHTML(s) {
  if (s.retired) return kitPill(t("bvCommon.retired"), "ink");
  if (s.lego_retiring_soon || (s.retirement_risk_score || 0) >= 70) return kitPill(t("bvAdd.retiring"), "ink");
  if (s.deal_signal === "buy") return kitPill(s.deal_strong ? t('card.strongBuy', { pct: "" }).trim() : t('card.deal', { pct: "" }).trim(), "gain");
  return "";
}

function catalogCardHTML(s) {
  const owned = isOwnedSet(s);
  const value = displayValueOf(s);
  if (state.compactView) {
    const meta = [s.theme, s.set_num, s.year].filter(Boolean).join(" · ");
    return setRowHTML(s, {
      meta,
      cls: `set-list-card compact${owned ? " is-owned" : ""}`,
      attrs: { "data-set": s.set_num },
      endHtml: `<span class="bv-setrow__end"><span class="bv-setrow__value">${escapeHtml(estMark(s))}${escapeHtml(money0(value))}</span>${owned ? kitPill(t("bvAdd.owned"), "gain", { icon: "check" }) : (dealTagHTML(s) || pppBadgeHTML(s) || sourceCueHTML(s) || `<span class="bv-setrow__hint">${escapeHtml(tPlural('card.pieces', s.pieces || 0))}</span>`)}</span>`,
    });
  }
  const meta = [s.set_num, s.year].filter(Boolean).join(" · ");
  const valueLine = `${estMark(s)}${money0(value)}`;
  return `<div class="bv-tile${owned ? " is-owned" : ""}" data-set="${escapeHtml(s.set_num)}" data-set-num="${escapeHtml(s.set_num)}">
      <a class="bv-tile__link" href="#/set/${encodeURIComponent(s.set_num)}" aria-label="${escapeHtml(s.name || s.set_num)}"></a>
      <span class="bv-tile__media">${setImgTileHTML(s)}${tileTagHTML(s) ? `<span class="bv-tile__tag">${tileTagHTML(s)}</span>` : ""}</span>
      <span class="bv-tile__body"><span class="bv-tile__name">${escapeHtml(s.name || s.set_num)}</span><span class="bv-tile__meta">${escapeHtml(meta)}</span>
        <span class="bv-tile__foot"><span class="bv-tile__value">${escapeHtml(valueLine)}</span>${owned ? kitPill(t("bvAdd.owned"), "gain", { icon: "check" }) : ""}</span></span>
      ${owned ? "" : `<button type="button" class="bv-tile__act" data-add-set="${escapeHtml(s.set_num)}" aria-label="${escapeHtml(t("bvAdd.addNamed", { name: s.name || s.set_num }))}">${kitIcon("plus", { size: 18, stroke: 2.6 })}</button>`}
    </div>`;
}

function setImgTileHTML(s) {
  const color = `hsl(${setHue(s)} 52% 56%)`;
  const brick = `<svg class="bv-brick" viewBox="0 0 40 32" aria-hidden="true" style="width:56%;height:44%"><rect x="7" y="0" width="9" height="7" rx="2" fill="${color}"/><rect x="24" y="0" width="9" height="7" rx="2" fill="${color}"/><rect x="0" y="5" width="40" height="27" rx="4" fill="${color}"/></svg>`;
  const hasImg = s.image_url && !String(s.image_url).startsWith("data:");
  return brick + (hasImg ? `<img class="set-photo" src="${escapeHtml(thumbImg(s.image_url))}" alt="" loading="lazy" decoding="async">` : "");
}

function setRowHTML(s, opts) {
  return kitSetRow(s, opts);
}

// Add from a tile: optimistic owned state, then a snackbar with Add price and
// Undo — never leave the list.
async function quickAddFromTile(setNum, btn) {
  const s = (state.catalog.items || []).find((x) => x.set_num === setNum) || { set_num: setNum, name: setNum };
  if (state.pendingRequests.has(setNum)) return;
  state.pendingRequests.add(setNum);
  haptic("medium");
  // Re-query each time: the first repaint replaces the tile element, so a held
  // reference would be detached by the time Undo runs.
  const markOwned = (on) => {
    if (on) state.ownedSetNums.add(setNum); else state.ownedSetNums.delete(setNum);
    const tile = btn.isConnected ? btn.closest(".bv-tile") : document.querySelector(`#catalogGrid .bv-tile[data-set="${CSS.escape(setNum)}"]`);
    if (tile) tile.outerHTML = catalogCardHTML(s);
  };
  markOwned(true);
  try {
    const res = await api("/api/collection", { method: "POST", body: { set_num: setNum, quantity: 1 } });
    invalidatePortfolio();
    const id = res?.item?.id;
    snackbar(t("bvAdd.addedName", { name: s.name || setNum }), {
      type: "success",
      duration: 6000,
      actions: [
        { label: t("bvAdd.addPrice"), onClick: () => { location.hash = `#/set/${encodeURIComponent(setNum)}/edit`; } },
        ...(id != null ? [{ label: t("common.undo"), kind: "undo", onClick: async () => {
          try {
            await api(`/api/collection/${encodeURIComponent(id)}`, { method: "DELETE" });
            invalidatePortfolio();
            markOwned(false);
          } catch { toast(t("common.actionFailed"), "error"); }
        } }] : []),
      ],
    });
  } catch (err) {
    if (!navigator.onLine) {
      outboxEnqueue({ path: "/api/collection", method: "POST", body: { set_num: setNum, quantity: 1 } });
      toast(t("bvAdd.savedOffline"), "info");
    } else {
      markOwned(false);
      toast(t("common.errorWithDetails", { error: err.message || err }), "error");
    }
  } finally { state.pendingRequests.delete(setNum); }
}


function refreshCatalogGrid() {
  const results = $("#catalogResults");
  if (!results) return;
  mount(results, catalogResultsHTML());
  refreshCatalogSummary();
  wireCatalogCards();
  mountCatalogSentinel();
  syncCatalogURL();
}



// Seed the owned-set from whatever collection data we already have, then (once
// per session) fetch the full list so the catalog can flag owned sets.
function seedOwnedFromPortfolio() {
  const items = state.portfolio?.items;
  if (Array.isArray(items)) for (const i of items) state.ownedSetNums.add(i.set_num);
}
async function ensureOwnedSetNums() {
  seedOwnedFromPortfolio();
  if (state.ownedSetNumsLoaded) return;
  try {
    const r = await api("/api/collection");
    // The collection response is authoritative. Replacing (rather than only
    // adding to) this Set removes stale OWNED markers after a delete performed
    // from another view/device or while the catalog was cached on Android.
    state.ownedSetNums.clear();
    for (const i of (r?.items || [])) state.ownedSetNums.add(i.set_num);
    state.ownedSetNumsLoaded = true;
  } catch { /* non-fatal: owned badges just won't show until next load */ }
}


// Kid-friendly confirm-before-add sheet. Already-owned sets show a "you have
// this" state instead of adding again.
function openKidsAddSheet(setNum, card) {
  const s = (state.catalog.items || []).find(x => x.set_num === setNum) || { set_num: setNum, name: setNum };
  const already = state.ownedSetNums.has(setNum) || s.owned;
  const hasImg = s.image_url && !s.image_url.startsWith("data:");
  const imgHTML = hasImg
    ? `<img src="${escapeHtml(thumbImg(s.image_url))}" alt="" style="width:96px;height:96px;object-fit:contain;margin:0 auto 12px;display:block;">`
    : "";
  if (already) {
    showSheet(`
      <div style="text-align:center;padding:4px 0 8px;">
        ${imgHTML}
        <div style="font-weight:800;font-size:18px;margin-bottom:6px;">${escapeHtml(s.name || setNum)}</div>
        <div style="font-size:15px;color:var(--up);font-weight:700;margin-bottom:16px;">✓ Already in your vault!</div>
        <button class="btn-secondary" id="kidsAddClose" style="width:100%;">OK</button>
      </div>`);
    $("#kidsAddClose")?.addEventListener("click", () => hideSheet());
    return;
  }
  showSheet(`
    <div style="text-align:center;padding:4px 0 8px;">
      ${imgHTML}
      <div style="font-weight:800;font-size:18px;margin-bottom:4px;">${escapeHtml(s.name || setNum)}</div>
      <div style="font-size:13px;color:var(--ink-mute);margin-bottom:18px;">Add this set to your vault?</div>
      <button class="btn-primary" id="kidsAddConfirm" style="width:100%;margin-bottom:8px;">🧱 Add to vault · +10 XP</button>
      <button class="btn-secondary" id="kidsAddCancel" style="width:100%;">Not now</button>
    </div>`);
  $("#kidsAddCancel")?.addEventListener("click", () => hideSheet());
  $("#kidsAddConfirm")?.addEventListener("click", async () => {
    haptic("medium");
    try {
      const result = await api("/api/collection", { method: "POST", body: { set_num: setNum, quantity: 1 } });
      invalidatePortfolio();
      state.ownedSetNums.add(setNum);
      markCardOwned(card);
      hideSheet();
      if (getModePref() === "kids" && result?.kids?.xp_gained > 0) {
        const { xp_gained, new_level, new_badges } = result.kids;
        const badge = new_badges?.[0] ? kidsBadgeLabel(new_badges[0]) : '';
        toast(kidsXpMessage(xp_gained, { level: new_level, badge }), "success");
        state.me = null;
      } else {
        toast("Added to your vault!", "success");
      }
    } catch (err) {
      toast(err.message || "Couldn't add that set", "error");
    }
  });
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
    <main class="bv-page has-fab bv-discover" id="discoverPage">
      ${kitTopbar({ title: t('collector.discover'), actionsHtml: kitIconBtn({ icon: "more", label: t("bvAdd.moreOptions"), id: "discoverMoreBtn" }) })}
      ${kitSearchBar({ id: "catalogSearch", name: "catalog_search", placeholder: t("bvAdd.searchPlaceholder"), label: t("bvAdd.searchLabel"), value: f.catalogQ, trailHtml: kitIconBtn({ icon: "scan", label: t("bvAdd.scanToSearch"), id: "catalogScanBtn" }) })}
      ${discoverNavigation()}
      <p class="bv-sr" id="catalogFilterSummary" aria-live="polite">${escapeHtml(catalogFilterSummaryText(f, t, tPlural))}</p>
      <div id="catalogResults" class="bv-discover__results">${catalogResultsHTML()}</div>
    </main>`;

  const catInput = $("#catalogSearch");
  let catalogSearchTimer = null;
  catInput?.addEventListener("input", (e) => {
    const q = e.target.value;
    clearTimeout(catalogSearchTimer);
    catalogSearchTimer = setTimeout(async () => {
      state.filter.catalogQ = q;
      $("#catalogResults")?.setAttribute("aria-busy", "true");
      try {
        await loadCatalog({ reset: true });
        refreshCatalogGrid();
      } catch (err) {
        console.error(err);
      } finally {
        $("#catalogResults")?.removeAttribute("aria-busy");
      }
    }, SEARCH_DEBOUNCE_MS);
  });
  $("#catalogScanBtn")?.addEventListener("click", () => { haptic("light"); openScan("barcode"); });
  $("#discoverMoreBtn")?.addEventListener("click", openDiscoverMore);

  wireCatalogCards();
  mountCatalogSentinel();
  if (!state.catalog.retiringPreviewLoaded) {
    loadRetiringPreview().then(() => { if (location.hash.startsWith("#/add") && $("#catalogResults") && isCatalogDefault()) refreshCatalogGrid(); });
  }
}

// ⋮ on Discover: everything that used to sit in the header and toolbar.
function openDiscoverMore() {
  showSheet(kitSheetBody({
    title: t("bvAdd.moreOptions"),
    inner: `<div class="bv-group__box">
      ${kitRow({ icon: "scan", title: t("bvAdd.scanASet"), sub: t("bvAdd.scanASetSub"), id: "dmScan" })}
      ${kitRow({ icon: "camera", title: t("bvAdd.identifyPhoto"), id: "dmPhoto" })}
      ${kitRow({ icon: "grid", title: t("bvAdd.shelfSnap"), sub: t("bvAdd.shelfSnapSub"), id: "dmShelf" })}
      ${kitRow({ icon: "clock", title: t("bvAdd.retiringSoon"), href: "#/retiring", id: "dmRetiring" })}
      ${kitRow({ icon: "trash", title: t("bvAdd.clearFilters"), id: "dmClear" })}
    </div>`,
  }));
  $("#dmScan")?.addEventListener("click", () => { hideSheet(); openScan("barcode"); });
  $("#dmPhoto")?.addEventListener("click", () => { hideSheet(); openScan("image"); });
  $("#dmShelf")?.addEventListener("click", () => { hideSheet(); openScan("image", { shelf: true }); });
  $("#dmRetiring")?.addEventListener("click", () => hideSheet());
  $("#dmClear")?.addEventListener("click", () => { hideSheet(); clearCatalogFilters(); });
}

const reloadGrid = async () => { await loadCatalog({ reset: true }); refreshCatalogGrid(); };

function openSortSheet() {
  const f = state.filter;
  showSheet(kitSheetBody({
    title: "Sort catalog",
    inner: `<div class="bv-group__box sheet-option-list" role="list">
      ${CATALOG_SORTS.map((o) => {
        const active = f.catalogSort === o.asc || f.catalogSort === o.desc;
        return `<button type="button" class="bv-row sheet-option${active ? " active" : ""}" data-csort-base="${o.base}" aria-pressed="${active}"><span class="bv-row__text"><span class="bv-row__title">${escapeHtml(o.tKey ? t(o.tKey) : o.label)}</span>${active ? `<span class="bv-row__sub">${f.catalogSort === o.asc ? "Ascending" : "Descending"}</span>` : ""}</span>${active ? kitIcon("check", { size: 20 }) : ""}</button>`;
      }).join("")}
    </div>`,
  }));
  $$("#sheet [data-csort-base]").forEach((b) => b.addEventListener("click", () => {
    const o = CATALOG_SORTS.find((s) => s.base === b.dataset.csortBase);
    if (!o) return;
    const cur = state.filter.catalogSort;
    state.filter.catalogSort = cur === o.desc ? o.asc : cur === o.asc ? o.desc : o.def;
    haptic("light");
    hideSheet();
    reloadGrid();
  }));
}

// Searchable picker for the full theme list.
// From the toolbar a pick applies at once. From the filter sheet, `onPick`
// hands the theme back so the sheet reopens with the user's other unapplied
// choices intact.
function openThemePicker({ current = state.filter.catalogTheme, onPick = null } = {}) {
  showSheet(kitSheetBody({
    title: t("bvAdd.pickTheme"),
    inner: `${kitSearchBar({ id: "themePickerInput", placeholder: t("bvAdd.searchThemes"), label: t("bvAdd.searchThemes") })}
      <div id="themePickerResults" class="bv-group__box bv-themepicker"></div>`,
  }));
  const results = $("#themePickerResults");
  const paintThemes = (q = "") => {
    const query = q.toLowerCase().trim();
    const matches = state.themes
      .filter((th) => !query || th.toLowerCase().includes(query))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    results.innerHTML = matches.length
      ? matches.map((th) => `<button type="button" class="bv-row" data-pick-theme="${escapeHtml(th)}" aria-pressed="${current === th}"><span class="bv-row__text"><span class="bv-row__title">${escapeHtml(th)}</span></span>${current === th ? kitIcon("check", { size: 20 }) : ""}</button>`).join("")
      : `<p class="bv-foot">${escapeHtml(t("bvAdd.noThemes"))}</p>`;
    results.querySelectorAll("[data-pick-theme]").forEach((b) => b.addEventListener("click", () => {
      haptic("light");
      if (onPick) { onPick(b.dataset.pickTheme); return; }
      state.filter.catalogTheme = b.dataset.pickTheme;
      hideSheet();
      reloadGrid();
    }));
  };
  paintThemes();
  $("#themePickerInput")?.addEventListener("input", (e) => paintThemes(e.target.value));
}

function wireCatalogCards() {
  const grid = $("#catalogResults");
  if (!grid || grid._cardsDelegated) return;
  grid._cardsDelegated = true;
  grid.addEventListener("click", async (e) => {
    if (e.target.closest("#catalogClearFilters")) { clearCatalogFilters(); return; }
    if (e.target.closest("#filterChip")) { showFilterSheet(reloadGrid); return; }
    if (e.target.closest("#catalogSortBtn")) { openSortSheet(); return; }
    if (e.target.closest("#moreThemesChip")) { openThemePicker(); return; }
    if (e.target.closest("#comingSoonAll")) { state.catalog.showAllUpcoming = !state.catalog.showAllUpcoming; refreshCatalogGrid(); return; }
    if (e.target.closest("#retiredQuick")) {
      state.filter.catalogRetired = state.filter.catalogRetired === "retired" ? "all" : "retired";
      haptic("light");
      reloadGrid();
      return;
    }
    if (e.target.closest("#catalogLayoutToggle")) {
      state.compactView = !state.compactView;
      localStorage.setItem("bv_compact_view", state.compactView);
      haptic("light");
      refreshCatalogGrid();
      $("#catalogLayoutToggle")?.focus();
      return;
    }
    const themeChip = e.target.closest("[data-cat-theme]");
    if (themeChip) {
      state.filter.catalogTheme = themeChip.dataset.catTheme;
      haptic("light");
      reloadGrid();
      return;
    }
    const addBtn = e.target.closest("[data-add-set]");
    if (addBtn) {
      e.preventDefault();
      if (getModePref() === "kids") { openKidsAddSheet(addBtn.dataset.addSet, addBtn.closest(".bv-tile")); return; }
      quickAddFromTile(addBtn.dataset.addSet, addBtn);
      return;
    }
    // Coming-soon: Notify me = wishlist the upcoming set.
    const wishBtn = e.target.closest("[data-cs-wish]");
    if (wishBtn) {
      e.stopPropagation();
      const setNum = wishBtn.dataset.csWish;
      const name = wishBtn.dataset.csName;
      const isOn = wishBtn.getAttribute("aria-pressed") === "true";
      haptic("light");
      try {
        if (isOn) {
          await api(`/api/wishlist/by-set/${encodeURIComponent(setNum)}`, { method: "DELETE" });
          if (state.wishlist) state.wishlist = state.wishlist.filter((w) => w.set_num !== setNum);
        } else {
          await api("/api/wishlist", { method: "POST", body: { set_num: setNum, name } });
          if (state.wishlist) state.wishlist.push({ set_num: setNum, name });
        }
        wishBtn.setAttribute("aria-pressed", String(!isOn));
        wishBtn.classList.toggle("cs-wish-btn--on", !isOn);
        wishBtn.textContent = t(!isOn ? "bvAdd.notifying" : "bvAdd.notifyMe");
      } catch (err) {
        toast(err.message || t("common.actionFailed"), "error");
      }
      return;
    }
    const csCard = e.target.closest("[data-cs-open]");
    if (csCard) { location.hash = "#/set/" + encodeURIComponent(csCard.dataset.csOpen); return; }
    // Kids mode: set detail is blocked, so a card tap opens a friendly confirm
    // sheet (no instant add) and, on confirm, adds the set and awards XP.
    const card = e.target.closest(".bv-tile, .set-list-card");
    if (card && getModePref() === "kids") {
      e.preventDefault();
      e.stopPropagation();
      haptic("light");
      openKidsAddSheet(card.dataset.set || card.dataset.setNum, card);
      return;
    }
    if (card) haptic("light");
  });
  grid.addEventListener("keydown", (e) => {
    const cs = e.target.closest?.("[data-cs-open]");
    if (cs && (e.key === "Enter" || e.key === " ") && e.target === cs) { e.preventDefault(); location.hash = "#/set/" + encodeURIComponent(cs.dataset.csOpen); }
  });
}

// Inject the owned state onto a catalog card without a full re-render.
function markCardOwned(card) {
  if (!card || card.classList.contains("is-owned")) return;
  const s = (state.catalog.items || []).find((x) => x.set_num === (card.dataset.set || card.dataset.setNum));
  if (s) card.outerHTML = catalogCardHTML(s);
  else card.classList.add("is-owned");
}


function clearCatalogFilters() {
  const f = state.filter;
  f.catalogQ = "";
  f.catalogTheme = "all";
  f.catalogThemeGroup = "all";
  f.catalogCategory = "all";
  f.catalogRetired = "all";
  f.catalogYear = "all";
  f.catalogSort = "year_desc";
  f.catalogDeal = false;
  Object.keys(f.catalogRanges || {}).forEach(k => f.catalogRanges[k] = "");
  haptic("light");
  loadCatalog({ reset: true }).then(() => paintAdd());
}

// Filters sheet (canvas: Filters): status, theme, value, deal signal, then the
// finer facets. "Show N sets" previews the result count before applying.
// `initial` reopens the sheet with an unapplied draft (after "More themes").
function showFilterSheet(onApply, initial = null) {
  const r = state.filter.catalogRanges;
  const f = initial || state.filter;
  const shownRanges = initial ? initial.catalogRanges : r;
  const rangeField = (label, minKey, maxKey, ph1, ph2, money = false) => {
    const accessibleLabel = t({ min_year: 'catalog.releaseYear', min_pieces: 'catalog.pieces', min_value: 'catalog.currentValue' }[minKey]);
    const box = (key, ph, which) => `<div class="bv-field"><label for="f_${key}">${escapeHtml(t(which === "min" ? "bvAdd.min" : "bvAdd.max"))}</label>
      <div class="bv-field__box">${money ? `<span class="bv-field__prefix">$</span>` : ""}<input class="bv-mono-input" type="number" inputmode="numeric" id="f_${key}" value="${escapeHtml(String(shownRanges[key] ?? ""))}" placeholder="${escapeHtml(ph)}" aria-label="${escapeHtml(accessibleLabel)} — ${escapeHtml(t(which === "min" ? 'catalog.minimum' : 'catalog.maximum'))}" aria-describedby="f_${minKey}_error"></div></div>`;
    return `<section class="bv-filter__section">
        <h3>${escapeHtml(label)}</h3>
        <div class="bv-form-grid">${box(minKey, ph1, "min")}${box(maxKey, ph2, "max")}</div>
        <p id="f_${minKey}_error" class="bv-field__error field-error" role="alert" hidden></p>
      </section>`;
  };
  const chipGroup = (key, opts, cur, { allowNone = true } = {}) => `<div class="bv-chips bv-chips--wrap sheet-facet" data-facet="${key}" data-allow-none="${allowNone}">
      ${opts.map(([v, l]) => `<button type="button" class="bv-chip" data-fval="${escapeHtml(v)}" aria-pressed="${cur === v}">${escapeHtml(l)}</button>`).join("")}
    </div>`;
  const facetGroup = (label, key, opts, cur) => (!opts || !opts.length) ? "" : `<section class="bv-filter__section">
      <h3>${escapeHtml(label)}</h3>${chipGroup(key, opts.map((o) => [o, o]), cur || "all")}</section>`;
  const themes = popularThemes(state.themes, 4);
  if (f.catalogTheme && f.catalogTheme !== "all" && !themes.includes(f.catalogTheme)) themes.unshift(f.catalogTheme);
  showSheet(kitSheetBody({
    title: t("bvAdd.filters"),
    id: "filterSheet",
    inner: `<div class="bv-filter advanced-filter-sheet">
      <section class="bv-filter__section">
        <h3>${escapeHtml(t("bvAdd.status"))}</h3>
        ${chipGroup("retired", [["active", t("bvAdd.available")], ["retiring", t("bvAdd.retiringSoon")], ["retired", t("bvCommon.retired")]], f.catalogRetired || "all")}
      </section>
      <section class="bv-filter__section">
        <h3>${escapeHtml(t("bvAdd.theme"))}</h3>
        ${chipGroup("theme", themes.map((th) => [th, th]), f.catalogTheme || "all")}
        ${state.themes.length > 4 ? `<button type="button" class="bv-chip" id="filterMoreThemes">${escapeHtml(t("bvAdd.moreThemes"))}${kitIcon("down", { size: 16 })}</button>` : ""}
      </section>
      ${rangeField(t("bvAdd.value"), "min_value", "max_value", "0", t("bvAdd.any"), true)}
      <section class="bv-filter__section">
        <h3>${escapeHtml(t("bvAdd.dealSignal"))}</h3>
        ${chipGroup("deal", [["on", t("bvAdd.dealBuy")]], f.catalogDeal ? "on" : "off")}
      </section>
      ${rangeField(t("catalog.releaseYear"), "min_year", "max_year", "1949", String(new Date().getFullYear()))}
      ${rangeField(t("catalog.pieces"), "min_pieces", "max_pieces", "0", t("bvAdd.any"))}
      ${facetGroup(t("bvAdd.themeGroup"), "theme_group", state.themeGroups, f.catalogThemeGroup)}
      ${facetGroup(t("bvAdd.category"), "category", state.categories, f.catalogCategory)}
    </div>
    <div class="bv-btn-row bv-filter__actions sheet-sticky-actions">
      <button type="button" class="bv-btn bv-btn--outline" id="filterClear">${escapeHtml(t("bvAdd.clear"))}</button>
      <button type="button" class="bv-btn bv-btn--primary" id="filterApply">${escapeHtml(t("bvAdd.showResults"))}</button>
    </div>`,
  }));

  $$("#filterSheet .sheet-facet").forEach((group) => group.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-fval]");
    if (!btn) return;
    const on = btn.getAttribute("aria-pressed") !== "true";
    group.querySelectorAll("[data-fval]").forEach((x) => x.setAttribute("aria-pressed", String(x === btn && on)));
    haptic("light");
    previewCount();
  }));
  $("#filterMoreThemes")?.addEventListener("click", () => {
    const draft = readDraft();
    openThemePicker({
      current: draft.catalogTheme,
      onPick: (theme) => showFilterSheet(onApply, { ...draft, catalogTheme: theme }),
    });
  });
  const readFacet = (key) => document.querySelector(`#filterSheet .sheet-facet[data-facet="${key}"] [aria-pressed="true"]`)?.dataset.fval || "all";
  const readDraft = () => {
    const draft = { ...state.filter, catalogRanges: { ...r } };
    Object.keys(draft.catalogRanges).forEach((k) => {
      const el = document.getElementById("f_" + k);
      if (el) draft.catalogRanges[k] = el.value !== "" ? parseFloat(el.value) : "";
    });
    draft.catalogThemeGroup = readFacet("theme_group");
    draft.catalogCategory = readFacet("category");
    draft.catalogRetired = readFacet("retired");
    draft.catalogTheme = readFacet("theme");
    draft.catalogDeal = readFacet("deal") === "on";
    return draft;
  };
  // Live "Show N sets": a 1-row query with the draft filters.
  let previewTimer = null;
  let previewGen = 0;
  const previewCount = () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      const gen = ++previewGen;
      const saved = state.filter;
      const savedOffset = state.catalog.offset;
      const savedSize = state.catalog.pageSize;
      try {
        state.filter = readDraft();
        state.catalog.offset = 0;
        state.catalog.pageSize = 1;
        const qs = catalogQuery();
        state.filter = saved;
        state.catalog.offset = savedOffset;
        state.catalog.pageSize = savedSize;
        const res = await api("/api/sets/search?" + qs);
        if (gen !== previewGen) return;
        const btn = $("#filterApply");
        if (btn) btn.textContent = tPlural("bvAdd.showSets", res.total ?? 0, { count: (res.total ?? 0).toLocaleString() });
      } catch {
        state.filter = saved;
        state.catalog.offset = savedOffset;
        state.catalog.pageSize = savedSize;
      }
    }, 250);
  };
  $$("#filterSheet input[type='number']").forEach((i) => i.addEventListener("input", previewCount));
  previewCount();

  $("#filterClear").addEventListener("click", () => {
    Object.keys(r).forEach((k) => { r[k] = ""; });
    state.filter.catalogThemeGroup = "all";
    state.filter.catalogCategory = "all";
    state.filter.catalogRetired = "all";
    state.filter.catalogTheme = "all";
    state.filter.catalogDeal = false;
    hideSheet();
    onApply();
  });

  $("#filterApply").addEventListener("click", () => {
    let firstInvalid = null;
    for (const [minKey, maxKey] of [['min_year', 'max_year'], ['min_pieces', 'max_pieces'], ['min_value', 'max_value']]) {
      const min = document.getElementById(`f_${minKey}`);
      const max = document.getElementById(`f_${maxKey}`);
      const error = document.getElementById(`f_${minKey}_error`);
      const invalid = min.value !== '' && max.value !== '' && Number(min.value) > Number(max.value);
      min.setAttribute('aria-invalid', String(invalid));
      max.setAttribute('aria-invalid', String(invalid));
      error.textContent = invalid ? t('catalog.rangeOrderError') : '';
      error.hidden = !invalid;
      if (invalid && !firstInvalid) firstInvalid = min;
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }
    const draft = readDraft();
    Object.assign(r, draft.catalogRanges);
    state.filter.catalogThemeGroup = draft.catalogThemeGroup;
    state.filter.catalogCategory = draft.catalogCategory;
    state.filter.catalogRetired = draft.catalogRetired;
    state.filter.catalogTheme = draft.catalogTheme;
    state.filter.catalogDeal = draft.catalogDeal;
    hideSheet();
    onApply();
  });
}

export function renderPile() {
  const photoNeedsSetup = photoScanNeedsSetup();
  $("#root").innerHTML = `
    <main class="bv-page no-nav scan-page bv-pile">
      ${kitTopbar({ title: t("bvAdd.scanASet"), sub: t("bvAdd.pileSub"), back: "history" })}
      <section class="bv-group scan-choice" aria-labelledby="scanChoiceTitle">
        <h2 class="bv-h2" id="scanChoiceTitle">${escapeHtml(t("bvAdd.howIdentify"))}</h2>
        <div class="bv-group__box scan-method-list" role="group" aria-label="${escapeHtml(t("bvAdd.scanMode"))}">
          <button type="button" class="bv-row scan-method" id="pileScanBarcode">${kitIcon("scan", { size: 22 })}<span class="bv-row__text scan-method-copy"><span class="bv-row__title">${escapeHtml(t("bvAdd.scanBarcode"))}</span><span class="bv-row__sub">${escapeHtml(t("bvAdd.scanBarcodeSub"))}</span></span><span class="bv-row__trail scan-method-arrow" aria-hidden="true">${kitIcon("chev", { size: 20 })}</span></button>
          <button type="button" class="bv-row scan-method${photoNeedsSetup ? " needs-setup" : ""}" id="pileScanPhoto"${photoNeedsSetup ? ' aria-describedby="photoScanAvailability"' : ""}>${kitIcon("camera", { size: 22 })}<span class="bv-row__text scan-method-copy"><span class="bv-row__title">${escapeHtml(t("bvAdd.identifyPhoto"))}</span><span class="bv-row__sub" id="photoScanAvailability">${escapeHtml(t(photoNeedsSetup ? "bvAdd.photoNeedsSetup" : "bvAdd.identifyPhotoSub"))}</span></span><span class="bv-row__trail scan-method-arrow" aria-hidden="true">${kitIcon("chev", { size: 20 })}</span></button>
          <button type="button" class="bv-row scan-method" id="pileScanShelf"${photoNeedsSetup ? ' aria-describedby="photoScanAvailability"' : ""}>${kitIcon("grid", { size: 22 })}<span class="bv-row__text scan-method-copy"><span class="bv-row__title">${escapeHtml(t("bvAdd.shelfSnap"))}</span><span class="bv-row__sub">${escapeHtml(t("bvAdd.shelfSnapSub"))}</span></span><span class="bv-row__trail scan-method-arrow" aria-hidden="true">${kitIcon("chev", { size: 20 })}</span></button>
        </div>
      </section>
      <form class="bv-card bv-form" id="pileManualForm" novalidate>
        ${kitField({ id: "pileManualInput", name: "set_identifier", label: t("bvAdd.typeLabel"), placeholder: t("bvAdd.typePlaceholder"), mono: true, inputmode: "search", autocomplete: "off", attrs: { spellcheck: "false" } })}
        <p class="bv-field__error scan-manual-error" id="pileManualError" role="status" aria-live="polite"></p>
        <button id="pileManualSubmit" class="bv-btn bv-btn--primary bv-btn--full" type="submit" aria-label="${escapeHtml(t("bvAdd.lookUpSet"))}">${kitIcon("search", { size: 20 })}<span>${escapeHtml(t("bvAdd.lookUp"))}</span></button>
      </form>
      <p class="bv-foot scan-privacy-note">${escapeHtml(t(photoNeedsSetup ? "bvAdd.pilePrivacyGuest" : "bvAdd.pilePrivacy"))}</p>
    </main>`;

  $("#pileScanBarcode")?.addEventListener("click", () => openScan("barcode"));
  $("#pileScanPhoto")?.addEventListener("click", () => openScan("image"));
  $("#pileScanShelf")?.addEventListener("click", () => openScan("image", { shelf: true }));
  $("#pileManualForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#pileManualInput");
    const submit = $("#pileManualSubmit");
    const error = $("#pileManualError");
    if (error) error.textContent = "";
    if (submit) submit.disabled = true;
    try {
      await lookupScanInput(input?.value || "");
    } catch (e) {
      if (error) error.textContent = e.message || t("bvAdd.typeInvalid");
      input?.focus();
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

// Quick-chip themes: lead with collector/investment-relevant themes. The
// /api/themes list is ordered by raw SKU count, which surfaces Gear/Books/
// Duplo/Educational (high volume, low interest). Curated names (exact DB
// strings) are filtered to those actually present, then padded from the
// count-ordered list so the row always fills 8.
const POPULAR_THEMES = [
  'Star Wars', 'Icons', 'Technic', 'Modular Buildings', 'City',
  'Architecture', 'LEGO Ideas and CUUSOO', 'Creator', 'Ninjago',
  'Harry Potter', 'Marvel Super Heroes', 'Minecraft', 'Friends',
];
function popularThemes(all, n = 8) {
  const present = new Set(all);
  const picked = POPULAR_THEMES.filter(t => present.has(t));
  for (const t of all) { if (picked.length >= n) break; if (!picked.includes(t)) picked.push(t); }
  return picked.slice(0, n);
}


function sourceCueHTML(s) { return trustBadgeHTML(s, { compact: true }); }

// DEAL / STRONG BUY cue from the authoritative deal signal (computed in
// enrichSetRecord, already source-anonymized). Only 'buy' is surfaced in the
// catalog — that's what deal-hunters scan for. overlay = absolute corner badge
// for the grid image; otherwise an inline meta badge for the compact list.
function dealTagHTML(s, { overlay = false } = {}) {
  if (s.deal_signal !== 'buy') return '';
  const pct = s.deal_discount_pct ? `-${Math.round(s.deal_discount_pct)}%` : '';
  const txt = s.deal_strong ? t('card.strongBuy', { pct }).trim() : t('card.deal', { pct }).trim();
  return overlay
    ? `<span class="deal-tag-overlay price-cue" style="position:absolute;bottom:8px;left:8px;background:var(--up);color:#fff;font-family:var(--mono);font-size:9px;font-weight:800;letter-spacing:.04em;border-radius:4px;padding:2px 6px;z-index:2;">${txt}</span>`
    : `<span class="badge price-cue" style="background:var(--up);color:#fff;font-size:9px;font-weight:800;letter-spacing:.03em;border-radius:4px;padding:1px 5px;margin-left:4px;">${txt}</span>`;
}

// $/piece value cue: tinted when >=25% off the formula baseline either way.
function pppBadgeHTML(s) {
  const r = pricePerPiece(s);
  if (!r) return "";
  const color = r.delta <= -0.25 ? "var(--up)" : r.delta >= 0.25 ? "var(--down)" : "var(--ink-mute)";
  return `<span class="ppp-badge" style="color:${color};">${t('card.perPiece', { price: `$${r.ppp.toFixed(2)}` })}</span>`;
}

// Owned if the API flagged it OR it's in the client-side owned set (kept fresh
// as the user adds sets, so the catalog reflects the vault without a reload).
function isOwnedSet(s) {
  return !!s.owned || state.ownedSetNums.has(s.set_num);
}


