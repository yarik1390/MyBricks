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
  blind: { items: [], total: 0, offset: 0, hasMore: false, loading: false, ownedCount: 0, pageSize: 30 },
  themes: [], themesLoadedAt: 0,
  me: null,
  compactView: localStorage.getItem("bv_compact_view") === "true",
  portfolioTab: "items",
  selectionMode: false,
  selectedSets: new Set(),
  filter: {
    kind: "all", theme: null, range: "1M", q: "",
    sort: localStorage.getItem("bv_sort") || "added_desc",
    catalogQ: "",
    catalogSort: "value_desc", catalogYear: "all",
    catalogRetired: "all", catalogTheme: "all",
    catalogRanges: { min_year: "", max_year: "", min_pieces: "", max_pieces: "", min_value: "", max_value: "" },
    wishlistSort: "recent",
    figQ: "", figRarity: "all", figOwned: "all", figSort: "rarity_desc", figSeries: "all",
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
  state._revalToken = (state._revalToken || 0) + 1;
  bvIDB.del('portfolio').catch(() => {});
}
