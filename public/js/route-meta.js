const ROUTES = [
  { match: (hash) => hash === "/" || hash === "", key: "vault", nav: "/", title: "Vault", fab: true },
  { match: (hash) => hash === "/add", key: "catalog", nav: "/add", title: "Catalog", fab: true },
  { match: (hash) => hash === "/pile", key: "scan", nav: "/pile", title: "Scan a set", fullscreen: true, fab: false },
  { match: (hash) => hash === "/minifigs", key: "minifigs", nav: "/minifigs", title: "Minifigs", fab: true },
  { match: (hash) => hash === "/build", key: "build", nav: "/", title: "Build", fab: true },
  { match: (hash) => hash === "/wishlist", key: "wishlist", nav: "/", title: "Wishlist", fab: true },
  { match: (hash) => hash === "/leaderboard", key: "leaderboard", nav: "/me", title: "Leaderboard", fab: true },
  { match: (hash) => hash.startsWith("/u/"), key: "public-profile", nav: "/me", title: "Public profile", fab: true },
  { match: (hash) => hash.startsWith("/set/"), key: "set-detail", nav: "/", title: "Set detail", fab: true },
  { match: (hash) => hash === "/me/admin", key: "admin", nav: "/me", title: "Admin", protected: true, fab: false },
  { match: (hash) => hash === "/me/integrations", key: "integrations", nav: "/me", title: "Integrations", protected: true, fab: false },
  { match: (hash) => hash === "/me/data", key: "data", nav: "/me", title: "Data", protected: true, fab: false },
  { match: (hash) => hash === "/me" || hash.startsWith("/me/"), key: "me", nav: "/me", title: "Me", fab: true },
  { match: (hash) => hash === "/login", key: "login", nav: null, title: "Sign in", fullscreen: true, fab: false },
  { match: (hash) => hash === "/kids", key: "kids", nav: "/kids", title: "Kids Vault", fab: false },
  { match: (hash) => hash === "/kids/badges", key: "kids-badges", nav: "/kids/badges", title: "Badges", fab: false },
];

export function normalizeRouteHash(hash = "/") {
  return (String(hash || "/").replace(/^#/, "") || "/").split("?")[0];
}

export function routeMetaFor(hash = "/") {
  const normalized = normalizeRouteHash(hash);
  const found = ROUTES.find(route => route.match(normalized));
  return found
    ? { key: found.key, nav: found.nav, title: found.title, fullscreen: !!found.fullscreen, protected: !!found.protected, fab: found.fab !== false }
    : { key: "unknown", nav: null, title: "Brickvault", fullscreen: false, protected: false, fab: true };
}
