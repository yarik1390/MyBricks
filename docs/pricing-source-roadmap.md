# Direct-source plan: what replaces BrickPicker

BrickPicker was removed from the engine on **2026-09-21** (see
`pricing-partner-compliance.md` §1). It does not publish prices of its own — its
own market-data page names "direct retailer scraping, official APIs, monitored
marketplaces (eBay sold listings, BrickLink price guides), and licensed
third-party aggregators", and it deliberately hides some provider names in its
UI. So replacing it is not about finding one new feed; it is about closing the
specific gaps its aggregation papered over.

**Rule that governs every row below:** technical access is not permission.
A provider may be integrated only after its own terms allow the retention,
derivation, blending and **public display** BrickVault performs.

## 1. What BrickPicker named, and what BrickVault already has

| BrickPicker ingredient | BrickVault status | Verdict |
|---|---|---|
| eBay sold listings (sealed/used split) | Already collected — Firecrawl scrape (8×/day, 16 sets) + weekly Apify lane; eBay Browse API covers **asks only** | Improve, don't re-buy |
| BrickLink price guides + part-out floor | Already integrated (`lib/bricklink.ts`, `jobs/part-out-compute.ts`) under the ≤24h display rule | Already direct |
| Amazon offers / Buy Box / BSR history | Creators API client exists (`lib/amazon-creators.ts`), gated and KV-only | Gated, see §3 |
| Retailer prices (LEGO.com, Walmart, Target, Best Buy) | Not integrated | See §4 |
| "Licensed third-party aggregators" | Undisclosed — cannot be identified from public docs | Do not guess |

## 2. eBay sold evidence (the highest-value gap)

- `Buy.Browse` (the sanctioned basic-scope lane) returns **active listings
  only**. Historical completed sales are not available through it, and
  Marketplace Insights remains unobtainable (confirmed by Y Z).
- The scraped sold lane is under a compliance hold in code
  (`ebaySoldLaneAuthorized` in `lib/source-config.ts`). Do **not** lift it as
  part of this work.
- What would genuinely improve the evidence, in order of value:
  1. **transaction identity** — a per-sale id so duplicates can be collapsed
     across lanes (today `deduplicatePricingSignals` can only drop exact
     repeated *aggregate* fingerprints, because `source_item_id` is a
     product/catalog id, not a sale id);
  2. **accepted price + condition + date** rather than a modeled aggregate;
  3. per-lane attribution in the blend, so the Firecrawl and Apify lanes are
     never mistaken for two independent families (they write the same columns).
- Any route to those is a licensed-data question, not a scraping one.

## 3. Amazon (wrapped)

- PA-API 5 is retired; the successor is the **Creators API**, and access is gated
  on an approved Associates account with **≥10 qualifying sales in the trailing
  30 days**. Until that is met every call 403s, which is why
  `AMAZON_CREATORS_ENABLED` stays off.
- Associates terms cap storage at **≤24h** and forbid republishing price data,
  so Amazon is already modelled as an **ephemeral acquisition signal, never a
  valuation comp** (`weight: 0`). That must not change.
- Historical Buy Box / BSR history is a different product. **Keepa** is a
  candidate, but nothing in BrickPicker's public material establishes it as
  BrickPicker's supplier, and Keepa's own terms govern redistribution and
  public display. Treat as *unverified*, needing a terms review before any use.

## 4. Retail / availability feeds

Use for buying decisions, stock and replacement cost — **never** as resale
evidence, and never blended into `blended_value`.

| Provider | Route | Gate |
|---|---|---|
| LEGO.com | Affiliate product feed (network-managed) | Requires affiliate approval; confirm feed fields + display terms with the network |
| Walmart | `walmart.io` Affiliate Marketing API (`/items`, `/search`, `publisherId`) | Requires affiliate approval via Impact Radius |
| Best Buy | Developer Products API (real-time pricing/availability) | API-key registration; confirm commercial display terms |
| Target | No official product/pricing API found | Do **not** scrape; unsanctioned |

Keep these in their own columns/response fields, clearly separate from the
price-guide evidence the blend consumes.

## 5. Order of work

1. Finish the evidence-quality work already shipped (completeness, provenance
   dedup, benchmark) — more feeds are worth less than better provenance.
2. Improve the existing eBay sold lane's *quality* (identity, condition, dates)
   before adding any provider.
3. Wire ONE retail feed (LEGO.com or Walmart) behind a feature flag, retail-only.
4. Only then evaluate Keepa/Amazon history under a reviewed terms position.

## 6. Operational leftovers from the removal

Code is fully removed; these are the residual operational items:
- **`BRICKPICKER_API_KEY` Worker secret** may still exist in Cloudflare. It is
  no longer referenced by code and no longer uploaded by CI. Rotate/delete it at
  leisure — nothing depends on it.
- **`app_settings.source_config`** may still carry a `brickpicker` key in any
  environment where it was tuned. It is inert: `merge()` only iterates
  `DEFAULT_SOURCE_CONFIG`, so unknown keys are dropped on read.
- **Residual `pricing_signals` / `pricing_source_map` rows** (if any ever
  existed) are excluded at read time by `RETIRED_PRICING_SOURCES`. They can be
  deleted freely; none were ever written in production.
