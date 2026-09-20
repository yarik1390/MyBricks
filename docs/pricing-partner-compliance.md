# Pricing partner compliance & provenance

What the pricing engine is allowed to do with each licensed source, what it
actually does at every boundary, and what is still unproven. Numbers below were
**measured against live D1 on 2026-09-20** (28,456 catalog rows) — re-measure
before quoting them; they move daily.

## 1. Permission basis

### PriceCharting — written permission (Brady Haugh, under Y Z's Legendary subscription)
Covered:
- attributed LEGO price estimates in the free app;
- collection totals;
- periodic per-user collection-history snapshots;
- direct product-page links;
- use of the data in the blended/public valuation (confirmed explicitly by Y Z).

Not covered: raw bulk data export or API redistribution.

Commercial trigger: a commercial agreement applies at **$1,000/month** of app
revenue.

### BrickLink — API terms (Carl Perry)
Covered: displaying price-guide data in a free app **provided the displayed
content is no more than 24 hours older than what brickLink.com shows today**.

Not established: retention of **historical** BrickLink snapshots, and whether a
derived blend counts as "display of price-guide data" when BrickLink is not
named. Both are treated conservatively below (§5).

## 2. What the code does today

| Boundary | Rule | Where |
|---|---|---|
| Public source list | BrickLink is named **only** when `bl_cached_at` ≤ 24h | `lib/market-sources.ts → buildMarketSources` |
| Public payload | `bl_*` guide columns are **deleted** outside the window, so the value cannot leak through a raw column read | `lib/market-sources.ts → enrichSetRecord` |
| Primary source label | `bricklink_new` only inside the window; otherwise the neutral `derived_market` | `lib/market-sources.ts → primaryValueSource` |
| Explanation copy | BrickLink is named only inside the window | `lib/market-sources.ts → valuationExplanation` |
| Confidence tiers | Unchanged by the gate — computed from raw columns | `lib/market-sources.ts → marketConfidence` |
| History snapshots | `set_value_history.bl_value` is written **NULL**; raw guide values are never persisted | `jobs/snapshot-set-values.ts` |
| Existing history | One-time purge of pre-change rows, guarded by `app_settings.pricing_bl_history_purged` | `jobs/snapshot-set-values.ts` |
| PriceCharting attribution | Rendered whenever a `pricecharting*` source is in the value's basis, with the direct product link when a numeric product id exists | `public/js/lib/partner-attribution.js` |
| Revenue meter | Purchase events recorded; current month compared to the $1,000 threshold; surfaced in the admin console and in `/pricing/quality`'s recommended action | `lib/partner-revenue.ts` |

### Why the confidence tier is deliberately NOT gated
The gate is about re-publishing BrickLink's guide content, not about pretending
the evidence does not exist. `marketConfidence()` therefore reads the raw
`bl_new_value`/`bl_new_qty` columns rather than the display-gated source list —
otherwise a single display change would have silently demoted a large share of
the catalog from `high` to `medium` confidence.

## 3. Measured state (2026-09-20)

### BrickLink
| Age of `bl_cached_at` | Rows |
|---|---|
| < 24h (displayable) | 156 |
| 1–7 days | 44 |
| 7–30 days | 162 |
| > 30 days | 4,792 |
| never fetched | 23,302 |

Consequence: **~97% of BrickLink-carrying rows are outside the 24-hour window**,
so they contribute to our derived estimate but are no longer named or published
as BrickLink guide data. This is the intended, conservative reading of the term.

### PriceCharting
| Metric | Value |
|---|---|
| Mappings verified / quarantined / rejected | 8,593 / 10,157 / 2 |
| Verified mappings with a synthetic `legacy:` id | 5,490 |
| Contributing sets with **no** numeric product id | 4,942 |
| Sets carrying a sealed value | 7,826 |
| Sealed value but **no** eBay-sold comp | 4,158 |

The 4,942 unlinked sets are an attribution debt: PriceCharting's permission is
conditioned on the direct product link, and without a numeric product id the UI
cannot render one.

### Counterfactual backtest (PriceCharting vs eBay-sold)
| Metric | Value |
|---|---|
| Sets carrying both | 3,668 |
| Mean ratio (PC / eBay-sold) | 1.005 |
| Mean absolute difference | 13.4% |
| Within −20%/+25% band | 3,144 (85.7%) |

### Refresh reach (the cadence question)
PriceCharting sealed signals reading older than 14 days: **5,467**.

