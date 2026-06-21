# Brickvault (MyBricks) — Engineering Handoff

A complete, self-contained guide for an AI coding agent (or human) picking up this
project on a new platform. Read this top-to-bottom once; it covers the stack,
where everything lives, the data model, the API, how deploys work (and their
sharp edges), and what changed recently.

- **Live app (PWA):** https://brickvault-5ub.pages.dev
- **Live API (Worker):** https://brickvault-api.zhydenko.workers.dev
- **Repo:** `yarik1390/MyBricks` · working branch `claude/mybricks-lego-app-EdTPX`
- **Cloudflare projects:** Pages project `brickvault`, Worker `brickvault-api`, D1 db `brickvault`

---

## 1. What this is

Brickvault is a **mobile-first PWA for LEGO investors/collectors**. Users log the
sets they own, see each set's current market value and ROI, get AI 2y/5y price
forecasts, browse a ~27k-set catalog with filters and search, scan barcodes to
identify sets, track a wishlist with price-drop alerts, explore minifig values,
see "what can I build" from owned parts, and share a public profile. There's an
AI advisor chat that is portfolio-aware.

Login is **optional**: guests use the app with local-only data (IndexedDB /
localStorage); signing in (Supabase) syncs a real account. The product leans
"investment portfolio for your LEGO."

Scale: D1 holds **~27,074 sets** and **~16,960 minifigs**.

---

## 2. Tech stack & runtime

| Layer | Choice |
|---|---|
| API | **Cloudflare Worker**, TypeScript, **Hono** framework (`worker/src`) |
| Database | **Cloudflare D1** (SQLite), single binding `DB` |
| Cache KV | Cloudflare **KV**, binding `CACHE_KV` |
| Object store | Cloudflare **R2**, binding `PHOTO_BUCKET` (collection photos) |
| Analytics | Cloudflare **Analytics Engine**, binding `ANALYTICS` |
| Auth | **Supabase** JWT — verified in `worker/src/auth.ts` |
| Frontend | **Vanilla JS SPA**, hash routing, **no framework** (`public/js`) ES modules |
| Hosting | Worker (API) + **Cloudflare Pages** (static `public/`) |
| AI | Gemini + OpenAI (server keys or user BYOK headers), via Cloudflare AI Gateway when configured |
| CI/CD | GitHub Actions → `.github/workflows/deploy-worker.yml` (auto-deploy on push) |

Runtime notes:
- Worker `compatibility_flags = ["nodejs_compat"]`, `compatibility_date 2024-09-23`.
- The frontend talks to the API via `window.WORKER_BASE` (injected into
  `public/env.js` at deploy time). In **guest mode** several reads
  (`/api/sets/search`, `/api/sets/:setnum`, `/api/minifigs`) are served
  **client-side** from bundled/cached data and never hit the Worker — keep that
  in mind when "an API change doesn't show up" for logged-out users.

---

## 3. Repository map

```
/
├── CLAUDE.md                 # short agent guide (this doc supersedes/expands it)
├── README.md, a11y/          # docs + accessibility notes
├── migrations/               # historical SQL migrations 001..0xx (reference)
├── seed.sql                  # seed data
├── package.json              # root (frontend test tooling)
├── worker/                   # the API
│   ├── src/
│   │   ├── index.ts          # entry: route registration, CORS, security +
│   │   │                     #   Cache-Control middleware, scheduled() cron switch
│   │   ├── auth.ts           # Supabase JWT verify; requireMember / optionalMember / requireAdmin
│   │   ├── types.ts          # Env (bindings + secrets) and Variables (Hono ctx)
│   │   ├── routes/           # one Hono sub-app per resource (see API table)
│   │   ├── jobs/             # cron handlers (valuate-sets, snapshots, imports, scrapes…)
│   │   ├── lib/              # integrations + pure helpers (see below)
│   │   ├── *.test.ts         # vitest (index, routes, lib, api-quota) — run in workerd
│   ├── schema.sql            # authoritative D1 schema (tables, indexes, FTS, triggers)
│   ├── schema_search_index.sql  # the derived FTS index rebuilder (SQL)
│   ├── schema_migrate.sql    # idempotent column adds
│   ├── wrangler.toml         # bindings, [vars], [triggers] crons
│   └── vitest.config.ts      # @cloudflare/vitest-pool-workers
└── public/                   # the PWA (deployed to Pages)
    ├── index.html            # app shell (#app > main#main-content > #root) + nav
    ├── env.js                # window.WORKER_BASE (rewritten at deploy)
    ├── app.css               # all styles (~3.4k lines); skins via CSS vars
    ├── skin-premium.css      # premium skin overrides
    ├── theme-init.js         # sets data-theme/data-skin before paint
    ├── sw.js                 # service worker (cache versioning; bypasses /api/)
    ├── manifest.json, icons  # PWA manifest + icons
    └── js/
        ├── app.js            # bootstrap, gestures, SW update prompt, router wiring
        ├── router.js         # hash router; per-route render dispatch; FAB visibility
        ├── state.js          # in-memory app state + invalidation
        ├── api.js            # api() fetch wrapper (+ guest API), session, outbox
        ├── utils.js          # $, escapeHtml, parseMarkdown (XSS-safe), fmtMoney, etc.
        ├── icons.js          # inline SVG icon set
        ├── theme.js          # theme/skin preference
        ├── lib/pure.js       # pure helpers (valuationTrust, pricePerPiece, filters)
        ├── lib/morphdom.js   # DOM diffing for re-renders
        ├── lib/local-ai.js   # on-device guest advisor fallback
        ├── views/            # one module per page (portfolio, catalog, minifigs,
        │                     #   me*, build, login)
        └── components/       # advisor (chat drawer), scanner (camera), sheet
                              #   (modal), onboarding, trust, skeleton
```

