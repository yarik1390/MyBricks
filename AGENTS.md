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
        ├── views/            # one module per page: portfolio (vault + insights +
        │                     #   bulk-select), portfolio-detail (set page),
        │                     #   portfolio-wishlist, portfolio-social (leaderboard +
        │                     #   public profiles), catalog, minifigs, me*, build, login
        └── components/       # advisor (chat drawer), scanner (camera), sheet
                              #   (modal), onboarding, trust, skeleton, flip-calc
```

> **Per-view split:** `portfolio.js` was decomposed into per-view modules
> (`portfolio-detail`, `portfolio-wishlist`, `portfolio-social`) plus a shared
> `components/flip-calc`. The router lazy-loads each via `import()`, so the
> per-view modules may import shared helpers **back** from `portfolio.js`
> (e.g. `refreshNavBadge`, `spikeAlertCardHTML`) — that's one-way, no cycle.
> Each new module **must** be added to `STATIC_ASSETS` in `sw.js` (with a VERSION
> bump) or offline route navigation to it will 404.

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

### User contributions (admin-reviewed)
Three tables share one moderation lifecycle (`status` pending→approved/rejected,
`reviewer_id`, `review_note`, `reviewed_at`, `deleted_at` soft-delete):
- `set_reviews` — 1–5 star rating + optional title/body; one live row per
  `(user_id, set_num)` (partial unique index). Aggregate avg/count uses only
  `status='approved'`.
- `set_photos` — shared gallery; bytes in `PHOTO_BUCKET` (R2) under
  `set-photos/{set_num}/{user-ts}.{ext}`, `r2_key` stored in the row.
- `set_contributions` — data fixes: `kind ∈ barcode|price|image|partlist|metadata`,
  `payload` JSON. **Only `barcode` auto-applies** on approve
  (`UPDATE lego_sets SET upc=…` when empty); `price` is shown as a community
  data point (not merged into the blend); the rest are manual-action reports.
Submissions are throttled via `rate_limits` (endpoint `'contributions'`, 10/day,
×5 for supporters). Surfaced in the set-detail **Community** tab; moderated from
the admin console; contributors see status + approved-count at `#/me/contributions`.

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
| `/api/collection` | GET `/`, POST `/`, GET `/export` (tiered: free = entered data only, Pro adds current_value/retail_price/roi_pct), GET `/history` (free capped 90d, Pro 365d; returns `{snapshots, days, pro}`), POST `/import`, GET/PATCH/DELETE `/:id`; photos: POST/GET/DELETE `/:id/photo` |
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
| `/api/contributions` | user contributions (admin-reviewed): POST `/reviews`, POST `/photos/:setNum` (multipart→R2), POST `/data`, GET `/sets/:setNum` (approved bundle), GET `/photos/file/:id`, GET `/mine`, DELETE `/:type/:id` (withdraw pending) |
| `/api/admin` | `/import-rebrickable`, `/import-status[/:id]`, `/backfill-upc`, `/populate-coverage`, `/revalue-brickeconomy`, `/populate-everything`, `/expire-valuations`, `/integrations`, `/repair-search-index`, `/contributions` (queue), PATCH `/contributions/:type/:id` (approve/reject), PATCH `/users/:userId/supporter` |
| `/api/config` | public client-safe config (Supabase url/anon key, integration status flags, `patreon_url`) |

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
wrangler dry-run → **apply `schema.sql`** (also bootstraps the FTS search index
idempotently — there is deliberately NO per-deploy rebuild step; force one via
`schema_search_index.sql` or POST `/api/admin/repair-search-index`) → **apply
column migrations** (every `ALTER … ADD COLUMN` grepped out of
`schema_migrate.sql`, applied per-statement) → validate schema → **deploy
Worker** → **upload Worker secrets** → **inject Worker URL into
`public/env.js`** → **deploy Pages** → public + protected **smoke checks** →
kick off data population (main-branch or manual deploys only — dev-branch
pushes skip it; the nightly `populate-production.yml` cron covers freshness).

