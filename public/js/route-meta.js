const ROUTES = [
  // 2026 redesign routes (one line each; areas own their flags).
  { match: (hash) => hash === "/changes", key: "changes", nav: "/", title: "What changed", fab: false, navOff: true },
  { match: (hash) => hash === "/insights", key: "insights", nav: "/", title: "Insights", fab: false, navOff: true },
  { match: (hash) => hash === "/retiring", key: "retiring", nav: "/add", title: "Retiring soon", fab: false },
  { match: (hash) => hash === "/me/notifications", key: "notifications", nav: "/me", title: "Notifications", fab: false, navOff: true },
  { match: (hash) => hash === "/me/insurance", key: "insurance", nav: "/me", title: "Insurance report", protected: true, fab: false, navOff: true },
  { match: (hash) => hash === "/pro", key: "pro", nav: "/me", title: "BricksVault Pro", fab: false, navOff: true },
  { match: (hash) => hash === "/wrapped", key: "wrapped", nav: "/me", title: "Brick Wrapped", fullscreen: true, fab: false },
  { match: (hash) => hash === "/advisor", key: "advisor", nav: "/", title: "Advisor", fab: false, navOff: true },
  { match: (hash) => hash === "/welcome" || hash.startsWith("/welcome/"), key: "welcome", nav: null, title: "Welcome", fullscreen: true, fab: false },
  { match: (hash) => hash === "/room", key: "collection-room", nav: "/", title: "Collection room", fullscreen: true, fab: false },
  { match: (hash) => hash === "/collections", key: "collections", nav: "/", title: "Collections", fab: false },
  { match: (hash) => hash === "/" || hash === "", key: "vault", nav: "/", title: "Vault", fab: true, scanFab: true },
  { match: (hash) => hash === "/add", key: "catalog", nav: "/add", title: "Catalog", fab: true, scanFab: true },
  { match: (hash) => hash === "/pile", key: "scan", nav: "/pile", title: "Scan a set", fullscreen: true, fab: false },
  { match: (hash) => hash === "/minifigs", key: "minifigs", nav: "/", title: "Minifigs", fab: true, scanFab: true },
  // "What can I build" is a Vault section (Sets · Minifigs · Lists · Build).
  { match: (hash) => hash === "/build", key: "build", nav: "/", title: "Build", fab: true },
  { match: (hash) => hash === "/wishlist", key: "wishlist", nav: "/wishlist", title: "Wishlist", fab: true },
  // Price game shows real market values — like all pricing surfaces, it stays
  // out of Kids Mode (not in KIDS_ALLOWED).
  { match: (hash) => hash === "/game", key: "game", nav: "/", title: "Price It!", fab: false },
  { match: (hash) => hash === "/leaderboard", key: "leaderboard", nav: "/me", title: "Leaderboard", fab: true },
  { match: (hash) => hash.startsWith("/u/"), key: "public-profile", nav: "/me", title: "Public profile", fab: true },
  // nav: null — a set can be reached from Vault, Catalog or Minifigs, so
  // highlighting any one tab (it used to light up Vault) is misleading.
  { match: (hash) => hash.startsWith("/set/"), key: "set-detail", nav: null, title: "Set detail", fab: true },
  { match: (hash) => hash === "/me/admin", key: "admin", nav: "/me", title: "Admin", protected: true, fab: false },
  { match: (hash) => hash === "/me/integrations", key: "integrations", nav: "/me", title: "Integrations", protected: true, fab: false },
  { match: (hash) => hash === "/me/data", key: "data", nav: "/me", title: "Data", protected: true, fab: false },
  // Me is account/settings, not collection browsing — hide the advisor FAB so it
  // doesn't float over the Appearance toggle and other bottom-of-card controls.
  { match: (hash) => hash === "/me" || hash.startsWith("/me/"), key: "me", nav: "/me", title: "Me", fab: false },
  { match: (hash) => hash === "/login", key: "login", nav: null, title: "Sign in", fullscreen: true, fab: false },
  { match: (hash) => hash === "/kids", key: "kids", nav: "/", title: "Kids Vault", fab: false },
  { match: (hash) => hash === "/kids/badges", key: "kids-badges", nav: "/kids/badges", title: "Badges", fab: false },
];

// In Kids Mode the app is locked to a price-free sandbox. Only these routes are
// reachable; everything else (set detail, /me, wishlist, leaderboard, minifigs,
// build, public profiles) is redirected to the kids home. Catalog (/add) and
// Scan (/pile) stay open so a child can add sets and earn XP.
const KIDS_ALLOWED = new Set(["/kids", "/kids/badges", "/add", "/pile", "/login"]);

export function allowedInKidsMode(hash) {
  return KIDS_ALLOWED.has(normalizeRouteHash(hash));
}

export function normalizeRouteHash(hash = "/") {
  return (String(hash || "/").replace(/^#/, "") || "/").split("?")[0];
}

export function routeMetaFor(hash = "/") {
  const normalized = normalizeRouteHash(hash);
  const found = ROUTES.find(route => route.match(normalized));
  return found
    ? { key: found.key, nav: found.nav, title: found.title, fullscreen: !!found.fullscreen, protected: !!found.protected, fab: found.fab !== false, scanFab: !!found.scanFab, navOff: !!found.navOff }
    : { key: "unknown", nav: null, title: "BricksVault", fullscreen: false, protected: false, fab: true, scanFab: false, navOff: false };
}