Key `worker/src/lib` integrations: `bricklink`, `ebay`, `brickeconomy`,
`brickset`, `brickowl-barcode`/`brickowl-pricing`, `brickinsights`, `brightdata`
(eBay-sold scraping), `rebrickable`, `upcitemdb`, `lego-stock`, `gemini`/`llm`,
`valuation` (formula), `market-sources` (blend), `price-trend`,
`retirement-risk`, `search-index` (FTS rebuilder), `api-quota`,
`integration-health`, `scan-match`, `turnstile`, `webpush`, `resend`, `discord`,
`google-sync` helpers.

---

## 4. Data model (D1)

**Tables (24):** `lego_sets`, `lego_themes`, `minifigs`, `set_minifigs`,
`set_parts`, `user_missing_parts`, `set_alt_builds`, `set_alts_fetched`,
`user_collection`, `user_wishlist`, `wishlist_alerts`, `user_prefs`,
`user_showcase`, `user_minifigs`, `user_build_cache`, `portfolio_snapshots`,
`set_value_history`, `api_quota`, `integration_health`, `import_runs`,
`rate_limits`, `oauth_sessions`, `oauth_states`, `push_subscriptions`.

### `lego_sets` (the central catalog table, ~74 columns)

- **Identity/catalog:** `set_num` (PK, form `10026-1`), `name`, `year`, `theme`,
  `subtheme`, `theme_group`, `category`, `pieces`, `minifigs`, `image_url`,
  `retired`, `retired_year`, `upc`, `created_at`.
- **Valuation core:** `retail_price`, `current_value`, `blended_value`,
  `forecast_2y`, `forecast_5y`, `valuation_method` (`formula_bulk`|`market`|
  `brickeconomy`|`ai`|`local`), `valuation_expires_at`, `cached_at`, `source`.
- **BrickLink:** `bl_new_value`, `bl_new_qty`, `bl_new_min`, `bl_new_max`,
  `bl_used_qty`, `bl_used_min`, `bl_used_max`, `bl_cached_at`.
- **eBay:** `ebay_value`, `ebay_cached_at`, `ebay_new_value`, `ebay_new_qty`,
  `ebay_new_cached_at`, `ebay_used_value`, `ebay_used_qty`,
  `ebay_used_cached_at`, `ebay_ask_value`, `ebay_ask_qty`,
  `ebay_ask_cached_at`, `used_value`.
- **BrickEconomy:** `be_cached_at`, `be_growth_12m`.
- **BrickOwl:** `bo_new_value`, `bo_used_value`, `bo_cached_at`.
- **Ratings:** `brickset_rating`, `brickset_review_count`,
  `brickinsights_rating`, `brickinsights_review_count`, `brickinsights_url`,
  `brickinsights_cached_at`.
- **Retirement/stock:** `retirement_risk_score`, `retirement_risk_updated_at`,
  `lego_in_stock`, `lego_retiring_soon`, `lego_checked_at`.
