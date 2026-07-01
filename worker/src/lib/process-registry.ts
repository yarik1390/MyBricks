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
  'pricecharting-bulk': { label: 'PriceCharting (bulk CSV)', description: 'Downloads the whole LEGO price guide (~13k sets) in one CSV and updates values + liquidity.', schedule: 'Daily 18:00 UTC', group: 'Pricing' },
  'pricesapi-retail': { label: 'pricesAPI live retail', description: 'Live retailer offers + stock across major stores — feeds the deal signal, in-stock truth and wishlist alerts.', schedule: 'Daily 17:00, 19:00 & 23:00 UTC', group: 'Pricing' },
  'brickeconomy-enrich': { label: 'BrickEconomy values', description: 'Scrapes BrickEconomy modeled values and 2y/5y forecasts (via Firecrawl).', schedule: 'Daily 11:00 UTC', group: 'Pricing' },
  'ebay-sold-scrape': { label: 'eBay sold comps', description: 'Scrapes eBay realized sold prices (Bright Data, rotating tokens) as a high-confidence sold source. Bursts the backfill, then self-tapers to a 30-day refresh.', schedule: '8×/day (every 3h)', group: 'Pricing' },
  'be-bootstrap': { label: 'BrickEconomy bootstrap', description: 'One-time BrickEconomy backfill across the catalog (4×/hour).', schedule: '4×/hour (bootstrap)', group: 'Pricing' },

  // --- Valuation ---
  'valuate-owned-deep': { label: 'Value owned & wishlist', description: 'Refreshes blended market values for your owned and wishlisted sets first.', schedule: 'Hourly', group: 'Valuation' },
  'valuate-sets': { label: 'Value catalog', description: 'Converts catalog sets from formula estimates to real market prices as quota allows.', schedule: 'Hourly', group: 'Valuation' },
  'valuate-ebay-ask': { label: 'eBay ask refresh', description: 'Refreshes eBay current-listing (ask) prices used by the deal signal.', schedule: 'Hourly', group: 'Valuation' },
  'valuate-topvalue': { label: 'Value top sets', description: 'Keeps the highest-value sets fresh with priority re-valuation.', schedule: 'Hourly', group: 'Valuation' },
  'valuate-formula-head': { label: 'Seed new sets', description: 'Gives new/unpriced sets a formula estimate until market data arrives.', schedule: 'Hourly (:15)', group: 'Valuation' },
  'valuate-minifigs': { label: 'Value minifigures', description: 'Prices owned, Collectible-Minifigures and popular figs from BrickLink + eBay sold comps.', schedule: 'Daily 01:00 & 05:00 UTC', group: 'Valuation' },
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
};

export function processInfo(name: string): ProcessInfo {
  return PROCESS_REGISTRY[name] ?? {
    label: name,
    description: 'Background process.',
    schedule: '',
    group: 'Maintenance',
  };
}