Other workflows: `a11y.yml` (accessibility), `populate-production.yml` (data
backfill against `brickvault-api.zhydenko.workers.dev`), `backup-d1.yml`
(nightly D1→R2 dump), `d1-cost-watchdog.yml` (daily GraphQL check of D1 rows
written/read vs thresholds; fails loudly + optional `DISCORD_OPS_WEBHOOK`
ping — needs "Account Analytics: Read" on the CF token), and
`restore-drill.yml` (monthly: restores the newest R2 dump into a scratch D1,
validates core tables, deletes the scratch — proves backups are restorable).

Poll runs at `https://api.github.com/repos/yarik1390/MyBricks/actions/runs`
(unauthenticated is fine but IP-rate-limited; check-run **annotations** expose
vitest failures when full logs require admin rights).

### ⚠️ Hard constraints (these have bitten us — respect them)
1. **Cannot push `.github/workflows/`** via the GitHub app integration (403 — no
   `workflows` permission). Workflow edits must be done by a human/PR.
2. **Adding a D1 column — NO workflow edit needed (since 2026-06):** add it in two
   version-controlled SQL files: (a) the `CREATE TABLE` in `schema.sql` (fresh
   DBs) and (b) ONE single-line `ALTER TABLE … ADD COLUMN …;` in
   `schema_migrate.sql` (existing DBs). The deploy step "Apply column migrations"
   greps every `ALTER … ADD COLUMN` line out of `schema_migrate.sql` and runs each
   independently (tolerating only duplicate-column errors), so `schema_migrate.sql`
   is the **single source of truth** — the old inline ALTER array in the workflow
   is gone. Both files are pushable by the GitHub app (no `.github/workflows/`
   change). Keep each ALTER on its own line so the grep picks it up. ⚠️ If the
   Worker *queries* the new column, also add it to the **"Validate schema before
   deploy"** probe list so a silently-failed migration fails the deploy instead of
   shipping a broken DB — that probe edit IS a `.github/workflows/` change
   (human/PR), but it's optional hardening, not required for the column to work.
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
- New D1 column → `schema.sql` CREATE TABLE + one `ALTER … ADD COLUMN` line in
  `schema_migrate.sql` (no workflow edit). If searchable, also update the FTS
  column list in BOTH `schema_search_index.sql` and `lib/search-index.ts`. If the
  Worker queries it, optionally add it to the workflow's "Validate schema" probe
  (human/PR) for a hard guard.
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
| `0 * * * *` | valuate: owned-deep + catalog coverage + eBay-ask backfill + top-value freshness |
| `15 * * * *` | formula-head revaluation |
| `30 * * * *` | UPCitemdb barcode backfill |
| `0 0,3,6,9,12,15,18,21` | eBay-sold scrape (Bright Data, 8×/day; zone `web_unlocker1`) |
| `0 1`, `0 5` | minifig valuation (two slots) |
| `0 2` | snapshot portfolios |
| `0 3` | snapshot set values |
| `0 4` | db-hygiene + daily catalog maintenance (+ Sundays: weekly set/fig import) |
| `0 6` | BrickInsights ratings backfill |
| `0 8` | wishlist price-drop alerts |
| `0 9` | Brickset enrich (Firecrawl) |
| `0 10` | LEGO.com stock refresh (Firecrawl) |
| `0 11` | BrickEconomy enrich (Firecrawl) |
| `0 12` | part-price backfill (BrickLink) |
| `0 13` | part-out compute (D1 only) |
| `0 14` | image pre-warm (R2) |
| `0 15` | upcoming / coming-soon refresh (Firecrawl) |
| `0 16` | **PriceCharting per-set enrich** |
| `0 17`, `0 19`, `0 23` | pricesAPI live-retail (three slots) |
| `0 18` | **PriceCharting bulk CSV — DAILY** (one download covers the whole catalog) |
| `0 20` | AI gap-fill (free Gemini/OpenRouter) |

Both one-time bootstraps — PriceCharting per-set (`10,25,40,55`) and BrickEconomy (`5,20,35,50`) — were **retired 2026-07** once catalog coverage was swept; gap-fills ride the steady-state crons + the manual `bootstrap-brickeconomy.yml`.

- **BrickLink no-data backoff:** a set whose sold guide returns <5 lots is stamped `set_market_ext.bl_nodata_at` and its BrickLink calls are skipped for **90 days** (`valuate-sets`), so the ~5k/day budget isn't spent re-querying dead sets. Cleared when a real price returns.

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