- **Brickset enrichment (Phase 1–3):** `brickset_msrp`, `launch_date`,
  `exit_date`, `brickset_enriched_at` (enriched-once marker for the bulk sweep),
  `brickset_tags`, `brickset_dimensions`, `packaging_type`, `instructions_count`,
  `additional_image_count`, `brickset_description`, `brickset_set_id`,
  `brickset_image_urls`, `brickset_images_cached_at`, `age_min`, `age_max`.

### Search index (FTS5)
- `lego_sets_fts` is an **external-content FTS5** table over **6 columns**:
  `set_num, name, theme, subtheme, theme_group, brickset_tags`.
- Kept in sync by INSERT/DELETE/UPDATE triggers (`lego_sets_ai/ad/au`) AND by a
  JS rebuilder `lib/search-index.ts → rebuildSearchIndex()` used for corruption
  auto-repair. **Both the SQL (`schema_search_index.sql`) and the TS rebuilder
  must list the same 6 columns** — they have drifted before and broken search.

### Indexes (perf-critical)
`lego_sets` has indexes on `theme`, `retired`, `upc`, plus the catalog
filter/sort set added during the audit: `theme_group`, `category`, `year`,
`pieces`, `current_value`, `blended_value`. Plus per-user/junction indexes
(`user_collection(user_id, deleted_at)`, `set_minifigs(set_num/fig_num)`, etc.).

### Valuation & the blend (read this before touching pricing)
- Baseline for most rows is **`formula_bulk`** (`lib/valuation.ts`): a pieces ×
  year × theme × retired heuristic.
- Real signals come from multiple sources: **BrickLink** (workhorse),
  **BrickEconomy**, **eBay ask** (Browse API), **eBay sold** (scraped via Bright
  Data), **BrickOwl**, plus **BrickInsights**/Brickset **ratings** (quality, not
  price).
- `lib/market-sources.ts → enrichSetRecord(row)` is the **read-side** blender: it
  builds `market_sources`, `confidence`, `freshness`, `primary_value_source`,
  `valuation_explanation`, and the v2 fields `market_value` / `_low` / `_high` /
  `_confidence` / `_basis` from the row's per-source columns. `blended_value` is
  **persisted** (so SQL portfolio sums can `COALESCE(blended_value, current_value)`),
  recomputed by `persistBlendedValue` / `recomputeBlendedValues`.
- API budgets are tracked in **`api_quota`** (`lib/api-quota.ts`:
  `spendQuota`/`reserveQuota`; e.g. Brickset cap ~90/day, BrickEconomy ~80/day),
  and per-source health in **`integration_health`**.

---

## 5. API surface

All under `/api`. Mounted in `index.ts`; `app.use('*', optionalMember)` runs on
most sub-apps (guests pass through; `userId` set when a valid JWT is present).
Mutations use `requireMember`; everything under `/api/admin` uses `requireAdmin`
(gated on `ADMIN_USER_ID`).

| Mount | Endpoints (method path) |
|---|---|
| `/api/me` | GET `/`, PATCH `/` |
| `/api/collection` | GET `/`, POST `/`, GET `/export`, GET `/history`, POST `/import`, GET/PATCH/DELETE `/:id`; photos: POST/GET/DELETE `/:id/photo` |
| `/api/wishlist` | GET `/`, POST `/`, POST `/:id`, DELETE `/:id` |
| `/api/sets` | GET `/search`, GET `/:setnum`, GET `/:setnum/images`, GET `/:setnum/parts`, PATCH `/:setnum/parts/:partNumColor`, GET `/:setnum/history`, POST `/:setnum/listing-draft`, POST `/:setnum/revalue` |
| `/api/themes` | GET `/` (theme groups + categories + facets) |
| `/api/minifigs` | GET `/`, GET `/series`, GET `/blindbox`, PUT/DELETE `/:fignum` |
| `/api/scan` | POST `/identify` (barcode/photo → set) |
| `/api/build` | GET `/` (alternate builds), GET `/sets` (buildable-from-owned) |
| `/api/advisor` | POST `/` (AI chat; streaming) |
| `/api/users` | GET `/leaderboard`, GET `/:handle/profile`, POST `/:handle/showcase`, GET `/check-handle/:handle` |
| `/api/google` | OAuth + Sheets sync: `/auth-init`, `/auth`, `/oauth`, `/status`, POST `/sync`, POST `/disconnect` |
| `/api/brickset` | POST `/login`, POST/DELETE `/connect`, POST `/sync` |
| `/api/bricklink` | POST `/import-csv` |
| `/api/rates` | GET `/` (FX rates) |
| `/api/push` | GET `/vapid-key`, POST/DELETE `/subscribe` |
| `/api/admin` | `/import-rebrickable`, `/import-status[/:id]`, `/backfill-upc`, `/populate-coverage`, `/revalue-brickeconomy`, `/populate-everything`, `/expire-valuations`, `/integrations`, `/repair-search-index` |
| `/api/config` | public client-safe config (Supabase url/anon key, integration status flags) |

