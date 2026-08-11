# Pricing freshness audit — 2026-07-30

Every figure here was measured against production D1 on the date above. Where
something is inferred rather than measured it says so.

> **STATUS — all four items actioned, same day.** What shipped, and what the
> audit got wrong once the code was actually opened:
>
> 1. **Bulk CSV daily.** Moved out of the Sunday gate into its own `30 4` slot.
> 2. **BrickEconomy.** The audit said "throttled to 40/day". That was true but not
>    the binding constraint: only **78 sets** were actually due, because the
>    staleness gate was **90 days** and the bootstrap had swept everything inside
>    that window. The job was not throttled, it was *idle* — which is why it read
>    `updated 0 · processed 40`. Fixed by splitting the gate (7 days for the
>    15,154 covered sets, 90 for the ~7,700 BrickEconomy has nothing for) and
>    adding two hourly slots. Cost: `FIRECRAWL_DAILY_CREDITS` 4,000 → 16,000,
>    ~13,200/day actual, **≈50 days of the 669k balance.**
>    `BRICKECONOMY_REFRESH_DAYS` is the dial — 14 days doubles the runway.
> 3. **Bright Data.** The tokens and zone are fine (the admin probe passes); what
>    fails is eBay specifically. Three fixes: the provider's own error body is now
>    kept instead of discarded, the timeout drops 60s → 25s with no retry on 5xx,
>    and the breaker is **half-open** — one probe call per run, so a recovery is
>    picked up within 3 hours instead of costing a whole 40-set run every 24h.
>    The admin `Test` button now exercises the real eBay URL, so "tokens bad" and
>    "eBay is blocking us" stop looking identical.
> 4. **`found 0` — root cause found.** 5,531 verified `pricing_source_map` rows
>    carry a **synthetic `legacy:<set_num>` id** minted by `pricecharting-verify`.
>    It is not a PriceCharting product id, so `/product?id=legacy:10123-1` 404s
>    every time. Because a miss never stamps `pc_cached_at`, those same sets stayed
>    pinned to the head of the queue and the job burned 100 calls a day on ids that
>    cannot exist. Legacy ids are now ignored for lookup (so discovery can find the
>    real one, which then replaces the placeholder), and misses stamp a 30-day
>    `pc_attempted_at` marker.
>
> The rest of this document is the original audit, unedited.

## Headline

The app is not short of pricing **sources**. It is short of **throughput on the
sources it already has**, and two of the cheapest refresh mechanisms are either
throttled to a rate that cannot finish, or running seven times less often than
the docs claim.

Adding API keys or new providers would not fix any of the four problems below.

## What users actually see

| | sets | share |
|---|---|---|
| Catalog | 27,660 | — |
| `valuation_method = formula_bulk` | 15,134 | 55% |
| `valuation_method = brickeconomy` | 11,572 | 42% |
| `market` / `ai` / `ebay_sold` | 501 / 423 / 30 | 3% |
| confidence high **or** medium | 6,026 | 22% |
| confidence `estimated` | 11,516 | 42% |

Every set has been revalued within 30 days (mean age 5.9 days) — but that is
when the *valuation ran*, not when a market was consulted. The formula path
re-stamps `cached_at` without touching any source, so that number flatters the
picture. The real question is how fresh the underlying evidence is.

## Where the evidence actually comes from

| Source | Sets with a value | Fresh ≤30d | Refresh mechanism |
|---|---|---|---|
| BrickEconomy | 15,154 (55%) | **335 (1.2%)** | Firecrawl scrape, **40/day** |
| PriceCharting | 12,226 (44%) | 2,651 ≤7d | bulk CSV, **weekly** |
| eBay sold | 5,287 (19%) | ~5,632 | Bright Data (**broken**) / Firecrawl |
| BrickLink | 3,216 (12%) | 1,867 (6.8%) | API, 4,500/day cap |

**BrickEconomy is the widest source and 98.8% of its data is stale.** That single
row explains most of the app's low-confidence problem: 42% of sets read
`estimated`, and 55% fall through to the formula.

## The four things actually wrong

### 1. BrickEconomy enrich cannot finish. Ever.
`index.ts` runs it once a day at `limit: 40`. Against the 15,154 sets that
depend on BrickEconomy, a full refresh cycle takes **379 days**. It is not
broken — 53,929 lifetime successes, last one today — it is simply throttled far
below the size of the job. It also spends 148 seconds and ~200 Firecrawl credits
per run, i.e. **5% of the daily Firecrawl budget on the source covering 55% of
the catalog**.