**Full-sweep audit remediation (2026-07, v267)** — a 3-track independent audit
(UX journeys, backend security/reliability, perf/PWA) surfaced ~60 findings;
all remediated across 7 commits (`audit-1`…`audit-7`).
- **Critical:** onboarding Kids-mode trap defused (PIN gate only engages once a
  PIN exists; guests can't pick Kids in the wizard; shared `components/kids-pin.js`
  setup sheet; "Forgot PIN? Sign out" escape). ONE display-value chain
  (`displayValueOf`, now in `lib/pure-core.js`) across catalog/vault/detail —
  the catalog copy had dropped the `blended_value` fallback. Shared
  `flipEconomics()` fixes the flip calculator's missing exchange-rate/tax.
- **UX:** alerts mark read on view + per-alert ✓ dismiss; undo toast after
  single/bulk delete (`undoToast` in utils.js); bulk ops report partial
  failures; wishlist target pre-filled with a no-target explanation; guest-
  migration failures keep a snapshot + "Retry guest sync" in You → Data;
  honest offline guards; "vault"/"wishlist" terminology unified.
- **Backend:** 500-char caps on free-text fields; currency whitelist;
  google-sync + photo-upload rate limits; sync status persisted + on /status;
  public profile/leaderboard cacheable (s-maxage) + projected columns;
  JWT `iss` now ENFORCED; RevenueCat webhook constant-time compare; CSV
  import external lookups capped at 25/request.
- **Perf:** `lib/pure-core.js` boot split + modulepreload for the boot set;
  bounded unversioned SW `IMG_CACHE` (FIFO 300); offline navigation falls back
  to the precached shell; vault repaints keep scroll. (The physical app.css
  split was deliberately SKIPPED — order-dependent token/skin layers.)
- **PWA/CI:** manifest `share_target` (shared text → catalog search) +
  real `screenshots/` (regenerate via `e2e/screenshots.config.mjs`); deploy CI
  runs all schema probes in ONE round-trip and uploads secrets only on main /
  manual `push_secrets`; `@ts-check` on pure-core.js gated in CI; e2e suite
  now 24 tests (Kids escape, undo, alerts-read, value consistency, share
  target regressions).

**Pricing v2.2: calibration, self-correction & portfolio trust (2026-06, v189)** —
made the blended value more reliable without new external sources.
- **History anomaly guard:** `blendMarketValue` (`lib/market-sources.ts`) takes an
  optional trailing-median (`recentValueMedian`/`recentValueMedians` in
  `price-trend.ts`, read from `set_value_history`). A value that jumps >2.5× (or
  <0.4×) off its own 90-day median while NOT backed by ≥2 fresh sold comps is kept
  as the displayed number but demoted to **low** confidence with a band spanning
  the historical level — never silently overwritten.
- **Calibrated band:** the flat ±10% is replaced by a half-width keyed to
  confidence (high ≈6%, medium ≈15%, low ≈30%), widened for single-source/stale,
  unioned with measured dispersion; shown as "Likely $Y–$Z".
- **Disagreement note:** source-anonymized `market_value_note` when signals diverge
  ≥1.5× (per the B1 convention — never names a provider).
- **Persisted trust:** new `lego_sets` columns `blended_confidence/blended_low/`
  `blended_high` (3-file rule + CI probe), written by `persistBlendedValue` /
  `recomputeBlendedValues`. `GET /api/collection` returns a `pricing_confidence`
  rollup; the portfolio hero shows "N% confidently priced".
- Deferred (noted in plan): eBay Marketplace Insights enablement (external
  approval), community prices into the blend (kept display-only), grounded AI
  fallback + a used-condition blend.

**Hardening: privacy, supporter cleanup, cost monitoring, deps (2026-06, v185–v188)** —
stabilization pass.
- **Privacy:** public reviews (`GET /api/contributions/sets/:setNum`) no longer
  return the raw `user_id`; they expose a public `display_name` only when the
  author's profile is public (LEFT JOIN `user_prefs`). Contributor flair lands on
  public profiles via `approved_contributions` on the profile API (v185).
- **Supporter flow:** **Patreon is the public supporter flow.** Stripe
  (`routes/stripe.ts` + `lib/stripe-client.ts`) is kept and marked
  **legacy/internal** but removed from `/api/config` readiness and `/api/me`
  (`stripe_configured` gone) — re-enable by re-adding `stripe` to `/api/config`.
  Deploy workflow now uploads `PATREON_URL` as a Worker secret.