Behavioral notes:
- `GET /api/sets/:setnum` only calls the live Brickset API when the row is
  **not yet enriched** (`brickset_enriched_at IS NULL`) — enriched rows return
  stored `brickset_*` instantly (perf gate from the audit).
- `GET /api/sets/search` projects an **explicit ~46-column catalog-card list**
  (not `SELECT s.*`) to keep the payload small; the detail endpoint still
  `SELECT *`s the full row. Dynamic WHERE/ORDER BY are parameterized and
  whitelisted via a `SORTS` map (no SQL injection).
- AI BYOK: clients may send `X-Gemini-Key` / `X-OpenAI-Key` headers; these are
  used per-request and **never persisted**.

---

## 6. Frontend architecture

- **Routing:** hash-based in `router.js`. **Route names don't match labels** —
  be careful: Vault=`#/`, **Catalog=`#/add`**, **Scan=`#/pile`**,
  Minifigs=`#/minifigs`, Build=`#/build`, Me=`#/me` (+ `/me/integrations`,
  `/me/data`, `/me/admin`), set detail=`#/set/:setnum[/info|forecast]`,
  wishlist=`#/wishlist`, leaderboard=`#/leaderboard`, public profile=`#/u/:handle`.
- **Rendering:** views build template-literal HTML strings, mounted via
  `morphdom` diffing; events use delegation/`addEventListener` (no framework).
- **State:** `state.js` (in-memory) + IndexedDB hydration (`bvIDB`) +
  localStorage (guest vault, BYOK keys). `api.js` has an offline **outbox** for
  queued mutations.
- **AI advisor FAB:** `#advisorFab` shown on all routes **except** the Scan
  camera (`/pile`) and login (recently changed — it used to be hidden on Catalog
  and Minifigs too).
- **Service worker (`sw.js`):** versioned caches (`STATIC_CACHE`/`API_CACHE` keyed
  on `VERSION`). Static assets are network-first; **`/api/` requests are
  deliberately bypassed** (`if (url.pathname.startsWith('/api/')) return;`) so the
  SW never serves stale data. An "Update ready" prompt appears on new SW.
  **Current version: `v149`.**
- **Themes/skins:** attribute-based — `:root[data-theme="dark"]` and
  `:root[data-skin="premium"]` (default skin "retro": parchment + pixel
  shadows). `theme-init.js` applies them pre-paint to avoid flashes.
- **Security:** `parseMarkdown()` in `utils.js` escapes HTML *before* applying
  safe tag transforms (XSS-safe); AI output flows through it.

---

## 7. Deploy & CI pipeline

Push to `main` or the dev branch → **`.github/workflows/deploy-worker.yml`**
runs (in order): install deps → **frontend tests** → **Typecheck Worker** →
**Worker tests (vitest in workerd)** → create/find D1 + KV + R2 + Analytics →
wrangler dry-run → **apply `schema.sql`** → **apply column migrations**
(hardcoded idempotent ALTER list) → **rebuild derived search index**
(`schema_search_index.sql`) → validate schema → **deploy Worker** → **upload
Worker secrets** → **inject Worker URL into `public/env.js`** → **deploy Pages**
→ public + protected **smoke checks** → kick off data population.

Other workflows: `a11y.yml` (accessibility), `populate-production.yml` (data
backfill against `brickvault-api.zhydenko.workers.dev`).

Poll runs at `https://api.github.com/repos/yarik1390/MyBricks/actions/runs`
(unauthenticated is fine but IP-rate-limited; check-run **annotations** expose
vitest failures when full logs require admin rights).

### ⚠️ Hard constraints (these have bitten us — respect them)
1. **Cannot push `.github/workflows/`** via the GitHub app integration (403 — no
   `workflows` permission). Workflow edits must be done by a human/PR.
