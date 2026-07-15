// Stateless admin-console configuration: section list, job/maintenance tool
// descriptors, provider + service metadata, feature-flag labels and validators.
// Pure data (icons only) — extracted from me-admin.js so the view file is the
// orchestration + rendering, and this is the tuning surface.
import { I } from '../icons.js';

export const ADMIN_SECTIONS = [
  ['adminServices', 'Services'],
  ['adminPopulate', 'Populate'],
  ['adminJobs', 'Activity'],
  ['adminQuality', 'Catalog Quality'],
  ['adminPricing', 'Pricing'],
  ['adminUsers', 'Users'],
  ['adminContrib', 'Contributions'],
  ['adminTools', 'Tools'],
];

export const ADMIN_JOB_TOOLS = {
  sets: {
    url: '/api/admin/import-rebrickable',
    method: 'POST',
    body: { dataset: 'sets' },
    label: 'Import sets',
    desc: 'Imports the full LEGO set catalog from Rebrickable.',
    source: 'Rebrickable',
    duration: 'Several minutes',
    quota: 'Use only when catalog import is incomplete.',
    icon: I.download(),
    confirm: 'Import the set catalog now? This is safe, but it can take a while.',
  },
  figs: {
    url: '/api/admin/import-rebrickable',
    method: 'POST',
    body: { dataset: 'figs' },
    label: 'Import minifigs',
    desc: 'Imports the full minifigure catalog from Rebrickable.',
    source: 'Rebrickable',
    duration: 'Several minutes',
    quota: 'Use when minifig data is missing or stale.',
    icon: I.download(),
    confirm: 'Import the minifig catalog now?',
  },
  upc: {
    url: '/api/admin/backfill-upc',
    method: 'POST',
    body: {},
    label: 'Backfill barcodes',
    desc: 'Fills in missing UPC barcodes so sets can be scanned.',
    source: 'Brickset / UPCitemdb',
    duration: '1 safe slice',
    quota: 'Daily provider quota controls how far this advances.',
    icon: I.barcode(),
  },
  populate: {
    url: '/api/admin/populate-coverage',
    method: 'POST',
    body: {},
    label: 'Populate coverage',
    desc: 'Runs one safe slice of barcode + asking-price refresh.',
    source: 'Configured providers',
    duration: '1 safe slice',
    quota: 'Barcode pages plus asking-price refresh.',
    icon: I.refresh({ w: 16 }),
  },
  revalue: {
    url: '/api/admin/revalue-brickeconomy',
    method: 'POST',
    body: { scope: 'all', limit: 4 },
    label: 'Revalue prices',
    desc: 'Re-prices a small batch of sets from current market sources.',
    source: 'Valuation sources',
    duration: 'Small batch',
    quota: 'Uses the current daily source budgets.',
    icon: I.trend(),
  },
  everything: {
    url: '/api/admin/populate-everything',
    method: 'POST',
    body: { valuation_limit: 6, barcode_pages: 4, ebay_limit: 2 },
    label: 'Populate all safe sources',
    desc: 'Runs safe slices across every configured source until done.',
    source: 'All configured providers',
    duration: 'Repeated safe slices',
    quota: 'Stops only for hard errors; unavailable providers stay degraded.',
    icon: I.refresh({ w: 16 }),
  },
  pricechartingBulk: {
    url: '/api/admin/pricecharting-bulk-fetch',
    method: 'POST',
    body: {},
    label: 'Refresh PriceCharting (LEGO bulk)',
    desc: 'Downloads the whole LEGO price guide and updates values + liquidity.',
    source: 'PriceCharting CSV',
    duration: 'One ~2MB download',
    quota: 'Auto-runs weekly; CSV downloads are limited to once per 10 minutes.',
    icon: I.download(),
    disabled: true,
    disabledReason: 'Disabled while legacy PriceCharting identity mappings are quarantined.',
  },
  pricesapi: {
    url: '/api/admin/run-pricesapi',
    method: 'POST',
    body: { limit: 3 },
    label: 'Run pricesAPI now',
    desc: 'Refreshes live retailer offers + stock for a few sets — use to verify new keys.',
    source: 'pricesAPI.io',
    duration: 'Up to ~90s per set',
    quota: 'Needs PRICESAPI_ENABLED=1 + keys; spends the daily pricesAPI budget.',
    icon: I.refresh({ w: 16 }),
  },
  ebaySold: {
    url: '/api/admin/jobs/ebay-sold-scrape?limit=5',
    method: 'POST',
    body: {},
    label: 'Run eBay-sold scrape',
    desc: 'Scrapes eBay sold comps now (Bright Data) — use to verify tokens/zone.',
    source: 'Bright Data',
    duration: 'Up to ~60s for 5 sets',
    quota: 'Spends Bright Data credits; runs synchronously and returns the result.',
    icon: I.refresh({ w: 16 }),
  },
};