| Cohort | Rows |
|---|---|
| On a set whose only mapping is the synthetic `legacy:` placeholder (the bulk CSV's verified join can never match it) | 4,941 |
| Genuinely stale for other reasons | 526 |

So this is **not a cron-cadence problem** — the bulk fetch already runs daily. It is
the same identity gap: 90% of the "stale" signals belong to sets the daily bulk
pass cannot reach. Resolving their numeric product id (§4) makes them joinable and
they refresh daily from then on, with no scheduling change.

Second-order effect worth knowing: the bulk upsert is deliberately change-only, so
a price that is re-confirmed but unchanged keeps its original
`source_observed_at`. An old timestamp on a bulk-reachable row therefore means
"unchanged", not "unverified" — do not read it as staleness.

### Loose vs used-complete (same sets, 6,999)
Mean ratio **0.522** — loose (no box/manual) trades at about half of used-complete
on the same set. This is why loose may only ever cap the liquidation figure.

## 4. Attribution debt: how it is being drained

`jobs/pricecharting-enrich.ts` gets a `linkBackfill` mode with its own queue:

- target: verified mappings still holding a `legacy:` placeholder id, whose set
  has no numeric `pc_id`;
- ordered by value (these sets sat permanently behind thousands of fresher,
  higher-value rows in the refresh queue — 5,222 had never been attempted at all);
- resolution reuses the existing strict discovery (`isExactPriceChartingMatch`:
  set number must appear in the product title, ≥60% token overlap, ambiguous
  variants rejected). The synthetic `legacy:` id is never sent to the
  PriceCharting product API;
- on success the real id is written to `lego_sets.pc_id`, a verified
  `pricing_source_map` row is created, and the legacy row is deleted.

Cadence: **150 sets/day** on the existing `0 14 * * *` cron, plus a manual
`POST /api/admin/jobs/pricecharting-link-backfill?limit=200`. Both sit inside the
500 calls/day PriceCharting quota cap (refresh pass 100 + backfill 150 = 250).
Draining 4,942 sets therefore takes ~33 days at the scheduled rate, faster with
manual runs.

Fallback for correctness: `routes/sets.ts` now resolves the attribution id from
`pricing_source_map` **or** `lego_sets.pc_id`, so a set that already carries a
numeric id cannot lose its link for want of a mapping row.

## 5. Residual risk and open questions

1. **Derived-blend reading of BrickLink's 24-hour term (unresolved).** We gate
   *display and attribution* of BrickLink guide data, but a blended estimate may
   still be partly derived from older guide rows. Whether the term reaches that
   case is not stated in the permission we hold. Recommended: ask Carl Perry in
   writing. Until then no named BrickLink value or timestamp is published outside
   the window, and stale evidence is disclosed through the normal freshness/
   staleness path.
2. **`used_value` provenance.** The column is written by both the BrickLink and
   eBay paths, so it cannot be gated as cleanly as `bl_*`. It stays in the
   payload; if BrickLink confirms a stricter reading, it moves into the gate.
3. **Historical BrickLink snapshots.** No permission basis was found, so raw
   guide values are no longer persisted and pre-existing rows are purged. Our own
   derived valuation history (permitted for PriceCharting, first-party for
   everything else) is unaffected.
4. **Revenue meter completeness.** Only amounts present on the RevenueCat webhook
   are counted, and non-USD amounts are counted separately rather than converted
   at a guessed rate. App Store / Play revenue that never produces a webhook
   event — including the Patreon lane — is invisible to the meter, so the
   threshold check is a floor, not an exact figure.

## 6. Re-running the evidence

```
GET /api/admin/pricing/backtest     # overlap, coverage, loose ratio, link debt
GET /api/admin/integrations         # partner_revenue block
GET /api/admin/pricing/quality      # recommended_action escalates on the threshold
```

## 7. Acceptance checklist

- [x] No public BrickLink guide value, min/max, lot count or timestamp outside 24h.
- [x] No raw BrickLink guide value persisted to `set_value_history`; pre-existing
      rows purged once.
- [x] PriceCharting attribution with direct product link wherever a numeric id
      exists; a resolver drains the legacy backlog.
- [x] Counterfactual backtest available on demand before any weight change.
- [x] Loose feed used only as a liquidation cap, never in the used-complete headline.
- [x] Revenue threshold monitored monthly and escalated in the admin console.
- [ ] BrickLink written answer on the derived-blend reading (§5.1).
