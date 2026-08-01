import { $, $$, haptic, escapeHtml, setHue, fmtMoney, trendBadgeHTML, THEME_COLORS, bvIDB, SEARCH_DEBOUNCE_MS, mount, toast, thumbImg } from '../utils.js';
import { t } from '../lib/i18n.js';
import { state, invalidatePortfolio } from '../state.js';
import { api, getSessionUserId, photoScanNeedsSetup } from '../api.js';
import { getModePref } from '../theme.js';
import { I } from '../icons.js';
import { showSheet, hideSheet } from '../components/sheet.js';
import { openScan, lookupScanInput } from '../components/scanner-lazy.js';
import { trustBadgeHTML } from '../components/trust.js';
import { activeCatalogFilterCount, catalogFilterSummary, pricePerPiece, estMark, displayValueOf, cleanFacetList } from '../lib/pure.js';
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
  if (f.catalogSort && f.catalogSort !== 'value_desc') p.set('sort', f.catalogSort);
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
  { base: "value",    asc: "value_asc", desc: "value_desc", def: "value_desc", label: "Value" },
  { base: "roi",      asc: "roi_asc",   desc: "roi_desc",   def: "roi_desc",   label: "Growth" },
  { base: "year",     asc: "year_asc",  desc: "year_desc",  def: "year_desc",  label: "Newest" },
  { base: "name",     asc: "az",        desc: "za",          def: "az",          label: "A–Z" },
  { base: "trending", asc: "trending",  desc: "trending",    def: "trending",    label: "Trending" },
];
const catalogSortChipText = (o, cur) => {
  const active = cur === o.asc || cur === o.desc;
  return o.label + (active ? (cur === o.asc ? " ↑" : " ↓") : "");
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
      if (location.hash === "#/add" && $("#catalogResults") && isCatalogDefault()) refreshCatalogGrid();
    }).catch(() => { state.catalog.upcomingLoaded = true; });
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
  // Flag owned sets (any mode). Seed synchronously from what we already have so
  // the first paint is usually correct, then backfill from the full collection
  // and refresh once if that revealed more.
  seedOwnedFromPortfolio();
  paintAdd();
  if (!state.ownedSetNumsLoaded) {
    const before = state.ownedSetNums.size;
    ensureOwnedSetNums().then(() => {
      if (state.ownedSetNums.size !== before && location.hash === "#/add" && $("#catalogResults")) refreshCatalogGrid();
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
        <p>${escapeHtml(e.message)}. Check your connection and try again.</p>
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

// "Coming Soon" discovery row (G2b) — upcoming LEGO releases, shown only on the
// default catalog view (hidden during search/filter). Cards have a wishlist button
// for logged-in users; the upcoming sets aren't in the trackable catalog yet.
function comingSoonSectionHTML() {
  const up = state.catalog.upcoming || [];
  if (!isCatalogDefault() || !up.length) return "";
  const isLoggedIn = !!getSessionUserId();
  const wishlist = new Set((state.wishlist || []).map(w => w.set_num));
  return `
    <div class="coming-soon-wrap" style="margin-bottom:16px;">
      <h2 class="section-title" style="margin-top:0;">Coming Soon</h2>
      <div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch;">
        ${up.slice(0, 20).map((u) => {
          const onWishlist = wishlist.has(u.set_num);
          return `
          <div class="cs-card" data-cs-open="${escapeHtml(String(u.set_num))}" style="cursor:pointer;flex:0 0 auto;width:144px;background:var(--surface-2);border:1px solid var(--line-soft);border-radius:var(--r-2);padding:10px;">
            <div style="font-size:12px;font-weight:600;color:var(--ink);line-height:1.3;height:32px;overflow:hidden;">${escapeHtml(String(u.name || ""))}</div>
            <div style="font-size:10px;font-family:var(--mono);color:var(--ink-mute);margin-top:4px;">#${escapeHtml(String(u.set_num || "").replace(/-\d+$/, ""))}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;gap:6px;">
              <span class="price-cue" style="font-size:13px;font-weight:700;color:var(--ink);">${u.price_usd ? fmtMoney(u.price_usd, { cents: 0 }) : ""}</span>
              <span style="font-size:9px;font-family:var(--mono);font-weight:800;text-transform:uppercase;color:var(--accent);border:1px solid var(--accent);border-radius:6px;padding:1px 5px;white-space:nowrap;">${escapeHtml(String(u.availability || "Soon"))}</span>
            </div>
            ${isLoggedIn ? `
            <button class="cs-wish-btn ${onWishlist ? 'cs-wish-btn--on' : ''}" data-cs-wish="${escapeHtml(String(u.set_num))}" data-cs-name="${escapeHtml(String(u.name || ''))}"
              style="width:100%;margin-top:8px;padding:5px 0;font-size:11px;font-weight:600;border-radius:8px;border:1px solid ${onWishlist ? 'var(--accent)' : 'var(--line)'};background:${onWishlist ? 'var(--accent)' : 'transparent'};color:${onWishlist ? '#fff' : 'var(--ink-mute)'};cursor:pointer;">
              ${onWishlist ? '✓ Wishlisted' : '+ Wishlist'}
            </button>` : ''}
          </div>`;
        }).join("")}
      </div>
    </div>`;
}

function catalogResultsHTML() {
  const c = state.catalog;
  const f = state.filter;
  const listClass = state.compactView ? "compact-list" : "grid";
  return `
    ${comingSoonSectionHTML()}
    <div id="catalogCount" class="result-count">${c.total === 1 ? t("counts.resultsOne") : t("counts.results", { n: c.total.toLocaleString() })}</div>
    ${c.items.length === 0 ? `
      <div class="empty card">
        <div class="empty-icon">${I.search()}</div>
        <h3>No sets found</h3>
        <p>${f.catalogQ ? `Nothing matches "${escapeHtml(f.catalogQ)}".` : "No sets match these filters."} Try a different search or clear filters.</p>
        ${!isCatalogDefault() ? `<button class="btn-secondary" id="catalogClearFilters" style="margin-top:12px;">Clear filters</button>` : ""}
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
  mount(results, catalogResultsHTML());
  refreshCatalogSummary();
  wireCatalogCards();
  mountCatalogSentinel();
  syncCatalogURL();
}

function refreshCatalogSummary() {
  const el = $("#catalogFilterSummary");
  if (el) el.textContent = catalogFilterSummary(state.filter);
  // Keep the Filters chip badge/active state in sync (it lives outside the grid
  // that refreshCatalogGrid re-renders, so it otherwise goes stale after Apply/Clear).
  const chip = $("#filterChip");
  if (chip) {
    const n = activeCatalogFilterCount(state.filter);
    chip.classList.toggle("active", n > 0);
    const sp = chip.querySelector("span");
    if (sp) sp.textContent = `Filters${n ? " · " + n : ""}`;
  }
}

function wireCatalogCards() {
  const grid = $("#catalogResults");
  if (!grid || grid._cardsDelegated) return;
  grid._cardsDelegated = true;
  grid.addEventListener("click", async (e) => {
    if (e.target.closest("#catalogClearFilters")) { clearCatalogFilters(); return; }
    // Coming-soon wishlist button
    const wishBtn = e.target.closest("[data-cs-wish]");
    if (!wishBtn) {
      // The rest of the coming-soon card opens the set detail like any result.
      const csCard = e.target.closest("[data-cs-open]");
      if (csCard) { location.hash = "#/set/" + encodeURIComponent(csCard.dataset.csOpen); return; }
    }
    if (wishBtn) {
      e.stopPropagation();
      const setNum = wishBtn.dataset.csWish;
      const name = wishBtn.dataset.csName;
      const isOn = wishBtn.classList.contains("cs-wish-btn--on");
      haptic("light");
      try {
        if (isOn) {
          await api(`/api/wishlist/by-set/${encodeURIComponent(setNum)}`, { method: "DELETE" });
          wishBtn.classList.remove("cs-wish-btn--on");
          wishBtn.style.cssText = "width:100%;margin-top:8px;padding:5px 0;font-size:11px;font-weight:600;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--ink-mute);cursor:pointer;";
          wishBtn.textContent = "+ Wishlist";
          if (state.wishlist) state.wishlist = state.wishlist.filter(w => w.set_num !== setNum);
        } else {
          await api("/api/wishlist", { method: "POST", body: { set_num: setNum, name } });
          wishBtn.classList.add("cs-wish-btn--on");
          wishBtn.style.cssText = "width:100%;margin-top:8px;padding:5px 0;font-size:11px;font-weight:600;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;";
          wishBtn.textContent = "✓ Wishlisted";
          if (state.wishlist) state.wishlist.push({ set_num: setNum, name });
        }
      } catch (err) {
        toast(err.message || "Failed", "error");
      }
      return;
    }
    const card = e.target.closest(".set-card, .set-list-card.compact");
    if (!card || !card.dataset.set) return;
    // Kids mode: set detail is blocked, so a card tap opens a friendly confirm
    // sheet (no instant add) and, on confirm, adds the set and awards XP.
    if (getModePref() === "kids") {
      e.stopPropagation();
      haptic("light");
      openKidsAddSheet(card.dataset.set, card);
      return;
    }
    haptic("light");
    location.hash = "#/set/" + encodeURIComponent(card.dataset.set);
  });
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
    for (const i of (r?.items || [])) state.ownedSetNums.add(i.set_num);
    state.ownedSetNumsLoaded = true;
  } catch { /* non-fatal: owned badges just won't show until next load */ }
}

// Inject the OWNED overlay onto a catalog card without a full re-render.
function markCardOwned(card) {
  if (!card || card.classList.contains("is-owned")) return;
  card.classList.add("is-owned");
  const imgWrap = card.querySelector(".set-card-img, .sl-img");
  if (imgWrap && !imgWrap.querySelector(".owned-tag")) {
    imgWrap.insertAdjacentHTML("beforeend", `<span class="owned-tag">${I.check()}OWNED</span>`);
  }
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
      state.ownedSetNums.add(setNum);
      markCardOwned(card);
      invalidatePortfolio();
      hideSheet();
      if (result?.kids?.xp_gained > 0) {
        const { xp_gained, new_level, new_badges } = result.kids;
        const badgePart = new_badges?.[0] ? ` · Badge: ${new_badges[0].replace(/_/g, " ")}! 🎉` : "";
        const lvlPart = new_level ? ` Level ${new_level}!` : "";
        toast(`+${xp_gained} XP!${lvlPart}${badgePart}`, "success");
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
    <div class="page">
      <div class="topbar">
        <div class="topbar-heading">
          <div class="topbar-eyebrow">Catalog</div>
          <h1 class="topbar-title">Find a set</h1>
        </div>
        <div class="topbar-actions" style="margin-left:auto;">
          <button class="icon-btn" id="catalogSearchToggle" aria-label="Search" aria-expanded="${f.catalogQ ? "true" : "false"}">${I.search()}</button>
          <button class="icon-btn" id="catalogLayoutToggle" aria-label="Toggle Layout">${state.compactView ? I.grid() : I.list()}</button>
        </div>
      </div>

      <div class="search-wrap${f.catalogQ ? " open" : ""}" style="margin-bottom:14px;">
        <span class="s-icon">${I.search()}</span>
        <input class="search-input" id="catalogSearch" placeholder="Search sets, themes, tags…" autocomplete="off" value="${escapeHtml(f.catalogQ)}">
      </div>

      <div class="filter-row">
        <button class="chip ${f.catalogTheme === "all" ? "active" : ""}" data-cat-theme="all">All themes</button>
        ${state.themes.length > 8 && f.catalogTheme !== "all" && !popularThemes(state.themes, quickThemeCount()).includes(f.catalogTheme) ? `<button class="chip active" data-cat-theme="${escapeHtml(f.catalogTheme)}">${escapeHtml(f.catalogTheme)}</button>` : ""}
        ${popularThemes(state.themes, quickThemeCount()).map(t => `<button class="chip ${f.catalogTheme === t ? "active" : ""}" data-cat-theme="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("")}
        ${state.themes.length > 8 ? `<button class="chip" id="moreThemesChip">${I.filter()}<span>More…</span></button>` : ""}
      </div>

      <div class="filter-row" style="margin-top:-4px;">
        ${CATALOG_SORTS
          .map(o => `<button class="chip ${(f.catalogSort === o.asc || f.catalogSort === o.desc) ? "active" : ""}" data-csort-base="${o.base}">${catalogSortChipText(o, f.catalogSort)}</button>`).join("")}
        ${[["all","All"],["active","Active"],["retired","Retired"],["retiring","Retiring"]].map(([k,l]) =>
          `<button class="chip ${(f.catalogRetired || "all") === k ? "active" : ""}" data-retired="${k}">${l}</button>`).join("")}
        <button class="chip ${f.catalogDeal ? "active" : ""}" id="dealChip" style="${f.catalogDeal ? "border-color:var(--up);color:var(--up);" : ""}"><span>Deals</span></button>
        <button class="chip ${activeCatalogFilterCount(f) ? "active" : ""}" id="filterChip">${I.filter()}<span>Filters${activeCatalogFilterCount(f) ? " · " + activeCatalogFilterCount(f) : ""}</span></button>
      </div>

      <div class="filter-summary" id="catalogFilterSummary">${escapeHtml(catalogFilterSummary(f))}</div>

      <div id="catalogResults">${catalogResultsHTML()}</div>
    </div>`;

  // Search is collapsed by default under the header search icon; tapping it
  // reveals the field and focuses it (tapping again with an empty query hides).
  $("#catalogSearchToggle")?.addEventListener("click", (e) => {
    const wrap = document.querySelector(".search-wrap");
    if (!wrap) return;
    const open = wrap.classList.toggle("open");
    e.currentTarget.setAttribute("aria-expanded", String(open));
    if (open) { $("#catalogSearch")?.focus(); }
    else if (!state.filter.catalogQ) { /* stays closed */ }
  });

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
    }, SEARCH_DEBOUNCE_MS);
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
    refreshCatalogSummary();
    reloadGrid();
  }));
  $$("[data-csort-base]").forEach(b => b.addEventListener("click", () => {
    const o = CATALOG_SORTS.find(s => s.base === b.dataset.csortBase);
    if (!o) return;
    const cur = state.filter.catalogSort;
    // Same sort active → flip direction; new sort → its default direction.
    state.filter.catalogSort = cur === o.desc ? o.asc : cur === o.asc ? o.desc : o.def;
    haptic("light");
    $$("[data-csort-base]").forEach(x => {
      const xo = CATALOG_SORTS.find(s => s.base === x.dataset.csortBase);
      if (!xo) return;
      x.classList.toggle("active", state.filter.catalogSort === xo.asc || state.filter.catalogSort === xo.desc);
      x.textContent = catalogSortChipText(xo, state.filter.catalogSort);
    });
    reloadGrid();
  }));
  $$("[data-retired]").forEach(b => b.addEventListener("click", () => {
    state.filter.catalogRetired = b.dataset.retired; haptic("light");
    $$("[data-retired]").forEach(x => x.classList.toggle("active", x.dataset.retired === state.filter.catalogRetired));
    refreshCatalogSummary();
    reloadGrid();
  }));
  $("#dealChip")?.addEventListener("click", () => {
    state.filter.catalogDeal = !state.filter.catalogDeal;
    haptic("light");
    const chip = $("#dealChip");
    if (chip) {
      chip.classList.toggle("active", state.filter.catalogDeal);
      chip.style.cssText = state.filter.catalogDeal ? "border-color:var(--up);color:var(--up);" : "";
    }
    refreshCatalogSummary();
    reloadGrid();
  });
  $("#filterChip")?.addEventListener("click", () => showFilterSheet(reloadGrid));

  // Searchable picker for the full theme list (the row shows only 8 quick chips).
  $("#moreThemesChip")?.addEventListener("click", () => {
    showSheet(`
      <h2 class="u-serif-h" style="margin:0 4px 12px;">Pick a theme</h2>
      <div class="search-wrap" style="margin:0 4px 14px;">
        <span class="s-icon">${I.search()}</span>
        <input class="search-input" id="themePickerInput" placeholder="Search themes…" autocomplete="off">
      </div>
      <div id="themePickerResults" class="scrollable u-col u-gap-1" style="max-height:320px;overflow-y:auto;margin:4px;"></div>
    `);
    const results = $("#themePickerResults");
    const inp = $("#themePickerInput");
    const paintThemes = (q = "") => {
      const query = q.toLowerCase().trim();
      const matches = state.themes
        .filter(t => !query || t.toLowerCase().includes(query))
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
      results.innerHTML = matches.length
        ? matches.map(t => `<button class="chip u-wfull ${state.filter.catalogTheme === t ? "active" : ""}" data-pick-theme="${escapeHtml(t)}" style="justify-content:flex-start;">${escapeHtml(t)}</button>`).join("")
        : `<div class="u-mute u-fs-base" style="text-align:center;padding:20px;">No themes match</div>`;
      results.querySelectorAll("[data-pick-theme]").forEach(b => b.addEventListener("click", () => {
        state.filter.catalogTheme = b.dataset.pickTheme;
        haptic("light");
        hideSheet();
        // Full repaint so the quick-chip row reflects the picked (often
        // non-popular) theme — refreshing only the grid left 'All themes' active.
        loadCatalog({ reset: true }).then(() => paintAdd());
      }));
    };
    paintThemes();
    inp?.addEventListener("input", e => paintThemes(e.target.value));
  });

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

function clearCatalogFilters() {
  const f = state.filter;
  f.catalogQ = "";
  f.catalogTheme = "all";
  f.catalogThemeGroup = "all";
  f.catalogCategory = "all";
  f.catalogRetired = "all";
  f.catalogYear = "all";
  f.catalogDeal = false;
  Object.keys(f.catalogRanges || {}).forEach(k => f.catalogRanges[k] = "");
  haptic("light");
  loadCatalog({ reset: true }).then(() => paintAdd());
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
  const f = state.filter;
  const activeCount = activeCatalogFilterCount(f);
  const facetGroup = (label, key, opts, cur) => {
    if (!opts || !opts.length) return '';
    return `
      <section class="filter-sheet-section">
        <div class="field-lbl">${label}</div>
        <div class="sheet-chip-grid sheet-facet" data-facet="${key}">
          <button class="chip ${(cur || 'all') === 'all' ? 'active' : ''}" data-fval="all">All</button>
          ${opts.map(o => `<button class="chip ${cur === o ? 'active' : ''}" data-fval="${escapeHtml(o)}">${escapeHtml(o)}</button>`).join('')}
        </div>
      </section>`;
  };
  showSheet(`
    <div class="sheet-title-row">
      <h2 class="u-serif-h" style="margin:0;">Advanced Filters</h2>
      ${activeCount ? `<span class="trust-badge warn">${activeCount} active</span>` : `<span class="trust-badge neutral">None active</span>`}
    </div>
    <div class="filter-active-line">${escapeHtml(catalogFilterSummary(f))}</div>
    <div class="scrollable advanced-filter-sheet">
      ${facetGroup("Theme group", "theme_group", state.themeGroups, f.catalogThemeGroup)}
      ${facetGroup("Category", "category", state.categories, f.catalogCategory)}
      <section class="filter-sheet-section">
        <div class="filter-section-title">Ranges</div>
        ${rangeField("Release Year", "min_year", "max_year", "Min year", "Max year")}
        ${rangeField("Piece Count", "min_pieces", "max_pieces", "Min pieces", "Max pieces")}
        ${rangeField("Current Value ($)", "min_value", "max_value", "Min value", "Max value")}
      </section>
    </div>
    <div class="btn-row sheet-sticky-actions">
      <button class="btn-secondary" id="filterClear">Clear all</button>
      <button class="btn-primary" id="filterApply">Apply filters</button>
    </div>`);

  $$(".sheet-facet").forEach(group => group.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-fval]");
    if (!btn) return;
    group.querySelectorAll("[data-fval]").forEach(x => x.classList.toggle("active", x === btn));
  }));
  const readFacet = (key) => document.querySelector(`.sheet-facet[data-facet="${key}"] .chip.active`)?.dataset.fval || "all";

  $("#filterClear").addEventListener("click", () => {
    Object.keys(r).forEach(k => r[k] = "");
    state.filter.catalogThemeGroup = "all";
    state.filter.catalogCategory = "all";
    hideSheet();
    onApply();
  });

  $("#filterApply").addEventListener("click", () => {
    Object.keys(r).forEach(k => {
      const el = document.getElementById("f_" + k);
      if (el) r[k] = el.value !== "" ? parseFloat(el.value) : "";
    });
    state.filter.catalogThemeGroup = readFacet("theme_group");
    state.filter.catalogCategory = readFacet("category");
    hideSheet();
    onApply();
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

function quickThemeCount() {
  try { return window.matchMedia?.("(max-width: 480px)")?.matches ? 3 : 8; }
  catch { return 8; }
}

function sourceCueHTML(s) { return trustBadgeHTML(s, { compact: true }); }

// DEAL / STRONG BUY cue from the authoritative deal signal (computed in
// enrichSetRecord, already source-anonymized). Only 'buy' is surfaced in the
// catalog — that's what deal-hunters scan for. overlay = absolute corner badge
// for the grid image; otherwise an inline meta badge for the compact list.
function dealTagHTML(s, { overlay = false } = {}) {
  if (s.deal_signal !== 'buy') return '';
  const pct = s.deal_discount_pct ? ` -${Math.round(s.deal_discount_pct)}%` : '';
  const txt = s.deal_strong ? `STRONG BUY${pct}` : `DEAL${pct}`;
  return overlay
    ? `<span class="deal-tag-overlay price-cue" style="position:absolute;bottom:8px;left:8px;background:var(--up);color:#fff;font-family:var(--mono);font-size:9px;font-weight:800;letter-spacing:.04em;border-radius:4px;padding:2px 6px;z-index:2;">${txt}</span>`
    : `<span class="badge price-cue" style="background:var(--up);color:#fff;font-size:9px;font-weight:800;letter-spacing:.03em;border-radius:4px;padding:1px 5px;margin-left:4px;">${txt}</span>`;
}

// $/piece value cue: tinted when >=25% off the formula baseline either way.
function pppBadgeHTML(s) {
  const r = pricePerPiece(s);
  if (!r) return "";
  const color = r.delta <= -0.25 ? "var(--up)" : r.delta >= 0.25 ? "var(--down)" : "var(--ink-mute)";
  return `<span class="ppp-badge" style="color:${color};">$${r.ppp.toFixed(2)}/pc</span>`;
}

// Owned if the API flagged it OR it's in the client-side owned set (kept fresh
// as the user adds sets, so the catalog reflects the vault without a reload).
function isOwnedSet(s) {
  return !!s.owned || state.ownedSetNums.has(s.set_num);
}

function catalogCardHTML(s) {
  const owned = isOwnedSet(s);
  const hasImg = s.image_url && !s.image_url.startsWith("data:");
  const h = setHue(s);
  // Prefer the blended market value (valuation v2) over the formula estimate.
  const dispVal = displayValueOf(s);
  const mvConf = Number(s.market_value) > 0 ? (s.market_value_confidence || null) : null;
  const confDot = mvConf ? `<span class="price-cue" title="Market confidence: ${mvConf}" style="display:inline-block;width:6px;height:6px;border-radius:50%;vertical-align:middle;margin-right:4px;background:${mvConf === 'high' ? 'var(--up)' : mvConf === 'medium' ? 'var(--accent)' : 'var(--bv-yellow)'};"></span>` : '';

  if (state.compactView) {
    const borderStyle = ` style="border-left-color: ${THEME_COLORS[s.theme] || 'var(--line)'};"`;
    return `
      <button class="set-list-card compact" data-set="${escapeHtml(s.set_num)}"${borderStyle}>
        <div class="sl-img${hasImg ? " has-photo" : ""}" style="width:42px;height:42px;">
          <div class="brick-tile" style="--h:${h};width:100%;height:100%;border-radius:var(--r-1);"></div>
          ${hasImg ? `<img class="set-photo" src="${escapeHtml(thumbImg(s.image_url))}" alt="${escapeHtml(s.name || '')}" loading="lazy" decoding="async">` : ""}
        </div>
        <div class="sl-body" style="flex: 1; min-width: 0;">
          <div class="sl-name" style="text-align:left;">
            ${((s.retirement_risk_score || 0) >= 70 || s.lego_retiring_soon) && !s.retired ? '🔥 ' : ''}${escapeHtml(s.name)}
          </div>
          <div class="sl-meta" style="text-align: left;">
            <span class="sl-setnum">${escapeHtml(s.set_num)}</span>
            <span class="dot"></span>
            <span class="sl-theme">${escapeHtml(s.theme || "")}</span>
            ${owned ? `<span class="badge badge--up" style="margin-left:4px;">OWNED</span>` : ""}
            ${dealTagHTML(s)}
            ${sourceCueHTML(s)}
          </div>
        </div>
        <div class="sl-right-compact">
          <div class="sl-value" style="display:flex;align-items:center;">
            ${estMark(s)}${fmtMoney(dispVal)}
            ${s.trend ? trendBadgeHTML(s.trend) : ""}
          </div>
          <div class="sl-delta" style="color:var(--ink-mute);">${s.pieces || 0}pc ${pppBadgeHTML(s)}</div>
        </div>
      </button>`;
  }

  return `
    <button class="set-card" data-set="${escapeHtml(s.set_num)}">
      <div class="set-card-img${hasImg ? " has-photo" : ""}">
        <div class="brick-tile" style="--h:${h};width:64%;height:64%;"></div>
        ${hasImg ? `<img class="set-photo" src="${escapeHtml(thumbImg(s.image_url))}" alt="${escapeHtml(s.name || '')}" loading="lazy" decoding="async">` : ""}
        ${s.retired ? `<span class="retired-tag">RETIRED</span>` : ""}
        ${((s.retirement_risk_score || 0) >= 70 || s.lego_retiring_soon) && !s.retired ? `<span class="retire-risk-badge">🔥</span>` : ""}
        ${dealTagHTML(s, { overlay: true })}
        ${owned ? `<span class="owned-tag">${I.check()}OWNED</span>` : ""}
      </div>
      <div class="set-card-body">
        <div class="set-card-name">${escapeHtml(s.name)}</div>
        <div class="set-card-meta">
          ${THEME_COLORS[s.theme] ? `<span class="theme-dot" style="background:${THEME_COLORS[s.theme]};"></span>` : ""}
          <span>${s.year || ""}</span>
          <span>${s.pieces || 0}pc</span>
          ${s.minifigs > 0 ? `<span>${s.minifigs === 1 ? t("counts.figsOne") : t("counts.figs", { n: s.minifigs })}</span>` : ""}
          ${s.subtheme ? `<span>${escapeHtml(s.subtheme)}</span>` : ""}
        </div>
        <div class="set-card-value">${confDot}${estMark(s)}${fmtMoney(dispVal)}</div>
        ${(sourceCueHTML(s) || pppBadgeHTML(s) || s.bl_new_qty || s.trend) ? `<div class="set-card-submeta">${sourceCueHTML(s)}${pppBadgeHTML(s)}${s.bl_new_qty ? `<span>${s.bl_new_qty} lots</span>` : ""}${s.trend ? trendBadgeHTML(s.trend) : ""}</div>` : ""}
      </div>
    </button>`;
}

export function renderPile() {
  const photoNeedsSetup = photoScanNeedsSetup();
  $("#root").innerHTML = `
    <div class="page scan-page">
      <div class="topbar">
        <div class="topbar-heading">
          <div class="topbar-eyebrow">Snap &amp; identify</div>
          <h1 class="topbar-title">Scan a set</h1>
        </div>
      </div>

      <section class="card scan-choice" aria-labelledby="scanChoiceTitle">
        <div class="scan-choice-head">
          <div class="scan-choice-mark">${I.sparkles()}</div>
          <div>
            <h2 id="scanChoiceTitle">How would you like to identify it?</h2>
            <p>Use the box barcode, take a photo, or type the number.</p>
          </div>
        </div>

        <div class="scan-method-list" role="group" aria-label="Scan method">
          <button class="scan-method" id="pileScanBarcode" type="button">
            <span class="scan-method-icon scan-method-icon--barcode">${I.scan()}</span>
            <span class="scan-method-copy"><strong>Scan barcode</strong><small>Fastest and free for boxed sets</small></span>
            <span class="scan-method-arrow" aria-hidden="true">${I.arrowR()}</span>
          </button>
          <button class="scan-method${photoNeedsSetup ? ' needs-setup' : ''}" id="pileScanPhoto" type="button"${photoNeedsSetup ? ' aria-describedby="photoScanAvailability"' : ''}>
            <span class="scan-method-icon scan-method-icon--photo">${I.camera()}</span>
            <span class="scan-method-copy"><strong>Identify from photo</strong><small id="photoScanAvailability">${photoNeedsSetup ? 'Sign in or add an AI key first' : 'For built, loose, or boxed sets'}</small></span>
            <span class="scan-method-arrow" aria-hidden="true">${I.arrowR()}</span>
          </button>
        </div>

        <form class="scan-manual-lookup" id="pileManualForm" novalidate>
          <label for="pileManualInput">Set number or barcode</label>
          <div class="scan-manual-lookup-row">
            <input id="pileManualInput" type="text" inputmode="search" autocomplete="off" spellcheck="false" placeholder="71043-1 or UPC">
            <button id="pileManualSubmit" type="submit" aria-label="Look up set">${I.search({ w: 19, h: 19 })}<span>Look up</span></button>
          </div>
          <p class="scan-manual-error" id="pileManualError" role="status" aria-live="polite"></p>
        </form>
      </section>

      <p class="scan-privacy-note">${photoNeedsSetup ? 'Barcode and manual lookup work for guests. Photo identification needs an account or personal AI key.' : 'Photo identification uses your selected AI provider. Images are processed only to identify the set.'}</p>
    </div>`;

  $("#pileScanBarcode")?.addEventListener("click", () => openScan("barcode"));
  $("#pileScanPhoto")?.addEventListener("click", () => openScan("image"));
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
      if (error) error.textContent = e.message || "Check the number and try again.";
      input?.focus();
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}
