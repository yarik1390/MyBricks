# Pricing reliability and source recommendations

## Acceptance boundary

This remediation addresses the confirmed scrape/freshness/reporting defects, not a claim that every catalog valuation is accurate. Failed/empty source checks must not refresh retained prices. Attempt/cooldown clocks are scheduling metadata; they do not prove observations. Missing condition prices, stock flags and retirement badges remain unknown. Rejected mappings never establish freshness. Existing incorrectly advanced timestamps cannot be reconstructed from current rows and are not rewritten to invented dates.

The eBay sold compliance hold remains in force, including minifigure entrypoints. No source, subscription, budget or provider credential is enabled by this change. The separate population-workflow completion fix requires a human workflow-authorized commit; the admin-console completion predicate can ship through the normal app integration.

## Recommended order

1. **Consented first-party transactions / specialist LEGO reseller agreements.** This is the most useful new evidence candidate: genuinely completed sales, preferably used/complete as well as sealed. Start with a small voluntary seller/user pilot, not an unrestricted public-price import. Retain exact set variant, condition/completeness, currency, item price versus shipping/tax, transaction date and deduplication evidence; redact receipts and identities. Obtain explicit storage/derivative/public-aggregate rights. Require multiple independent sellers and robust sample thresholds before any contribution can affect the public blend. An API/OAuth import is not permission to republish marketplace-derived records. Costs, availability and coverage are not yet validated.

2. **Approved retailer/affiliate product feeds (Awin or a direct merchant agreement).** Useful for current offers, stock, discounts and replacement cost; not completed secondary-market sales. Awin documents publisher feeds containing product links, prices and metadata and explicitly describes comparison publishers. Actual LEGO merchant access, identifier coverage, territory, retention and derivative rights remain account/advertiser-specific. Keep this lane out of resale fair-value blending and history unless the agreement expressly permits it. Prefer an approved feed over extracting protected retailer pages. See [Awin publisher documentation](https://help.awin.com/developers/docs/product-feed-publisher).

3. **Keepa, conditional on written public-use permission and a coverage/cost spike.** Official API documentation confirms Amazon product/price histories, offers, deals and seller data, ASIN or product-code lookup, and token metering. This is Amazon retail/asking/history evidence, not a new independent sold marketplace. Match UPC/ASIN to the exact LEGO set rather than title alone; reject bundles, accessories and condition mismatches. Public display, retention and derived-value rights were not established here. Do not buy a plan or enable ingestion before that gate. See [Keepa API](https://keepa.com/api-docs/).

4. **StockX only through a negotiated entitlement.** Potential targeted corroboration for high-value sealed sets, not general used coverage. Developer access is reviewed and uses OAuth; an available endpoint is not permission for a public price guide. Its API license contains internal-use/public-distribution restrictions, so request an explicit public derived-display agreement and validate the exact permitted market-data payload before implementation. Do not count lowest asks as completed sales, and do not enable the existing scraper just because its retry behavior is repaired. See [StockX FAQ](https://developer.stockx.com/portal/faqs) and [API license](https://developer.stockx.com/portal/license-agreement).

## Do not pursue as ready replacements

- eBay Marketplace Insights: user-confirmed unavailable. Browse active listings are asks, not historical sales; alternative scrape transports do not lift the production compliance hold or create independent families.
- BrickOwl catalog/pricing: user-confirmed unavailable; retired pricing remains excluded.
- BrickPicker: removed; derivative/public-product restrictions and overlapping provenance make it unsuitable.
- Amazon Creators: existing eligibility gate and ephemeral offer-only treatment remain unchanged.
- AI-generated prices or another aggregator of the same eBay evidence: neither creates independent observed market evidence.

## Credibility work after this release

Measure accuracy against later independently observed transactions, not merely agreement among providers. Use a fixed balanced test basket (active/retired, multiple price bands/themes, both conditions), freeze predictions and evaluate future error, confidence-band coverage, stale/no-data rates and usable independent-family coverage. Preserve provenance/family deduplication. Expand fresh BrickLink priority coverage for owned/wishlisted/high-value sets within the existing budget rather than promising 24-hour freshness for the entire catalog. New sources are candidates until rights, live access, exact identity, timestamps, failure behavior and measurable benefit are verified.
