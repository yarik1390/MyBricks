# Handoff: price-source audit + eBay-sold fix (continue this work)

You are continuing work on **Brickvault (MyBricks)**, a Cloudflare Worker (Hono) +
D1 + Pages LEGO-collector app. Read `AGENTS.md` and `CLAUDE.md` first — they have the
full architecture, conventions, and hard constraints. This file is the delta: what
was just done, what's live right now, and what's left.

Work happens on branch **`claude/mybricks-lego-app-EdTPX`** (all recent commits are
there). `git pull` before every push. Do NOT open a PR unless asked.

---

## ⚠️ LIVE STATE — things running right now that need cleanup

1. **Temporary cron `*/3 * * * *` → `ebay-sold-backfill`** (in `worker/wrangler.toml`
   `[triggers]` + `worker/src/index.ts` `scheduled()` switch + `process-registry.ts`).
   It runs `runEbaySoldScrape(env, { limit: 28, concurrency: 5, preferFirecrawl: true })`
   every 3 min to build eBay-sold coverage. **REMOVE it once coverage catches up**
   (delete the trigger, the switch case, and the registry entry — mirror how the
   StockX temp cron was retired in commit `9090681`).

2. **`FIRECRAWL_DAILY_CREDITS = "50000"`** in `wrangler.toml [vars]` — temporarily
   raised for the eBay-sold backfill after confirming ~10k eligible sets remained and
   sufficient account credits were available. **Restore to `"2000"`** when done.

3. The StockX arc is fully finished and cleaned up (its temp cron is gone, budgets
   restored). StockX is live and blended. Don't touch it.

Monitor live state via the **Cloudflare D1 MCP** (database uuid
`1badcfb3-8a41-46d9-9553-637af727d8b0`). Useful query:
```sql
SELECT (SELECT COUNT(*) FROM lego_sets WHERE ebay_new_value IS NOT NULL) AS ebay_new_sold,
       (SELECT COUNT(*) FROM lego_sets WHERE ebay_used_value IS NOT NULL) AS ebay_used_sold,
       (SELECT COUNT(*) FROM set_market_ext WHERE ebay_sold_attempted_at IS NOT NULL) AS attempted,
       (SELECT COUNT(*) FROM set_market_ext WHERE ebay_used_attempted_at IS NOT NULL) AS used_attempted,
       (SELECT group_concat(summary,' | ') FROM (SELECT summary FROM cron_runs
          WHERE name='ebay-sold-backfill' ORDER BY started_at DESC LIMIT 6)) AS recent;
```
Live API: `https://brickvault-api.zhydenko.workers.dev`. Admin job trigger:
`POST /api/admin/jobs/:job` (needs a short-lived Supabase admin JWT — ask the owner;
they paste one from Admin → Services → "Copy admin token").

---

## What was just done (committed + deployed)

- **StockX**: enabled (Firecrawl-preferred), backfilled 598 lowest-asks, audited, and
  wired into the v3 blend as a corroborating `asking` signal (own `stockx` family).
- **rtk made compulsory** via a guarded `PreToolUse` Bash hook in `.claude/settings.json`.
- **`[limits] cpu_ms = 300000`** added to `wrangler.toml` (paid plan; the 30s default
  was killing big parsing batches). Keep this.
- **Comprehensive price-source audit** (findings below).
- **eBay-sold Step 1**: un-stalled + Firecrawl fast-backfill (details below).
- **eBay-sold Step 1.5/2**: condition-separated used comps plus hardened Bright Data
  parsing are implemented; production coverage validation remains before cleanup.

## Audit findings (production D1, ~27.4k sets) — the roadmap

| Source | Coverage | State |
|---|---|---|
| BrickEconomy (Firecrawl) | 15.1k (55%) | Healthy workhorse, but runs **+38% vs BrickLink** and is the ONLY modeled source |
| PriceCharting | 12k | Strong |
| eBay asking (Browse API) | 10.2k | Strong (asking only) |
| BrickLink | 3.2k (670 fresh) | Low value-coverage, mostly stale |
| StockX | 598 | New, blended |
| eBay sold | was 302, **now growing** | Was stalled; Step 1 un-stalled it |
| BrickOwl | **0** | ☠️ DEAD — 0 ok / 272 fail, HTTP 403 since ~June 13 |
| Bright Data (engine) | — | Parser hardened for compact/JSON-wrapped bodies; live recovery rate pending |

Note: Rebrickable's on-page "prices" are just BrickLink guide data we already ingest
first-hand — **not worth scraping** (also 403s bots). Don't add it.

## eBay-sold Step 1/2 status