### 2. The bulk CSV runs weekly, not daily
`AGENTS.md` documents PriceCharting bulk as "DAILY (one download covers the whole
catalog)" at `0 18`. The code disagrees: it sits inside `case '0 4 * * *'` behind
`if (!isSunday) break;`. Last two runs were 2026-07-19 and 2026-07-26 — Sundays,
seven days apart.

This is the cheapest freshness in the entire system: **one ~2 MB HTTP request**
refreshes 13,145 catalog rows. Running it daily costs six more downloads a week
and no metered quota at all.

(The per-run "updated" count also fell from ~12,400 to ~2,545, but those numbers
are not comparable — the job was since gated to `verified` mappings and made
change-only, so the newer figure counts *prices that moved*, not rows refreshed.
Do not read that drop as lost coverage.)

### 3. Bright Data has been dead for a week and still holds the eBay lane
Last success 2026-07-23; 3,006 lifetime failures. Six keys × 5,000/month of paid
capacity is sitting unused. The circuit breaker added earlier routes eBay-sold to
Firecrawl, so nothing is *failing* — but the money is being spent on nothing and
the fallback consumes Firecrawl credits that BrickEconomy needs.

### 4. `pricecharting-enrich` reports `found 0`
"updated 0 · found 0 · processed 100" — it walks 100 sets an hour and matches
none. Either the candidate query is selecting sets that cannot match, or the
per-set lookup is broken. Worth a look before it is trusted as a top-up path;
the bulk CSV is doing the real work.

## Do you need more keys or more sources?

**More sources: no.** Four providers already cover the catalog. The gap is
refresh rate, not availability. (Rebrickable, BrickInsights and part-out ratios
were each investigated earlier in this project and rejected on evidence —
Rebrickable resells BrickLink data, BrickInsights carries no prices, and the
part-out/sold ratio spans 0.22–6.04, a 27× spread with no usable direction.)

**More Firecrawl credits: no — you already have 650k unused.** The binding limit
is the self-imposed `FIRECRAWL_DAILY_CREDITS = 4000`, and today's use is 2,340.
At 4,000/day the existing balance is 162 days of runway. This is the lever.

**More BrickLink keys: not recommended.** BrickLink's 5,000/day is per account,
so extra accounts would raise throughput — but running multiple accounts to
exceed a published rate limit is the kind of thing that gets an API key revoked,
and BrickLink is the source with the strongest sold-comp data. Not worth the
risk for a source that already covers only 12% of the catalog.

**Worth buying?** A PriceCharting tier that permits more frequent bulk pulls, if
one exists above Legendary. That is the only paid upgrade here with a clear
return, and it may already be permitted — check the plan before paying.

## Recommended order

1. **Bulk CSV daily instead of weekly.** One line; refreshes 13,145 rows a day;
   costs nothing metered. Biggest win per unit of effort in this document.
2. **Raise BrickEconomy enrich from 40/day.** At 400/day the cycle drops from 379
   days to 38; at 800/day, to 19. Firecrawl headroom today is ~1,660 credits =
   332 extra sets/day, and the daily cap can be raised against the 650k balance.
3. ~~**Decide about Bright Data**~~ — RESOLVED 2026-08-11: dropped entirely. It could not reach eBay sold search by any route (sync unlocker no answer at 90s, async still pending after hours, Web Scraper API refused on account credits), while StockX unlocked fine on the same tokens. Firecrawl now owns the lane. Original text: repair the account or drop it and give the
   eBay-sold lane to Firecrawl permanently. Right now it is paid-for and idle.
4. **Diagnose `pricecharting-enrich`'s `found 0`.**

Items 1 and 2 alone would move BrickEconomy freshness from 1.2% toward the
majority of its 15,154 sets, which is where the `estimated` confidence and the
55% formula fallback actually come from.

## What this audit does not establish

- Whether refreshing BrickEconomy more often *changes* many prices. Only 3.81% of
  sets move on a given day, so a faster cycle may improve confidence labels more
  than headline values. Worth re-measuring after item 2.
- Whether the sets users care about are stale. With two accounts and three
  holdings there is no meaningful sample; the owned-deep lane in `valuate-sets`
  is designed to prioritise them, and that design was not exercised here.