2. **Adding a D1 column requires two places:** add it to `schema.sql` AND to the
   workflow's hardcoded **"Apply column migrations"** ALTER list (the workflow is
   how prod gets new columns). New columns/indexes can also be applied live via a
   scoped Cloudflare D1 token, then reasserted idempotently in `schema.sql`.
3. **FTS sync:** if you add a searchable column, update BOTH
   `schema_search_index.sql` and `lib/search-index.ts` (`rebuildSearchIndex`) to
   the same column list, or search silently degrades after the next auto-repair.
4. **Bump `public/sw.js` `VERSION`** on ANY static-asset change (CSS/JS/HTML), or
   clients keep the cached old files.
5. **Worker test fixtures hand-roll a partial `lego_sets`** in
   `worker/src/routes.test.ts`. `SELECT s.*` tolerated missing columns; an
   **explicit column projection does not** — any column you project in `/search`
   must also be declared in that test fixture, and the search-index trigger
   assertion there must match the FTS column list.
6. **Some secrets are dashboard-managed**, not in the workflow's upload list
   (e.g. Bright Data / UPCitemdb keys) — don't assume every secret round-trips
   through CI.

### Safe-change checklist
- Worker-only logic change → edit `worker/src/**`, keep tests green, push. No SW bump.
- Static asset change → edit `public/**`, **bump `sw.js` VERSION**, push.
- New D1 column → `schema.sql` + workflow ALTER list (+ FTS files if searchable).
- Always: run/verify `worker` vitest locally if possible; the deploy gate runs
  Typecheck + frontend tests + Worker tests before it will deploy.

---

## 8. Environment variables & secrets (names only)

Set as Worker secrets (via CI "Upload Worker secrets" and/or the Cloudflare
dashboard); local dev uses `worker/.dev.vars` (see `.dev.vars.example`).

**Auth/identity:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`
(HS256 verify; ES256/RS256 fall back to the project JWKS), `ADMIN_USER_ID`.

**Pricing/catalog APIs:** `BRICKLINK_CONSUMER_KEY`, `BRICKLINK_CONSUMER_SECRET`,
`BRICKLINK_TOKEN`, `BRICKLINK_TOKEN_SECRET`, `BRICKECONOMY_API_KEY`,
`BRICKOWL_API_KEY`, `BRICKSET_API_KEY`, `REBRICKABLE_API_KEY`, `EBAY_APP_ID`,
`EBAY_CLIENT_SECRET`. (Dashboard-managed extras seen in prod: a Bright Data
token, a UPCitemdb key.)

**AI:** `GEMINI_API_KEY`, `OPENAI_API_KEY` (+ non-secret `AI_GATEWAY_ID` var, and
an `AI_GATEWAY_ACCOUNT_ID` secret that activates gateway routing). Users can also
supply their own via `X-Gemini-Key` / `X-OpenAI-Key` request headers.

**Notifications/integrations:** `RESEND_API_KEY` (email), `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (web push), `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` (Sheets sync).

**Bindings (wrangler.toml):** `DB` (D1), `CACHE_KV` (KV), `PHOTO_BUCKET` (R2),
`ANALYTICS` (Analytics Engine). **Never log secret values; `/api/config` only
exposes client-safe values.**

### Cron schedule (`wrangler.toml [triggers]` → `index.ts` `scheduled()` switch)
| Cron (UTC) | Job(s) |
|---|---|
| `0 * * * *` | valuate owned-deep, catalog coverage, eBay-ask backfill, top-value freshness |
| `15 * * * *` | formula head revaluation |
| `30 * * * *` | UPCitemdb barcode backfill |
| `0 2` | snapshot portfolios |
| `0 3` | snapshot set values |
| `0 4` | db-hygiene + daily catalog maintenance (+ Sundays: weekly set/fig import) |
| `0 5` | minifig valuation |
| `0 6` | BrickInsights ratings backfill |
| `0 7` | eBay-sold scrape (Bright Data) |
| `0 8` | wishlist price-drop alerts |

---

## 9. Conventions & patterns

- **Hono sub-app per resource** in `routes/`; register specific paths before
  `:param` routes; prepared statements via `c.env.DB.prepare(...).bind(...)`.
- **D1 limits:** ≤100 bound params/query, ≤100 KB/statement, batch ≤100
  statements, 30s/query. Bulk writes are chunked (e.g. 90/ batch).