export const MAINTENANCE_TOOLS = {
  expire: {
    url: '/api/admin/expire-valuations',
    method: 'POST',
    label: 'Expire valuations',
    desc: 'Marks current valuations stale so the pricing crons re-price every set.',
    confirm: 'Expire valuations so cron jobs reprice them? This can create a lot of follow-up work.',
  },
  repair: {
    url: '/api/admin/repair-search-index',
    method: 'POST',
    label: 'Repair search index',
    desc: 'Rebuilds the catalog search index if set search starts returning wrong results.',
    confirm: 'Rebuild the catalog search index now?',
  },
};

export const SOURCE_META = {
  bricklink: ['BrickLink', 'Primary collector-market pricing. Strong signal for new and used values.'],
  ebay: ['eBay', 'Asking data plus sold comps only when approved and reachable. No weak sold fallback.'],
  brickeconomy: ['BrickEconomy', 'Useful historical and forecast signal when reachable.'],
  brickowl: ['BrickOwl', 'Optional marketplace signal and cross-check.'],
  pricecharting: ['PriceCharting', 'Quarantined until product identity is verified. Weight, per-set jobs, and bulk jobs stay disabled.'],
  pricesapi: ['pricesAPI.io', 'Optional retail offer signal; keep disabled unless keys and quota are ready.'],
  firecrawl: ['Firecrawl', 'Scraping runtime for structured market enrichment.'],
  brightdata: ['Bright Data', 'Scraping/runtime provider for restricted market data.'],
};

export const PROVIDER_GROUPS = [
  ['Core', ['d1', 'supabase', 'worker', 'pages']],
  ['Catalog', ['rebrickable', 'brickset', 'upc', 'upcitemdb']],
  ['Pricing', ['bricklink', 'brickeconomy', 'ebay', 'brickowl', 'pricecharting', 'pricesapi']],
  ['Scraping', ['firecrawl', 'brightdata']],
  ['AI', ['gemini', 'openai', 'openrouter', 'byok']],
  ['Notifications', ['resend', 'push', 'vapid', 'discord']],
  ['Sync', ['google']],
];

// Service key -> runtime feature flag (an env-default override you can flip from
// the console with no redeploy). Kept in sync with worker FEATURE_FLAGS.
export const SERVICE_FLAG = {
  ebay: 'ebay_sold_comps',
  brickowl: 'brickowl',
  brickinsights: 'brickinsights',
  brightdata: 'brightdata_sold',
  firecrawl: 'firecrawl',
  pricesapi: 'pricesapi',
};

export const FLAG_LABEL = {
  ebay_sold_comps: 'eBay sold comps',
  brickowl: 'BrickOwl source',
  brickinsights: 'BrickInsights ratings',
  brightdata_sold: 'Bright Data sold scrape',
  firecrawl: 'Firecrawl scraping',
  pricesapi: 'pricesAPI retail offers',
};

// Services the worker /test/:service probe can check (mirrors TESTABLE_SERVICES
// in worker/src/lib/service-tests.ts).
export const TESTABLE = new Set([
  'd1', 'supabase', 'rebrickable', 'brickset', 'brickinsights', 'bricklink', 'ebay',
  'brightdata', 'firecrawl', 'brickeconomy', 'pricecharting', 'pricesapi',
  'openrouter', 'gemini', 'openai', 'resend', 'turnstile', 'patreon', 'push',
]);

// Pricing sources with weight/cap/refresh tuning (worker DEFAULT_SOURCE_CONFIG).
export const TUNABLE_SOURCES = new Set([
  'bricklink', 'ebay', 'brickeconomy', 'brickowl', 'pricecharting', 'pricesapi', 'firecrawl', 'brightdata',
]);

// Short "what it does" copy for services not already described in SOURCE_META.
export const SERVICE_DESC = {
  d1: 'Primary database — catalog, valuations, jobs, settings.',
  supabase: 'Authentication and user identity.',
  worker: 'Cloudflare Worker runtime serving the API.',
  pages: 'Static asset + PWA hosting on Cloudflare Pages.',
  rebrickable: 'Master LEGO set and minifig catalog import.',
  brickset: 'Set metadata, retail price, and barcode enrichment.',
  upc: 'Barcode backfill so sets can be scanned.',
  upcitemdb: 'Fallback barcode lookup provider.',
  brickinsights: 'Aggregated community set ratings shown on set pages.',
  gemini: 'Google Gemini — server-side AI features.',
  openai: 'OpenAI — server-side AI features.',
  openrouter: 'OpenRouter — model routing for AI features.',
  byok: 'User bring-your-own AI key (stored client-side).',
  resend: 'Transactional email delivery.',
  push: 'Web-push notifications (VAPID).',
  vapid: 'Web-push signing keys.',
  discord: 'Optional Discord webhook alerts.',
  google: 'Google Sheets collection export and sync.',
};

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
