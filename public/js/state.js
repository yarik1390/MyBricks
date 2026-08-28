import { bvIDB } from './utils.js';

// Corrupted localStorage must not crash module init — fall back to empty.
function safeParseArray(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

export const state = {
  config: null,
  portfolio: null,
  catalog: { items: [], total: 0, offset: 0, hasMore: false, loading: false, pageSize: 24 },
  // Set of set_nums the user owns — powers the catalog "OWNED" badge (any mode).
  ownedSetNums: new Set(),
  ownedSetNumsLoaded: false,
  blind: { items: [], total: 0, offset: 0, hasMore: false, loading: false, ownedCount: 0, pageSize: 30 },
  themes: [], themeGroups: [], categories: [], themesLoadedAt: 0,
  me: null,
  compactView: (() => {
    // Default to the image-forward 2-col GRID everywhere (halves catalog scroll
    // depth on phones vs the tall list rows). A user's explicit toggle wins.
    const saved = localStorage.getItem("bv_compact_view");
    return saved != null ? saved === "true" : false;
  })(),
  portfolioTab: "items",
  selectionMode: false,
  selectedSets: new Set(),
  filter: {
    kind: "all", theme: null, range: "1M", q: "",
    sort: localStorage.getItem("bv_sort") || "added_desc",
    catalogQ: "",
    catalogSort: "year_desc", catalogYear: "all",
    catalogRetired: "all", catalogTheme: "all",
    catalogThemeGroup: "all", catalogCategory: "all",
    catalogRanges: { min_year: "", max_year: "", min_pieces: "", max_pieces: "", min_value: "", max_value: "" },
    wishlistSort: "recent",
    figQ: "", figRarity: "all", figOwned: "all", figSort: "year_desc", figSeries: "all",
  },
  detail: { tab: "info", cache: {} },
  pwa: { deferredPrompt: null },
  wishlist: [], wishlistAlerts: [],
  recentWishlistDeletes: {},
  portfolioHistory: null,
  ownedFigs: new Set(safeParseArray("bv_figs")),
  toastTimer: null,
  camera: { stream: null, mode: "barcode", detector: null, scanning: false, timer: null },
  pendingRequests: new Set(),
};

/** Clear the in-memory portfolio AND the IDB cache so the next
 *  renderPortfolio() always fetches fresh from the API.
 *  Incrementing _revalToken cancels any in-flight background revalidation
 *  so it can't overwrite the fresh data fetched after a mutation. */
export function invalidatePortfolio() {
  state.portfolio = null;
  state.me = null;
  // Any collection mutation invalidates the once-per-session ownership snapshot.
  // The next catalog visit must reconcile it with the authoritative collection,
  // otherwise a deleted set can retain an Android-cached OWNED badge.
  state.ownedSetNumsLoaded = false;
  state._revalToken = (state._revalToken || 0) + 1;
  bvIDB.del('portfolio').catch(() => {});
}

/** Keep the client-side "owned" set and the cached set-detail snapshot in sync
 *  when a set is added to / removed from the vault, so the catalog OWNED badge
 *  and the set page reflect the change immediately without a page refresh. On
 *  removal we also drop the cached detail entry (which still says "owned") so
 *  reopening the set shows the Add action. */
export function markSetOwned(setNum, owned) {
  if (!setNum) return;
  if (owned) {
    state.ownedSetNums.add(setNum);
  } else {
    state.ownedSetNums.delete(setNum);
    if (state.detail && state.detail.cache) delete state.detail.cache[setNum];
  }
}