- **Quota + health:** wrap external calls so they spend `api_quota` and record
  `integration_health`; circuit-break on repeated failures.
- **CORS** (`index.ts`) reflects any `*.pages.dev` + localhost origin; default
  origin `https://brickvault-5ub.pages.dev`. Sets `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.
- **Cache-Control** (`index.ts`): anonymous GETs to
  `/api/{sets,themes,minifigs,rates,config}` return
  `public, max-age=120, s-maxage=300, stale-while-revalidate=600` +
  `Vary: Origin, Authorization`; everything authenticated/mutating/other is
  `no-store`.
- **Deploys in this repo** are made as **anchored full-file commits** (replace
  exact strings; the GitHub app commits whole files) — always base edits on
  **current HEAD** to avoid reverting a teammate's change.
- **Artifacts/placeholders, morphdom renders, `parseMarkdown` escaping** — keep
  these patterns; don't introduce a framework.

---

## 10. Gotchas & pitfalls

- **Route labels ≠ route names:** Catalog is `#/add`, Scan is `#/pile`. The
  on-screen nav labels are remapped in `index.html`. Don't trust the label.
- **Guest mode bypasses the Worker** for catalog/detail/minifig reads — a Worker
  change won't be visible logged-out.
- **`SELECT *` masks schema drift in tests.** Explicit projections need matching
  test-fixture columns (see constraint #5).
- **FTS rebuilder/SQL drift** silently breaks search after corruption
  auto-repair — keep the 6-column list identical in both files.
- **Brickset set numbers need the variant** (`10026-1`, not `10026`) or lookups
  return zero matches (this was a real Phase-1 bug).
- **`brickset_enriched_at`** gates both the bulk sweep and the live set-detail
  fetch; clearing it forces re-enrichment (do it AFTER deploying new parser/columns).
- **Chart swipes:** `.spark-wrap` charts scrub on a passive `touchmove`; they need
  `touch-action: pan-y` or a horizontal swipe pans the page (caused a persistent
  "space on the right"). Fixed; don't remove it.
- **MCP/transport flakiness** in the build environment is common; retries usually
  succeed — not an app bug.

---

## 11. Recent-changes changelog

Newest first. (Service-worker `VERSION` in parentheses where relevant.)

**Audit §12 follow-ups (v149)** — security + perf + code-split (commits
`4c9f9cd`, `3d0a933`).
- **Security:** CORS reflection scoped to this project's own Pages origins
  (`brickvault-5ub.pages.dev` + `*.brickvault-5ub.pages.dev` previews) instead of
  any `*.pages.dev` tenant (+ `index.test.ts` regression tests); the CSP is now
  delivered as an HTTP header in `public/_headers` (so `frame-ancestors` actually
  enforces), not just the `index.html` `<meta>`; removed the duplicate
  `Vary: Origin` token (`index.ts` sets `Vary: Authorization`, CORS appends `Origin`).
- **Speed:** the Rebrickable search-fallback N+1 is collapsed into a single
  `IN (...)` lookup; explicit columns on the last list-level `SELECT *`
  (`wishlist_alerts`).
- **Code-split:** `router.js` loads each view via dynamic `import()`; the
  onboarding carousel, the AI advisor and the camera scanner are lazy-loaded via
  `components/advisor-lazy.js` / `scanner-lazy.js` (router-called
  `cancelActiveStream()` / `closeScan()` are safe no-ops until first open).
- **UI:** dropped the global document-scrollbar hide, keeping only the
  `overflow-x` pan guard, so the scrollbar returns on desktop.

**UI fixes**
- **Chart-swipe page drift (v147):** `touch-action: pan-y` on `.spark-wrap` +
  `html { overflow-x: hidden }` guard — a horizontal swipe on the price-history
  chart no longer pans the page right (the "space on the right" bug).
- **AI assistant visibility + scrollbar (v146):** advisor FAB now shows on
  Catalog/Minifigs/Build (was hidden); document scrollbar hidden to avoid a
  gutter reserving width.

**Security / Speed / Responsiveness audit** (app found genuinely strong: no
SQLi/IDOR, solid JWT auth, XSS-careful, rate-limited — only defense-in-depth gaps)
- **Speed:** added 6 catalog D1 indexes (filters were full-scanning ~27k rows);
  gated the set-detail Brickset live fetch on `brickset_enriched_at`; made public
  catalog GETs cacheable (scoped `Cache-Control`); projected an explicit 46-column
  list in `/search` instead of `SELECT s.*` (~47% smaller payload on rich pages).
- **Responsiveness (v145):** iOS input zoom fix (inputs → 16px), `detail-img`
  `min(…vw)` so it can't overflow ≤320px, toast safe-area, 44px touch targets,
  body scroll-lock for sheets/advisor, Top-Movers name truncation.

**Catalog data phases (Brickset enrichment)**
- **Phase 1a/1b:** official Brickset MSRP → `retail_price` surface, launch/exit
  dates; bulk barcode sweep extended to backfill `brickset_msrp`/`launch_date`/
  `exit_date` catalog-wide.
- **Phase 2:** `theme_group`/`category`/`brickset_tags` → catalog filters, chips,
  and 6-column FTS search (+ fixed the rebuilder that reverted the index to 3 cols).
- **Phase 3a:** dimensions/packaging/instructions_count/additional_image_count/
  description columns + "Set Facts" + "About this set" cards (HTML sanitized).
- **Phase 3b:** on-demand image gallery via Brickset `getAdditionalImages`.

**Set-detail UX polish:** collapsible long descriptions, swipe-vs-tab fixes,
price-line layout fixes (price always fully visible on its own line), minifig
silhouette placeholder hidden behind loaded photos.

**Valuation/data sourcing (earlier):** multi-source blend (BrickLink +
BrickEconomy + eBay ask + scraped eBay sold via Bright Data + BrickOwl), blend
confidence, BrickInsights ratings, persisted `blended_value`, admin coverage
readout, per-user build cache, parts-based "what can I build."

---

## 12. Audit follow-ups — status

All seven items reported during the audit are **done**, in commits `4c9f9cd` and
`3d0a933` on `claude/mybricks-lego-app-EdTPX` (kept here for traceability):

1. **CSP — done.** A strict CSP already shipped as an `index.html` `<meta>`; it's
   now also delivered as an HTTP response header in `public/_headers`, so
   `frame-ancestors 'none'` actually enforces (it's inert in a meta tag) and the
   policy applies before parse. Verified live (header present on the document).
2. **Tighten CORS — done.** `index.ts` reflects only localhost and this project's
   own Pages origins (`brickvault-5ub.pages.dev` + its
   `*.brickvault-5ub.pages.dev` previews), not any `*.pages.dev` tenant.
   Regression tests in `index.test.ts`.
3. **Explicit column projections — done.** portfolio/build/minifigs already
   projected explicit columns; the last list-level `SELECT *`
   (`wishlist_alerts`, `routes/wishlist.ts`) now does too.
4. **Code-split — done.** `router.js` loads each view via dynamic `import()` on
   first navigation (was eager). The onboarding carousel and the two heavy
   components — the AI advisor (`advisor.js`) and camera scanner (`scanner.js`) —
   are lazy-loaded behind `components/advisor-lazy.js` and `scanner-lazy.js`.
   **Contract:** the router calls `cancelActiveStream()` / `closeScan()` on every
   navigation; the lazy wrappers make these **safe no-ops until the module has
   first been opened** (a stream/overlay can't exist before then). Preserve that
   if you touch the wrappers. SW `VERSION` → `v149`.
5. **Rebrickable search N+1 — done.** The search fallback batches all candidate
   set-number lookups into one `IN (...)` query (≤40 bound params) instead of a
   per-result `SELECT`.
6. **`Vary` header — done.** `index.ts` sets `Vary: Authorization` and lets CORS
   append `Origin`, removing the duplicate `Origin` token.
7. **Global scrollbar-hide — done (removed).** `app.css` no longer hides the
   document scrollbar; only the `overflow-x` pan guard remains (the chart-swipe
   bug is fixed via `touch-action: pan-y` on `.spark-wrap`), so desktop keeps its
   scrollbar / scroll-position affordance.

### Still open / smaller ideas
- (Cosmetic) a transient "You're offline — showing cached data" banner can flash
  on first load before the connectivity probe settles; harmless but smoothable.
- Further code-splitting is largely covered now (per-route views, lazy advisor/
  scanner/onboarding, and `lib/local-ai.js` already loads on demand).

---

*Generated as a project handoff snapshot at repo HEAD `bdb51ac`. Verify against
the live repo before relying on any specific line — the structure is stable but
exact line numbers drift.*