- **Firecrawl cost monitoring:** the temporary 4×/hour BrickEconomy bootstrap
  cron + raised `FIRECRAWL_DAILY_CREDITS` are **intentionally left running** until
  `be_value_new` is filled. `/api/admin/integrations` gained a `firecrawl` block
  (credits used/cap, bootstrap fill %, cutover action) surfaced in `me-admin.js`;
  `POST /api/admin/jobs/:job` accepts a `?limit=` override; new
  `bootstrap-brickeconomy.yml` (manual, budget-limited, `dry_run`) is the planned
  replacement once the fill reaches 100%.
- **Security/deps:** `npm audit --omit=dev` clean (hono→4.12.27, ws→8.21.0);
  `biome.json` migrated off the deprecated `rules.recommended` → `rules.preset`;
  `WRANGLER_LOG=none` default to quiet Windows test noise.
- The eBay valuation/scraping pipeline (the 3× corroboration-gated `ebay-sold-scrape`
  job) was left **unchanged** by deliberate decision.

**User contributions system (2026-06, v184)** — signed-in users can now improve
the shared catalog and add community content, all behind an **admin-reviewed
queue**. Three tables (`set_reviews`, `set_photos`, `set_contributions`) with a
shared moderation lifecycle; new `routes/contributions.ts` (submit/read, R2 photo
upload, daily rate limit ×5 for supporters) + admin queue/approve-reject in
`routes/admin.ts` (barcode fixes auto-apply to `lego_sets.upc`). Frontend: a
**Community** tab on set detail (`portfolio-detail.js` + `components/contribute.js`
sheets), an admin **Contributions** review section in `me-admin.js`, and a
`#/me/contributions` view with approved-count recognition. Public-profile
contributor flair shipped as a follow-up (v185, see the hardening entry above).

**Patreon + Gold skin + supporter admin (2026-06, v180–v183)** — replaced the
Stripe Connect experiment with a simple Patreon link-out (`PATREON_URL` via
`/api/config`); rebuilt the supporter-only **Gold** skin as a full champagne
token system in `skin-gold.css`; added a supporter-toggle and (above) a
contributions queue to the admin console.

**Offline hardening + per-view split (2026-06, v152–v159)** — two threads of work.
- **Offline:** precached the lazily-imported `onboarding.js` so the You tab works
  offline on a fresh install (v154); added a bounded-LRU **set-detail** IndexedDB
  cache so previously-viewed sets open offline instead of "Set not found", with
  on-device scans enriching value from that cache (v155); widened the
  `hydrateFromIDB` freshness window 1h→7d and added **wishlist + portfolio-history**
  hydration so a cold offline launch shows the full vault (v155–v156). Pure
  `upsertDetailCache` LRU helper lives in `lib/pure.js` (unit-tested).
- **Maintainability:** decomposed the 3034-line `views/portfolio.js` into per-view
  modules — `components/flip-calc` (v152), `portfolio-social` (leaderboard +
  public profiles, v153), `portfolio-wishlist` (v157), `portfolio-detail` (the set
  page, v158) — then pruned the now-dead imports (v159). `portfolio.js` is now
  ~1148 lines (vault + insights + bulk-select). See the per-view-split note in §3.

**Migration consolidation + P1 robustness (2026-06)** — the deploy "Apply column
migrations" step now greps every `ALTER … ADD COLUMN` from `schema_migrate.sql`
and applies it per-statement (the old inline workflow ALTER array is gone;
`schema_migrate.sql` is the single source of truth), and the "Validate schema"
probe was extended to the Brickset/BrickInsights columns that had drifted out of
the migration (`theme_group`, `category`, `brickset_tags`, `brickset_*`,
`brickinsights_*`). Also: external fetches (`lego-stock`, `brickinsights`) gained
timeouts/retries via `fetchWithRetry`, advisor/scan rate limits became atomic
(`… RETURNING hit_count`), the `reserveQuota` ledger write clamps at cap, and the
Brickset/BrickLink import + wishlist-alert N+1 query loops were batched into
chunked `IN (…)` lookups. Commits `c9f03008`, `ab613ee`, + a workflow PR.

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
