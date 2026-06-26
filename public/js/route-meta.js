const ROUTES = [
  { match: (hash) => hash === "/" || hash === "", key: "vault", nav: "/", title: "Vault" },
  { match: (hash) => hash === "/add", key: "catalog", nav: "/add", title: "Catalog" },
  { match: (hash) => hash === "/pile", key: "scan", nav: "/pile", title: "Scan", fullscreen: true },
  { match: (hash) => hash === "/minifigs", key: "minifigs", nav: "/minifigs", title: "Minifigs" },
  { match: (hash) => hash === "/build", key: "build", nav: "/", title: "Build" },
  { match: (hash) => hash === "/wishlist", key: "wishlist", nav: "/", title: "Wishlist" },
  { match: (hash) => hash === "/leaderboard", key: "leaderboard", nav: "/me", title: "Leaderboard" },
  { match: (hash) => hash.startsWith("/u/"), key: "public-profile", nav: "/me", title: "Public profile" },
  { match: (hash) => hash.startsWith("/set/"), key: "set-detail", nav: "/", title: "Set detail" },
  { match: (hash) => hash === "/me" || hash.startsWith("/me/"), key: "me", nav: "/me", title: "Me" },
  { match: (hash) => hash === "/login", key: "login", nav: null, title: "Sign in", fullscreen: true },
];

export function normalizeRouteHash(hash = "/") {
  return (String(hash || "/").replace(/^#/, "") || "/").split("?")[0];
}

export function routeMetaFor(hash = "/") {
  const normalized = normalizeRouteHash(hash);
  const found = ROUTES.find(route => route.match(normalized));
  return found
    ? { key: found.key, nav: found.nav, title: found.title, fullscreen: !!found.fullscreen }
    : { key: "unknown", nav: null, title: "Brickvault", fullscreen: false };
}
