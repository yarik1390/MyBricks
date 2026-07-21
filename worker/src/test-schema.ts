// AUTO-EXTRACTED from schema.sql + schema_migrate.sql (Batch C job tests).
// Do not edit by hand; regenerate if the schema changes. lego_sets/set_market_ext/
// minifigs fold in ADD COLUMN migrations so tests match the EFFECTIVE production
// schema (e.g. deal_signal, part_out_*, minifigs.ebay_value) the jobs read/write.

export const TABLE_DDL: Record<string, string> = {
  lego_themes: `CREATE TABLE IF NOT EXISTS lego_themes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id INTEGER
)`,

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
  pc_cached_at TEXT,
  part_out_value REAL,
  part_out_coverage REAL,
  part_out_cached_at TEXT,
  deal_signal TEXT,
  deal_discount_pct REAL,
  deal_strong INTEGER,
  deal_cached_at TEXT,
  img_prewarmed_at TEXT
)`,

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
  stockx_ask REAL,
  stockx_cached_at TEXT,
  bl_nodata_at TEXT
)`,

  pricing_source_map: `CREATE TABLE IF NOT EXISTS pricing_source_map (
  source TEXT NOT NULL, source_item_id TEXT NOT NULL, set_num TEXT,
  source_title TEXT, upc TEXT, variant_key TEXT, match_method TEXT,
  match_confidence REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'quarantined',
  verified_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (source, source_item_id)
)`,

  pricing_signals: `CREATE TABLE IF NOT EXISTS pricing_signals (
  set_num TEXT NOT NULL, source TEXT NOT NULL, source_item_id TEXT,
  provider_family TEXT NOT NULL, condition TEXT NOT NULL, signal_type TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD', value REAL NOT NULL, low REAL, high REAL,
  sample_count INTEGER, sales_volume INTEGER, source_observed_at TEXT,
  checked_at TEXT NOT NULL, match_status TEXT NOT NULL DEFAULT 'quarantined',
  flags_json TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (set_num, source, condition)
)`,

  set_valuation_state: `CREATE TABLE IF NOT EXISTS set_valuation_state (
  set_num TEXT NOT NULL, condition TEXT NOT NULL, fair_value REAL, low REAL, high REAL,
  liquidation_value REAL, confidence TEXT NOT NULL DEFAULT 'estimated',
  confidence_score INTEGER NOT NULL DEFAULT 0, sample_count INTEGER NOT NULL DEFAULT 0,
  independent_family_count INTEGER NOT NULL DEFAULT 0, basis_json TEXT NOT NULL DEFAULT '[]',
  flags_json TEXT NOT NULL DEFAULT '[]', forecast_json TEXT, as_of TEXT,
  model_version TEXT NOT NULL DEFAULT 'v3-shadow', updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (set_num, condition)
)`,

  set_valuation_history_v2: `CREATE TABLE IF NOT EXISTS set_valuation_history_v2 (
  set_num TEXT NOT NULL, condition TEXT NOT NULL, snapshot_date TEXT NOT NULL,
  fair_value REAL, low REAL, high REAL, confidence TEXT, model_version TEXT,
  PRIMARY KEY (set_num, condition, snapshot_date)
)`,

  retail_price_current: `CREATE TABLE IF NOT EXISTS retail_price_current (
  set_num TEXT NOT NULL, market TEXT NOT NULL, currency TEXT NOT NULL,
  item_price REAL, delivered_price REAL, merchant TEXT, stock TEXT, offer_count INTEGER,
  msrp REAL, lowest_90d REAL, all_time_low REAL, checked_at TEXT NOT NULL, source TEXT,
  PRIMARY KEY (set_num, market)
)`,

  retail_price_history: `CREATE TABLE IF NOT EXISTS retail_price_history (
  set_num TEXT NOT NULL, market TEXT NOT NULL, observed_at TEXT NOT NULL,
  delivered_price REAL, merchant TEXT, stock TEXT, source TEXT,
  PRIMARY KEY (set_num, market, observed_at)
)`,

  pricing_anomalies: `CREATE TABLE IF NOT EXISTS pricing_anomalies (
  anomaly_key TEXT PRIMARY KEY, set_num TEXT, condition TEXT, source TEXT,
  anomaly_type TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'warning', detail_json TEXT,
  status TEXT NOT NULL DEFAULT 'open', first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT
)`,

  amazon_product_map: `CREATE TABLE IF NOT EXISTS amazon_product_map (
  set_num TEXT NOT NULL, market TEXT NOT NULL, asin TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'quarantined', match_method TEXT,
  match_confidence REAL NOT NULL DEFAULT 0, checked_at TEXT,
  PRIMARY KEY (set_num, market), UNIQUE (market, asin)
)`,

  client_metrics_daily: `CREATE TABLE IF NOT EXISTS client_metrics_daily (
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event, detail)
)`,
  minifig_bl_candidates: `CREATE TABLE IF NOT EXISTS minifig_bl_candidates (
  fig_num TEXT NOT NULL REFERENCES minifigs(fig_num),
  bl_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected')),
  evidence_json TEXT,
  first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  checked_at TEXT,
  decided_at TEXT,
  PRIMARY KEY (fig_num, bl_id)
)`,
  community_comps: `CREATE TABLE IF NOT EXISTS community_comps (
  set_num TEXT NOT NULL REFERENCES lego_sets(set_num),
  condition TEXT NOT NULL CHECK(condition IN ('new_sealed','used_complete')),
  median REAL NOT NULL,
  p25 REAL,
  p75 REAL,
  sample_count INTEGER NOT NULL,
  contributor_count INTEGER NOT NULL,
  window_days INTEGER NOT NULL DEFAULT 365,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (set_num, condition)
)`,
  price_guesses: `CREATE TABLE IF NOT EXISTS price_guesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  set_num TEXT NOT NULL,
  guessed_value REAL NOT NULL,
  actual_value REAL NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`,
  collection_stories: `CREATE TABLE IF NOT EXISTS collection_stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  set_num TEXT NOT NULL,
  collection_id INTEGER,
  kind TEXT NOT NULL DEFAULT 'note' CHECK(kind IN ('note','photo')),
  body TEXT,
  r2_key TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`,
  pricing_write_ledger: `CREATE TABLE IF NOT EXISTS pricing_write_ledger (
  day TEXT NOT NULL, job TEXT NOT NULL, rows_written INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (day, job)
)`,

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
  sold_price REAL,
  sold_at DATE,
  UNIQUE(user_id, set_num)
)`,

  minifigs: `CREATE TABLE IF NOT EXISTS minifigs (
  fig_num TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  series TEXT,
  rarity TEXT DEFAULT 'common' CHECK(rarity IN ('common','uncommon','rare','legendary')),
  current_value REAL,
  image_url TEXT,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  source TEXT,
  cached_at TEXT,
  year INTEGER,
  num_parts INTEGER,
  appears_in_sets INTEGER,
  ebay_value REAL,
  ebay_qty INTEGER,
  ebay_cached_at TEXT,
  bl_id TEXT,
  img_prewarmed_at TEXT
)`,

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
)`,

  rate_limits: `CREATE TABLE IF NOT EXISTS rate_limits (
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  window_start DATETIME NOT NULL,
  hit_count INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, endpoint, window_start)
)`,

  user_prefs: `CREATE TABLE IF NOT EXISTS user_prefs (
  user_id TEXT PRIMARY KEY,
  handle TEXT,
  display_name TEXT,
  currency TEXT DEFAULT 'USD',
  retail_market TEXT DEFAULT 'FR',
  notify_price_drops INTEGER DEFAULT 1,
  notify_weekly_digest INTEGER DEFAULT 0,
  is_public INTEGER NOT NULL DEFAULT 0,
  expose_public_value INTEGER DEFAULT 1,
  google_refresh_token TEXT,
  google_spreadsheet_id TEXT,
  email TEXT,
  discord_webhook_url TEXT,
  brickset_user_hash TEXT,
  is_supporter INTEGER DEFAULT 0,
  supporter_since TEXT,
  stripe_customer_id TEXT,
  kids_pin_hash TEXT,
  kids_xp INTEGER NOT NULL DEFAULT 0,
  kids_level INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`,

  portfolio_snapshots: `CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  snapshot_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  total_value REAL DEFAULT 0,
  total_paid REAL DEFAULT 0,
  set_count INTEGER DEFAULT 0,
  UNIQUE(user_id, snapshot_date)
)`,

  user_wishlist: `CREATE TABLE IF NOT EXISTS user_wishlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  set_num TEXT NOT NULL REFERENCES lego_sets(set_num),
  target_price REAL,
  notes TEXT,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  alerted_at DATETIME,
  UNIQUE(user_id, set_num)
)`,

  wishlist_alerts: `CREATE TABLE IF NOT EXISTS wishlist_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  set_num TEXT NOT NULL,
  set_name TEXT,
  target_price REAL,
  current_value REAL,
  triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  read_at DATETIME,
  alert_type TEXT NOT NULL DEFAULT 'drop'
)`,

  set_value_history: `CREATE TABLE IF NOT EXISTS set_value_history (
  set_num TEXT NOT NULL REFERENCES lego_sets(set_num),
  snapshot_date DATE NOT NULL,
  current_value REAL,
  ebay_value REAL,
  bl_value REAL,
  PRIMARY KEY (set_num, snapshot_date)
)`,

  minifig_value_history: `CREATE TABLE IF NOT EXISTS minifig_value_history (
  fig_num TEXT NOT NULL REFERENCES minifigs(fig_num),
  snapshot_date DATE NOT NULL,
  current_value REAL,
  ebay_value REAL,
  PRIMARY KEY (fig_num, snapshot_date)
)`,

  user_minifigs: `CREATE TABLE IF NOT EXISTS user_minifigs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  fig_num TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, fig_num)
)`,
  set_minifigs: `CREATE TABLE IF NOT EXISTS set_minifigs (
  set_num TEXT NOT NULL REFERENCES lego_sets(set_num),
  fig_num TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  fig_name TEXT,
  fig_img_url TEXT,
  PRIMARY KEY (set_num, fig_num)
)`,

  set_parts: `CREATE TABLE IF NOT EXISTS set_parts (
  set_num TEXT NOT NULL REFERENCES lego_sets(set_num),
  part_num TEXT NOT NULL,
  color_id INTEGER NOT NULL DEFAULT 0,
  color_name TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  is_spare INTEGER NOT NULL DEFAULT 0,
  part_name TEXT,
  part_img_url TEXT,
  PRIMARY KEY (set_num, part_num, color_id)
)`,

  part_prices: `CREATE TABLE IF NOT EXISTS part_prices (
  part_num TEXT NOT NULL,
  color_id INTEGER NOT NULL DEFAULT 0,
  price_new REAL,
  qty_new INTEGER,
  price_used REAL,
  qty_used INTEGER,
  cached_at TEXT,
  PRIMARY KEY (part_num, color_id)
)`,

  upcoming_sets: `CREATE TABLE IF NOT EXISTS upcoming_sets (
  set_num TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_usd REAL,
  availability TEXT,
  first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  scraped_at TEXT
)`,

  oauth_sessions: `CREATE TABLE IF NOT EXISTS oauth_sessions (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
)`,

  oauth_states: `CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
)`,

  integration_health: `CREATE TABLE IF NOT EXISTS integration_health (
  service TEXT PRIMARY KEY,
  last_ok_at TEXT,
  last_fail_at TEXT,
  last_error TEXT,
  ok_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  blocked_until TEXT
)`,

  push_subscriptions: `CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, endpoint)
)`,

  native_push_tokens: `CREATE TABLE IF NOT EXISTS native_push_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  token TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'android',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, token)
)`,

  api_quota: `CREATE TABLE IF NOT EXISTS api_quota (
  service TEXT NOT NULL,
  day TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  cap INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  PRIMARY KEY (service, day)
)`,

  brightdata_keys: `CREATE TABLE IF NOT EXISTS brightdata_keys (
  key_hash TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0,
  cap INTEGER NOT NULL DEFAULT 5000,
  period_month TEXT,
  exhausted_at TEXT,
  last_used_at TEXT,
  updated_at TEXT
)`,

  app_settings: `CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
)`,

  cron_runs: `CREATE TABLE IF NOT EXISTS cron_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  status TEXT DEFAULT 'running',
  summary TEXT,
  error TEXT,
  duration_ms INTEGER
)`,
};

/**
 * Create the named tables (dropping any prior copy) in a test D1.
 *
 * D1 enforces foreign keys, so DROP order matters: child tables reference
 * lego_sets/minifigs and can hold rows after a test. Callers list parents first,
 * so we drop in REVERSE (children before parents) and create forward.
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
