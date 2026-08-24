// Human-readable catalogue of every background process, so the admin "Activity"
// view can explain what each does and when it runs — even before its first run.
// Keys match the names passed to run('…') in index.ts scheduled(). Keep in sync
// when adding/removing a cron.

export type ProcessGroup =
  | 'Pricing' | 'Valuation' | 'Enrichment' | 'Snapshots & Alerts' | 'Catalog' | 'Maintenance';

export interface ProcessInfo {
  label: string;
  description: string;
  schedule: string;
  group: ProcessGroup;
}

export const GROUP_ORDER: ProcessGroup[] = [
  'Pricing', 'Valuation', 'Enrichment', 'Snapshots & Alerts', 'Catalog', 'Maintenance',
];

export const PROCESS_REGISTRY: Record<string, ProcessInfo> = {
  // --- Pricing ---
  'pricecharting-enrich': { label: 'PriceCharting (per-set)', description: 'Per-set PriceCharting lookup — sealed, complete, loose (used) values and sales-volume (liquidity).', schedule: 'Daily 16:00 UTC', group: 'Pricing' },
  'pricecharting-bulk': { label: 'PriceCharting (bulk CSV)', description: 'Downloads the whole LEGO price guide (~13k sets) in one CSV and updates values + liquidity. Manual upload path; the scheduled cron records as “PriceCharting (bulk fetch)”.', schedule: 'Manual', group: 'Pricing' },
  'pricecharting-bulk-fetch': { label: 'PriceCharting (bulk fetch)', description: 'Daily bulk download of the PriceCharting LEGO guide (~2 MB CSV) refreshing ~13k catalog rows — no metered quota.', schedule: 'Daily 04:30 UTC', group: 'Pricing' },
  'pricecharting-verify': { label: 'PriceCharting verify', description: 'Settles price-agreement promotions for quarantined source matches (unique UPC or cross-source agreement) and refreshes their signals.', schedule: 'Daily 04:00 UTC', group: 'Pricing' },
  'pricecharting-verify-drain': { label: 'PriceCharting verify (drain)', description: 'Hourly drain of the pending price-agreement verification queue (no new signal writes).', schedule: 'Hourly (:15)', group: 'Pricing' },
  'pricesapi-retail': { label: 'pricesAPI live retail', description: 'Live retailer offers + stock across major stores — feeds the deal signal, in-stock truth and wishlist alerts.', schedule: 'Daily 17:00, 19:00 & 23:00 UTC', group: 'Pricing' },
  'brickeconomy-enrich': { label: 'BrickEconomy values', description: 'Scrapes BrickEconomy modeled values and 2y/5y forecasts (via Firecrawl).', schedule: 'Daily 11:00 UTC', group: 'Pricing' },
  'ebay-sold-scrape': { label: 'eBay sold comps', description: 'Scrapes eBay realized sold prices (Bright Data primary, Firecrawl rescue) as a high-confidence sold source. Bursts the backfill, then self-tapers to a 30-day refresh.', schedule: '8×/day (every 3h)', group: 'Pricing' },
  'ebay-sold-apify': { label: 'eBay sold comps (Apify)', description: 'Weekly second sold-comps lane via the Apify eBay actor (20 sets/run). Writes the same columns as the scrape lane; currently held pending provider authorization.', schedule: 'Weekly Sun 21:30 UTC', group: 'Pricing' },
  'community-comps': { label: 'Community comps', description: 'Nightly anonymized purchase/sale aggregates (k≥5 contributors) into community_comps AND verified pricing_signals, so the community family joins the blend once data exists.', schedule: 'Daily 22:00 UTC', group: 'Pricing' },
  'pricing-movers': { label: 'Anomaly detection', description: 'After the value snapshot, flags day-over-day moves beyond ±40% and auto-resolves day_move/value_divergence anomalies that no longer hold.', schedule: 'Daily 03:00 UTC', group: 'Pricing' },
  'pricing-v3-shadow': { label: 'v3 blend recompute', description: 'Recomputes persisted v3 blends in bounded slices so stored portfolio sums stay aligned with the live read path.', schedule: 'Daily 02:00 UTC', group: 'Pricing' },
  'valuate-bl-refresh': { label: 'BrickLink freshness refresh', description: 'Re-queries sets whose BrickLink value has aged past the blend\'s 14-day freshness window, eBay-corroborated ones first. BrickLink age — not data availability — is what caps high-confidence valuations.', schedule: 'Hourly (:45)', group: 'Pricing' },
  'stockx-enrich': { label: 'StockX lowest ask', description: 'Scrapes StockX lowest ask (Firecrawl-preferred, rendered) as a corroborating new-condition signal. OFF by default; collect-only until validated and wired into the blend.', schedule: 'Daily 18:00 UTC', group: 'Pricing' },

  // --- Valuation ---
  'valuate-owned-deep': { label: 'Value owned & wishlist', description: 'Refreshes blended market values for your owned and wishlisted sets first.', schedule: 'Hourly', group: 'Valuation' },
  'valuate-sets': { label: 'Value catalog', description: 'Converts catalog sets from formula estimates to real market prices as quota allows.', schedule: 'Hourly', group: 'Valuation' },
  'valuate-ebay-ask': { label: 'eBay ask refresh', description: 'Refreshes eBay current-listing (ask) prices used by the deal signal.', schedule: 'Hourly', group: 'Valuation' },
  'valuate-topvalue': { label: 'Value top sets', description: 'Keeps the highest-value sets fresh with priority re-valuation.', schedule: 'Hourly', group: 'Valuation' },
  'valuate-formula-head': { label: 'Seed new sets', description: 'Gives new/unpriced sets a formula estimate until market data arrives.', schedule: 'Hourly (:15)', group: 'Valuation' },
  'valuate-minifigs': { label: 'Value minifigures', description: 'Prices owned, Collectible-Minifigures and popular figs from BrickLink + eBay sold comps.', schedule: 'Daily 01:00 & 05:00 UTC', group: 'Valuation' },
  'minifig-verify': { label: 'Minifig identity verify', description: 'Settles ambiguous Rebrickable→BrickLink name matches by price agreement (minifig_bl_candidates queue).', schedule: 'Daily 16:00 UTC', group: 'Valuation' },
  'valuate-ai-gapfill': { label: 'AI gap-fill', description: 'Estimates high-value sets no market source can price yet, using the free Gemini fallback.', schedule: 'Daily 20:00 UTC', group: 'Valuation' },

  // --- Enrichment ---
  'brickset-enrich': { label: 'Brickset metadata', description: 'Adds Brickset details — MSRP, launch/exit dates, ratings, barcodes.', schedule: 'Daily 09:00 UTC', group: 'Enrichment' },
  'brickinsights-ratings': { label: 'Review ratings', description: 'Fetches aggregated community review scores (BrickInsights).', schedule: 'Daily 06:00 UTC', group: 'Enrichment' },
  'lego-stock-refresh': { label: 'LEGO.com stock', description: 'Checks LEGO.com availability and retiring-soon status.', schedule: 'Daily 10:00 UTC', group: 'Enrichment' },
  'upcitemdb-backfill': { label: 'Barcode backfill', description: 'Fills missing UPC/barcodes from UPCitemdb (2nd source after Brickset).', schedule: 'Hourly (:30)', group: 'Enrichment' },
  'part-price-backfill': { label: 'Part prices', description: 'Caches individual part prices used to compute part-out values.', schedule: 'Daily 12:00 UTC', group: 'Enrichment' },
  'part-out-compute': { label: 'Part-out value', description: 'Computes each set’s sum-of-parts (part-out) floor value.', schedule: 'Daily 13:00 UTC', group: 'Enrichment' },

  // --- Snapshots & Alerts ---
  'snapshot-portfolios': { label: 'Portfolio snapshots', description: 'Records a daily snapshot of every user’s total portfolio value.', schedule: 'Daily 02:00 UTC', group: 'Snapshots & Alerts' },
  'snapshot-set-values': { label: 'Set value history', description: 'Records daily per-set value history that powers the trend charts.', schedule: 'Daily 03:00 UTC', group: 'Snapshots & Alerts' },
  'wishlist-alerts': { label: 'Alerts', description: 'Sends price-drop, value-spike, retiring-soon, buy-window and pre-order alerts.', schedule: 'Daily 08:00 UTC', group: 'Snapshots & Alerts' },

  // --- Catalog ---
  'weekly-import-sets': { label: 'Import sets', description: 'Weekly Rebrickable catalog import for LEGO sets.', schedule: 'Weekly Sun 04:00 UTC', group: 'Catalog' },
  'weekly-import-figs': { label: 'Import minifigs', description: 'Weekly Rebrickable catalog import for minifigures.', schedule: 'Weekly Sun 04:00 UTC', group: 'Catalog' },
  'upcoming-refresh': { label: 'Upcoming sets', description: 'Scrapes upcoming / coming-soon LEGO sets for the release feed.', schedule: 'Daily 15:00 UTC', group: 'Catalog' },

  // --- Maintenance ---
  'db-hygiene': { label: 'Database hygiene', description: 'Cleans up stale rows, expired sessions and orphaned data.', schedule: 'Daily 04:00 UTC', group: 'Maintenance' },
  'daily-catalog-maintenance': { label: 'Catalog maintenance', description: 'Daily catalog upkeep and consistency pass.', schedule: 'Daily 04:00 UTC', group: 'Maintenance' },
  'image-prewarm': { label: 'Image pre-warm', description: 'Pre-warms set images into the edge cache for fast loads.', schedule: 'Daily 14:00 UTC', group: 'Maintenance' },
  'model-refresh': { label: 'AI model catalog refresh', description: 'Refreshes the cached free-model pool (OpenRouter) and Merge model list used by LLM routing.', schedule: 'Daily 04:00 UTC', group: 'Maintenance' },
  'amazon-offers': { label: 'Amazon offers', description: 'Amazon Creators API live offers (KV-only, 24h TTL per Associates terms). Two slots keep the freshness window gapless.', schedule: 'Daily 07:30 & 16:30 UTC', group: 'Maintenance' },
  'weekly-digest': { label: 'Weekly digest', description: 'Opt-in weekly vault digest email (portfolio movement, alerts recap).', schedule: 'Weekly Sun 08:00 UTC', group: 'Maintenance' },
  'collection-backups': { label: 'Collection backups', description: 'Weekly per-user collection snapshots to R2 with self-serve restore in Settings.', schedule: 'Weekly Sun 05:00 UTC', group: 'Maintenance' },
};

export function processInfo(name: string): ProcessInfo {
  return PROCESS_REGISTRY[name] ?? {
    label: name,
    description: 'Background process.',
    schedule: '',
    group: 'Maintenance',
  };
}
