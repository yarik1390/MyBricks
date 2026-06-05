# CLAUDE.md — Brickvault (MyBricks)

Guidance for AI agents working in this repo. Read this before making changes.
Multiple agents work on the same branch (`claude/mybricks-lego-app-EdTPX`) in
parallel — keep changes small, commit in logical chunks, and `git pull` before
every push.

## What this is

Brickvault is a mobile-first PWA for LEGO collectors: log owned sets, track
market value/ROI, get AI price forecasts, manage a wishlist with price-drop
alerts, and share a public profile. Live: https://brickvault-5ub.pages.dev

## Architecture

- **Backend:** Cloudflare Worker, TypeScript, **Hono** framework — `worker/src`
- **Database:** Cloudflare **D1** (SQLite) — single binding `DB`
- **Auth:** Supabase JWT (HS256) verified in `worker/src/auth.ts` (`requireMember`)
- **Frontend:** vanilla JS SPA, hash routing, **no framework** — `public/js`
- **Hosting:** Worker (API) + Cloudflare Pages (static `public/`)
- **CI/CD:** `.github/workflows/deploy-worker.yml` — auto-deploys on push to
  `main` or the dev branch

### Backend layout (`worker/src`)
- `index.ts` — app entry, route registration, CORS, the `scheduled()` cron switch
- `auth.ts` — `requireMember` middleware, JWT verification, sets `userId` var
- `types.ts` — `Env` (bindings/secrets) and `Variables` (Hono context vars)
- `routes/` — one Hono sub-app per resource (`collection`, `sets`, `wishlist`,
  `me`, `themes`, `minifigs`, `scan`, `admin`, `advisor`, `profile`, `google-sync`)
- `jobs/` — cron job handlers (`valuate-sets`, `snapshot-portfolios`,
  `snapshot-set-values`, `wishlist-alerts`, `import-catalog`, `backfill-upc`)
- `lib/` — external integrations + pure helpers (`bricklink`, `ebay`,
  `brickeconomy`, `brickset`, `brickowl-barcode`, `gemini`, `valuation`,
  `price-trend`, `retirement-risk`, `advisor-context`)

### Frontend layout (`public/js`)
- `app.js` — bootstrap + router wiring (loaded as `type="module"`)
- `router.js`, `state.js`, `api.js`, `utils.js`, `icons.js` — core modules
- `views/` — one module per page (`portfolio`, `catalog`, `minifigs`, `me`, `login`)
- `components/` — `advisor` (chat drawer), `scanner` (camera), `sheet` (modal)

## Critical constraints — read before editing schema or crons

1. **D1 does NOT support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.** It throws
   `near "EXISTS": syntax error`. Schema is managed with **two files**:
   - `worker/schema.sql` — full `CREATE TABLE IF NOT EXISTS` for fresh DBs; embed
     **new columns directly in the CREATE TABLE** here.
   - `worker/schema_migrate.sql` — plain `ALTER TABLE ADD COLUMN` (no `IF NOT
     EXISTS`) for existing DBs. CI runs it with `|| true`, so duplicate-column
     errors on re-deploy are expected and ignored.
   When you add a column: add it to **both** files.

2. **Cron strings use day-name form, not `0` for Sunday.** Cloudflare rejects
   `0 4 * * 0` (`invalid cron string [code: 10100]`). Use `0 4 * * SUN`. Crons
   live in `worker/wrangler.toml` `[triggers]` and must have a matching `case`
   in the `scheduled()` switch in `index.ts` (the string must match exactly).

3. **Service worker cache version:** bump `VERSION` in `public/sw.js` on any
   change to cached assets, and keep its asset list in sync with `public/js`.

## Conventions

- **Every route** goes through `requireMember` (sets `c.get('userId')`) **except**
  public ones: `GET /api/config`, `GET /api/users/:handle/profile`. Be deliberate
  about which middleware a new route gets.
- **BYOK (bring your own key):** `X-Gemini-Key` / `X-OpenAI-Key` request headers
  let users bypass rate limits. Rate limits live in the `rate_limits` table
  (per user, per endpoint, per window). Honor BYOK in any new AI endpoint.
- **Soft deletes:** `user_collection` rows set `deleted_at`; every read filters
  `deleted_at IS NULL`. Don't hard-delete collection rows.
- **Streaming (SSE):** the advisor uses `TransformStream` +
  `c.executionCtx.waitUntil()`. Response is `text/event-stream`, events are
  `data: {...}\n\n`, terminal event `data: {"done":true}\n\n`.
- **Graceful degradation:** external pricing/AI fetchers return `null` on failure
  and callers fall back (eBay → RSS, BrickLink → BrickEconomy → Gemini → formula).
  Keep new integrations non-fatal.
- **Multi-currency:** values are stored in USD; the frontend converts at render
  using `utils.js`. Keep stored values in USD.

## Build / test / verify

From `worker/`:
```bash
npm ci
npm run typecheck   # tsc --noEmit — must pass
npm test            # vitest run (cloudflare pool) — must pass
```

From the repo root (frontend pure helpers):
```bash
node --test public/js/__tests__/pure.test.js   # node:test — must pass
```

**Backend tests** (`worker/src/*.test.ts`): 3 files, 48 tests.
- `index.test.ts` — CORS, OAuth, rate limits, validation, ETag, collection CRUD
- `routes.test.ts` — me, wishlist, profile, collection export/history, admin health
- `lib.test.ts` — `computeRetirementRisk`, `formulaValuation` pure logic

Each suite builds its own D1 schema in `beforeEach` — the test schema is
hand-maintained, so update it when a route needs a new column. Mock `openai`
and supply a mock `ExecutionContext` (so `waitUntil` background tasks don't
throw) — all three test files show the pattern.

**Frontend tests** (`public/js/__tests__/pure.test.js`): 36 tests.
- Covers: `escapeHtml`, `fmtPct`, `clamp`, `themeHue`, `bricklinkBuyURL`,
  `computeDealScore`, `annualizedROI`, `parseMarkdown` from `public/js/lib/pure.js`.
- Uses Node's built-in `node:test` runner — no extra dependencies.
- To add more: put new pure (no-DOM, no-state) helpers in `public/js/lib/pure.js`
  and test them in `pure.test.js`.

## Working in parallel (important)

- `git pull origin claude/mybricks-lego-app-EdTPX` before each push.
- Prefer **new files** over edits to shared hotspots (`index.ts`,
  `public/js/views/portfolio.js`, `app.css`) to minimize conflicts.
- Commit in small, self-contained chunks with descriptive messages.
- **Do not** open a PR unless explicitly asked.