The eBay-sold scrape was frozen at 302 sets ("all candidates negative-cached"). Fixed:
- Added **`set_market_ext.ebay_sold_attempted_at`** — a SQL-visible last-attempt marker
  written on every MISS (14-day cooldown). It's SEPARATE from `lego_sets.ebay_new_cached_at`
  (success-only, which feeds the blend's freshness) — that separation is the whole point:
  you canNOT stamp `ebay_new_cached_at` on a miss or absent data looks "fresh" to the blend.
  The candidate query filters/orders by the attempt marker → monotonic sweep, no wall.
- Added `preferFirecrawl` option + the temp backfill cron (item 1 above).
- Candidate ordering is now highest-value first (`COALESCE(bl_new_value, current_value) DESC`).
- eBay Firecrawl fetcher (`worker/src/lib/ebay-firecrawl.ts`) now uses `proxy:'enhanced'`
  (eBay bot-protects the sold search).

**Measured Step-1 result:** un-stall works (coverage growing again). Hit rate was
~15–20%; value-DESC ordering was the main gain. Step 1.5/2 is now implemented:
- New/sealed and used/complete comps have independent success freshness and miss
  cooldowns (`ebay_sold_attempted_at` / `ebay_used_attempted_at`). A result for one
  condition cannot hide a miss for the other.
- Firecrawl can extract both conditions in one request, or apply eBay condition 1000/
  3000 when only one is due. Used evidence feeds the existing v3 `used_complete` signal.
- Bright Data remains steady-state primary. It no longer rejects every response under
  50 KB; it unwraps JSON envelopes, detects actual block pages, recognizes explicit
  no-results pages, and parses each condition sequentially under the Worker socket cap.
- Focused tests cover compact HTML, blocked pages, new/used separation, condition-only
  quota use, independent cooldowns, and partial provider results.

**Still open:** keep `proxy:'enhanced'` while the temporary Firecrawl sweep runs. Once
new and used coverage are measured live, compare its observed hit-rate/credit cost and
switch back to basic if the marginal gain does not justify the credits. Then retire the
temp cron and restore `FIRECRAWL_DAILY_CREDITS` to `2000`.

## Remaining roadmap (after eBay-sold)
- **BrickOwl**: refresh the API key (`BRICKOWL_API_KEY`) or disable it — it's `enabled`
  in `source-config.ts` but produces nothing (403 since June), which is misleading.
- **BrickEconomy +38% bias**: apply a haircut or tighten the BE plausibility quarantine
  in `valuation-v3.ts` `legacySignalsFor` (the `beTrusted` / `corroborators` logic).
- **BrickInsights price index** (optional): a 2nd independent *modeled* source to reduce
  the single-source BrickEconomy dependence. We already have the BrickInsights integration
  for ratings — verify their per-set value data is genuinely independent before wiring.

---

## How to work here (verify loop, deploy, gotchas)

**Verify before every push (all must pass):**
```bash
cd worker && npx tsc --noEmit            # typecheck
cd worker && rtk vitest run              # 542 tests (cloudflare pool)
node --test public/js/__tests__/pure.test.js   # from repo ROOT — frontend pure helpers
# biome lives in the ROOT node_modules, NOT worker/:
cd <repo-root> && node_modules/.bin/biome lint worker/src/<file>
```

**Deploy:** push to `claude/mybricks-lego-app-EdTPX` → `.github/workflows/deploy-worker.yml`
auto-deploys (runs `schema.sql`, then each `schema_migrate.sql` ALTER independently with
`|| true`, then the "Validate schema before deploy" `SELECT … LIMIT 0` probes, then Worker
+ Pages). ~5–6 min lag. Check status via the GitHub MCP `actions_list`/`actions_get`.

**Hard constraints / gotchas:**
- **D1 has a 100-column limit on `lego_sets`** — it's AT the limit. New columns go in the
  `set_market_ext` overflow table.
- **Schema lives in two files**: `worker/schema.sql` (full `CREATE TABLE IF NOT EXISTS`,
  embed new columns) AND `worker/schema_migrate.sql` (plain `ALTER TABLE ADD COLUMN`, one
  per line). ALSO update `worker/src/test-schema.ts`, the inline `CREATE TABLE set_market_ext`
  in BOTH `worker/src/routes.test.ts` (two occurrences) and `worker/src/index.test.ts`, and
  add the column to the deploy probe in `deploy-worker.yml`. A `CATALOG_COLS` invariant test
  in `lib.test.ts` requires `CATALOG_COLS` (`worker/src/routes/sets-sql.ts`) to be a superset
  of `BLEND_INPUT_COLUMNS + BLEND_EXT_COLUMNS` (`worker/src/lib/market-sources.ts`) — add new
  blend-input columns to all three.
- **Cron strings use day-NAME form** (`0 4 * * SUN`, not `0`). Every cron in `wrangler.toml`
  `[triggers]` needs a matching exact-string `case` in the `scheduled()` switch in `index.ts`.
- **The valuation blend is v3** (`worker/src/lib/valuation-v3.ts`: `legacySignalsFor` builds
  signals from the row, `valueSignalsV3` combines them). The v2 code in `market-sources.ts`
  `blendMarketValue` after `return` is DEAD. Signal-type weights: sold=1, modeled=0.65,
  asking=0.35 (0.25 in the fair-value calc), estimate=0.2. An `asking` signal can only nudge
  the range ±15% when a sold family exists — never move the sold headline.
- **`rtk` mangles `grep`/`rg` output** (a PreToolUse hook auto-wraps Bash). When you need
  real identifiers, use the Grep/Read tools instead, or `rtk proxy <cmd>` to bypass.
- After a price write, jobs call `recomputeBlendedValues(env.DB, touched)` to re-blend.
  The daily `pricing-v3-shadow` cron (`runBlendRecomputeBackfill`, 400/day) sweeps the rest.
