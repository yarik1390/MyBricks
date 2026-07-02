// AUTO-EXTRACTED from schema.sql (Batch C job tests). Do not edit by hand.
// Real DDL so job tests exercise the exact production column set (esp. valuate-sets
// -> updateRetirementRiskBatch, which reads many lego_sets columns).

export const TABLE_DDL: Record<string, string> = {
  lego_sets: `CREATE TABLE IF NOT EXISTS lego_sets (
  set_num TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  year INTEGER,
  theme TEXT,
  pieces INTEGER,
  minifigs INTEGER DEFAULT 0,
  image_url TEXT,
  retail_price REAL,
  current_value REAL,
  forecast_2y REAL,
  forecast_5y REAL,
  retired INTEGER DEFAULT 0,
  valuation_method TEXT DEFAULT 'formula_bulk',
  upc TEXT,
  cached_at DATETIME,
  source TEXT,
  valuation_expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ebay_value REAL,
  ebay_cached_at TEXT,
  ebay_new_value REAL,
  ebay_used_value REAL,
  ebay_new_qty INTEGER,
  ebay_used_qty INTEGER,
  ebay_new_cached_at TEXT,
  ebay_used_cached_at TEXT,
  ebay_new_last_sold TEXT,
  ebay_used_last_sold TEXT,
  used_value REAL,
  bl_new_value REAL,
  bl_new_qty INTEGER,
  bl_used_qty INTEGER,
  bl_cached_at TEXT,
  be_cached_at TEXT,
  ebay_ask_value REAL,
  ebay_ask_qty INTEGER,
  ebay_ask_cached_at TEXT,
  retirement_risk_score INTEGER,
  retirement_risk_updated_at TEXT,
  subtheme TEXT,
  age_min INTEGER,
  age_max INTEGER,
  brickset_rating REAL,
  brickset_review_count INTEGER,
  retired_year INTEGER,
  be_growth_12m REAL,
  be_value_new REAL,
  be_value_used REAL,
  be_forecast_2y REAL,
  be_forecast_5y REAL,
  be_retail REAL,
  bl_new_min REAL,
  bl_new_max REAL,
  bl_used_min REAL,
  bl_used_max REAL,
  lego_in_stock INTEGER,
  lego_retiring_soon INTEGER DEFAULT 0,
  lego_checked_at TEXT,
  lego_availability TEXT,
  bo_new_value REAL,
  bo_used_value REAL,
  bo_new_qty INTEGER,
  bo_used_qty INTEGER,
  bo_cached_at TEXT,
  brickinsights_rating INTEGER,
  brickinsights_review_count INTEGER,
  brickinsights_url TEXT,
  brickinsights_cached_at TEXT,
  blended_value REAL,
  blended_confidence TEXT,
  blended_low REAL,
  blended_high REAL,
  brickset_msrp REAL,
  launch_date TEXT,
  exit_date TEXT,
  brickset_enriched_at TEXT,
  theme_group TEXT,
  category TEXT,
  brickset_tags TEXT,
  brickset_dimensions TEXT,
  packaging_type TEXT,
  instructions_count INTEGER,
  additional_image_count INTEGER,
  brickset_description TEXT,
  brickset_set_id INTEGER,
  brickset_image_urls TEXT,
  brickset_images_cached_at TEXT,
  pc_new_value REAL,
  pc_complete_value REAL,
  pc_id TEXT,
  pc_cached_at TEXT
);`,

  set_market_ext: `CREATE TABLE IF NOT EXISTS set_market_ext (
  set_num TEXT PRIMARY KEY REFERENCES lego_sets(set_num),
  pc_loose_value REAL,
  pc_sales_volume INTEGER,
  pa_retail_value REAL,
  pa_lowest_offer REAL,
  pa_in_stock INTEGER,
  pa_best_merchant TEXT,
  pa_offer_count INTEGER,
  pa_market TEXT,
  pa_cached_at TEXT,
  -- BrickLink no-data backoff stamp (sold guide <5 lots): the valuation job skips
  -- this set's BrickLink calls for 90 days so the ~5,000/day budget isn't wasted
  -- re-querying sets that will never have data. Cleared when a BL price returns.
  bl_nodata_at TEXT
);`,

  user_collection: `CREATE TABLE IF NOT EXISTS user_collection (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  set_num TEXT NOT NULL REFERENCES lego_sets(set_num),
  quantity INTEGER DEFAULT 1,
  condition TEXT DEFAULT 'new' CHECK(condition IN ('new','used_good','used_acceptable','sealed')),
  purchase_price REAL,
  notes TEXT,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  purchased_at DATE,
  deleted_at DATETIME,
  last_modified DATETIME DEFAULT CURRENT_TIMESTAMP,
  storage_location TEXT,
  acquisition_source TEXT,
  is_complete INTEGER DEFAULT 1,
  missing_pieces INTEGER DEFAULT 0,
  spike_alerted_at TEXT,
  custom_image_url TEXT,
  UNIQUE(user_id, set_num)
);`,

  import_runs: `CREATE TABLE IF NOT EXISTS import_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT,
  status TEXT DEFAULT 'running',
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  progress_current INTEGER DEFAULT 0,
  progress_total INTEGER,
  progress_label TEXT,
  themes_loaded INTEGER,
  sets_loaded INTEGER,
  sets_skipped INTEGER,
  figs_loaded INTEGER,
  error TEXT
);`,

  rate_limits: `CREATE TABLE IF NOT EXISTS rate_limits (
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  window_start DATETIME NOT NULL,
  hit_count INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, endpoint, window_start)
);`,

  user_wishlist: `CREATE TABLE IF NOT EXISTS user_wishlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  set_num TEXT NOT NULL REFERENCES lego_sets(set_num),
  target_price REAL,
  notes TEXT,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  alerted_at DATETIME,
  UNIQUE(user_id, set_num)
);`,

  oauth_sessions: `CREATE TABLE IF NOT EXISTS oauth_sessions (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);`,

  oauth_states: `CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);`,

  integration_health: `CREATE TABLE IF NOT EXISTS integration_health (
  service TEXT PRIMARY KEY,
  last_ok_at TEXT,
  last_fail_at TEXT,
  last_error TEXT,
  ok_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  blocked_until TEXT
);`,

  api_quota: `CREATE TABLE IF NOT EXISTS api_quota (
  service TEXT NOT NULL,
  day TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  cap INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  PRIMARY KEY (service, day)
);`,

  brightdata_keys: `CREATE TABLE IF NOT EXISTS brightdata_keys (
  key_hash TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0,
  cap INTEGER NOT NULL DEFAULT 5000,
  period_month TEXT,
  exhausted_at TEXT,
  last_used_at TEXT,
  updated_at TEXT
);`,

  app_settings: `CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);`,

  cron_runs: `CREATE TABLE IF NOT EXISTS cron_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  status TEXT DEFAULT 'running',
  summary TEXT,
  error TEXT,
  duration_ms INTEGER
);`,
};

/**
 * Create the named tables (dropping any prior copy) in a test D1.
 *
 * D1 enforces foreign keys, so DROP order matters: several tables
 * (set_market_ext, user_collection, user_wishlist) reference lego_sets and can
 * hold rows after a test runs. Callers list parents first, so we drop in REVERSE
 * (children before parents) and create in forward order (parents before children).
 */
export async function applyTestTables(db: D1Database, names: string[]): Promise<void> {
  for (const name of names) {
    if (!TABLE_DDL[name]) throw new Error(`unknown test table: ${name}`);
  }
  for (let i = names.length - 1; i >= 0; i--) {
    await db.prepare(`DROP TABLE IF EXISTS ${names[i]}`).run();
  }
  for (const name of names) {
    await db.prepare(TABLE_DDL[name]).run();
  }
}
