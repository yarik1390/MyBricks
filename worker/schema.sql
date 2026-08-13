CREATE TABLE IF NOT EXISTS lego_themes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id INTEGER
);

CREATE TABLE IF NOT EXISTS lego_sets (
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
);

-- Extended market fields, kept in a side table because lego_sets is at D1's
-- 100-column-per-table ceiling. One row per set; LEFT JOIN into lego_sets reads.
--   pc_loose_value   PriceCharting loose (used/incomplete) value (USD)
--   pc_sales_volume  PriceCharting yearly units sold (liquidity signal)
--   pa_*             pricesAPI.io live retail/offers layer (deal/stock/alerts)
CREATE TABLE IF NOT EXISTS set_market_ext (
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
  -- eBay-sold LAST-ATTEMPT stamp (any outcome). Separate from lego_sets.ebay_new_cached_at
  -- (which is success-only and feeds the blend's freshness): the scrape job orders/
  -- filters candidates by this so a miss drops out of the queue for a cooldown
  -- instead of perpetually re-sorting to the front (the neg-cache-wall stall).
  ebay_sold_attempted_at TEXT,
  -- Independent miss/retry marker for used-condition eBay sold comps. Keeping it
  -- separate prevents a new-condition result from starving the used backfill.
  ebay_used_attempted_at TEXT,
  pc_attempted_at TEXT,
  -- BrickLink no-data backoff stamp (sold guide <5 lots): the valuation job skips
  -- this set's BrickLink calls for 90 days so the ~5,000/day budget isn't wasted
  -- re-querying sets that will never have data. Cleared when a BL price returns.
  bl_nodata_at TEXT
);

-- Pricing Engine v3 keeps identity, normalized observations and condition-aware
-- valuation outside lego_sets (which is already at D1's 100-column ceiling).
CREATE TABLE IF NOT EXISTS pricing_source_map (
  source TEXT NOT NULL,
  source_item_id TEXT NOT NULL,
  set_num TEXT REFERENCES lego_sets(set_num),
  source_title TEXT,
  upc TEXT,
  variant_key TEXT,
  match_method TEXT,
  match_confidence REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'quarantined' CHECK(status IN ('verified','quarantined','rejected','manual')),
  verified_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source, source_item_id)
);
CREATE INDEX IF NOT EXISTS idx_pricing_source_map_set ON pricing_source_map(set_num, source, status);
CREATE INDEX IF NOT EXISTS idx_pricing_source_map_review ON pricing_source_map(status, source, updated_at);
CREATE INDEX IF NOT EXISTS idx_pricing_source_map_upc ON pricing_source_map(source, upc);

CREATE TABLE IF NOT EXISTS pricing_signals (
  set_num TEXT NOT NULL REFERENCES lego_sets(set_num),
  source TEXT NOT NULL,
  source_item_id TEXT,
  provider_family TEXT NOT NULL,
  condition TEXT NOT NULL CHECK(condition IN ('new_sealed','used_complete','loose')),
  signal_type TEXT NOT NULL CHECK(signal_type IN ('sold','modeled','asking','estimate')),
  currency TEXT NOT NULL DEFAULT 'USD',
  value REAL NOT NULL,
  low REAL,
  high REAL,
  sample_count INTEGER,
  sales_volume INTEGER,
  source_observed_at TEXT,
  checked_at TEXT NOT NULL,
  match_status TEXT NOT NULL DEFAULT 'quarantined',
  flags_json TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (set_num, source, condition)
);
CREATE INDEX IF NOT EXISTS idx_pricing_signals_refresh ON pricing_signals(condition, checked_at);
CREATE INDEX IF NOT EXISTS idx_pricing_signals_family ON pricing_signals(set_num, condition, provider_family);

CREATE TABLE IF NOT EXISTS set_valuation_state (
  set_num TEXT NOT NULL REFERENCES lego_sets(set_num),
  condition TEXT NOT NULL CHECK(condition IN ('new_sealed','used_complete','loose')),
  fair_value REAL,
  low REAL,
  high REAL,
  liquidation_value REAL,
  confidence TEXT NOT NULL DEFAULT 'estimated',
  confidence_score INTEGER NOT NULL DEFAULT 0,
  sample_count INTEGER NOT NULL DEFAULT 0,
  independent_family_count INTEGER NOT NULL DEFAULT 0,
  basis_json TEXT NOT NULL DEFAULT '[]',
  flags_json TEXT NOT NULL DEFAULT '[]',
  forecast_json TEXT,
  as_of TEXT,
  model_version TEXT NOT NULL DEFAULT 'v3-shadow',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (set_num, condition)
);
CREATE INDEX IF NOT EXISTS idx_valuation_state_confidence ON set_valuation_state(condition, confidence, as_of);

CREATE TABLE IF NOT EXISTS set_valuation_history_v2 (
  set_num TEXT NOT NULL REFERENCES lego_sets(set_num),
  condition TEXT NOT NULL CHECK(condition IN ('new_sealed','used_complete','loose')),
  snapshot_date TEXT NOT NULL,
  fair_value REAL,
  low REAL,
  high REAL,
  confidence TEXT,
  model_version TEXT,
  PRIMARY KEY (set_num, condition, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_valuation_history_v2_date ON set_valuation_history_v2(snapshot_date);

CREATE TABLE IF NOT EXISTS retail_price_current (
  set_num TEXT NOT NULL REFERENCES lego_sets(set_num),
  market TEXT NOT NULL,
  currency TEXT NOT NULL,
  item_price REAL,
  delivered_price REAL,
  merchant TEXT,
  stock TEXT,
  offer_count INTEGER,
  msrp REAL,
  lowest_90d REAL,
  all_time_low REAL,
  checked_at TEXT NOT NULL,
  source TEXT,
  PRIMARY KEY (set_num, market)
);
CREATE INDEX IF NOT EXISTS idx_retail_current_refresh ON retail_price_current(market, checked_at);

CREATE TABLE IF NOT EXISTS retail_price_history (
  set_num TEXT NOT NULL REFERENCES lego_sets(set_num),
  market TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  delivered_price REAL,
  merchant TEXT,
  stock TEXT,
  source TEXT,
  PRIMARY KEY (set_num, market, observed_at)
);
CREATE INDEX IF NOT EXISTS idx_retail_history_lookup ON retail_price_history(set_num, market, observed_at);

CREATE TABLE IF NOT EXISTS pricing_anomalies (
  anomaly_key TEXT PRIMARY KEY,
  set_num TEXT REFERENCES lego_sets(set_num),
  condition TEXT,
  source TEXT,
  anomaly_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  detail_json TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','ignored')),
  first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pricing_anomalies_open ON pricing_anomalies(status, severity, last_seen_at);

CREATE TABLE IF NOT EXISTS amazon_product_map (
  set_num TEXT NOT NULL REFERENCES lego_sets(set_num),
  market TEXT NOT NULL,
  asin TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'quarantined',
  match_method TEXT,
  match_confidence REAL NOT NULL DEFAULT 0,
  checked_at TEXT,
  PRIMARY KEY (set_num, market),
  UNIQUE (market, asin)
);

-- One compact row per job/day. New pricing jobs add D1 meta.rows_written here;
-- the watchdog uses it to pause non-critical work before the paid-plan ceiling.
CREATE TABLE IF NOT EXISTS pricing_write_ledger (
  day TEXT NOT NULL,
  job TEXT NOT NULL,
  rows_written INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (day, job)
);

CREATE TABLE IF NOT EXISTS user_collection (
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
);

-- First-party community comps: anonymized aggregates of what collectors
-- actually paid/sold for, per set + condition bucket. Written nightly by the
-- community-comps job (k>=5 distinct contributors, outlier-trimmed). Read-side
-- integration into the blend comes later (v3 dual-write discipline).
-- Daily client telemetry counters (D1 mirror of the Analytics Engine events
-- that back operational SLOs — AE can't be queried from the Worker). Detail is
-- LOW-CARDINALITY by contract: scan modes only; client_error collapses to ''.
CREATE TABLE IF NOT EXISTS client_metrics_daily (
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event, detail)
);

-- Minifig identity verification queue: Rebrickable->BrickLink name matches
-- that resolveBlId could NOT disambiguate (multiple same-name candidates) are
-- parked here and settled by price-agreement (minifig-verify job) instead of
-- being silently dropped — the same identity discipline sets get from
-- pricing_source_map.
CREATE TABLE IF NOT EXISTS minifig_bl_candidates (
  fig_num TEXT NOT NULL REFERENCES minifigs(fig_num),
  bl_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected')),
  evidence_json TEXT,
  first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  checked_at TEXT,
  decided_at TEXT,
  PRIMARY KEY (fig_num, bl_id)
);
CREATE INDEX IF NOT EXISTS idx_minifig_bl_candidates_status ON minifig_bl_candidates(status, checked_at);

CREATE TABLE IF NOT EXISTS community_comps (
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
);

-- Daily price game guesses (signed-in players only). ANALYTICS ONLY — a crowd
-- price prior that never touches the valuation blend. Rate-limited writes.
CREATE TABLE IF NOT EXISTS price_guesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  set_num TEXT NOT NULL,
  guessed_value REAL NOT NULL,
  actual_value REAL NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_guesses_day_set ON price_guesses(day, set_num);

-- Set stories: per-user memories attached to a set — notes and photos on a
-- timeline ("built it with my son", the eBay find photo). Keyed by set_num
-- (not collection_id) so memories survive selling and re-adding a set;
-- collection_id is informational. Photos live in R2 under stories/.
CREATE TABLE IF NOT EXISTS collection_stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  set_num TEXT NOT NULL,
  collection_id INTEGER,
  kind TEXT NOT NULL DEFAULT 'note' CHECK(kind IN ('note','photo')),
  body TEXT,
  r2_key TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_stories_user_set ON collection_stories(user_id, set_num);

CREATE TABLE IF NOT EXISTS minifigs (
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
);

-- Default minifig browse sort (rarity tier, then name) — same expression-index
-- reasoning as idx_sets_browse_value: the CASE on rarity is not indexable as a
-- plain column, so listing figs scanned all ~17k rows into a temp b-tree to
-- return 30. Measured 34,136 rows read / ~29ms before, 30 rows / ~0.5ms after.
-- Keep in sync with the rarity_desc ORDER BY in routes/minifigs.ts.
CREATE INDEX IF NOT EXISTS idx_minifigs_browse_rarity ON minifigs(
  (CASE rarity WHEN 'legendary' THEN 4 WHEN 'rare' THEN 3 WHEN 'uncommon' THEN 2 ELSE 1 END) DESC,
  name ASC
);
-- The minifig value sort, which falls back to a per-rarity nominal price when a
-- fig has no market value. Same expression-index reasoning; 34,136 rows -> 30.
CREATE INDEX IF NOT EXISTS idx_minifigs_browse_value ON minifigs(
  COALESCE(current_value, CASE rarity
    WHEN 'common' THEN 3.50 WHEN 'uncommon' THEN 7.50
    WHEN 'rare' THEN 18.00 WHEN 'legendary' THEN 50.00 ELSE 3.50 END) DESC,
  name ASC
);

CREATE TABLE IF NOT EXISTS user_minifigs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  fig_num TEXT NOT NULL REFERENCES minifigs(fig_num),
  quantity INTEGER DEFAULT 1,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, fig_num)
);

CREATE TABLE IF NOT EXISTS import_runs (
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
);

CREATE TABLE IF NOT EXISTS rate_limits (
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  window_start DATETIME NOT NULL,
  hit_count INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, endpoint, window_start)
);

CREATE TABLE IF NOT EXISTS user_prefs (
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
);

CREATE TABLE IF NOT EXISTS kids_badges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  badge_slug TEXT NOT NULL,
  awarded_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, badge_slug)
);
CREATE INDEX IF NOT EXISTS idx_kids_badges_user ON kids_badges(user_id);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  snapshot_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  total_value REAL DEFAULT 0,
  total_paid REAL DEFAULT 0,
  set_count INTEGER DEFAULT 0,
  UNIQUE(user_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS user_wishlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  set_num TEXT NOT NULL REFERENCES lego_sets(set_num),
  target_price REAL,
  notes TEXT,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  alerted_at DATETIME,
  UNIQUE(user_id, set_num)
);

CREATE TABLE IF NOT EXISTS wishlist_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  set_num TEXT NOT NULL,
  set_name TEXT,
  target_price REAL,
  current_value REAL,
  triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  read_at DATETIME,
  alert_type TEXT NOT NULL DEFAULT 'drop'
);

CREATE TABLE IF NOT EXISTS set_value_history (
  set_num TEXT NOT NULL REFERENCES lego_sets(set_num),
  snapshot_date DATE NOT NULL,
  current_value REAL,
  ebay_value REAL,
  bl_value REAL,
  PRIMARY KEY (set_num, snapshot_date)
);

-- Per-minifig value snapshots powering the minifig trend chart (mirrors
-- set_value_history). Daily granularity, bounded retention pruned by the job.
CREATE TABLE IF NOT EXISTS minifig_value_history (
  fig_num TEXT NOT NULL REFERENCES minifigs(fig_num),
  snapshot_date DATE NOT NULL,
  current_value REAL,
  ebay_value REAL,
  PRIMARY KEY (fig_num, snapshot_date)
);

CREATE TABLE IF NOT EXISTS set_minifigs (
  set_num TEXT NOT NULL REFERENCES lego_sets(set_num),
  fig_num TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  fig_name TEXT,
  fig_img_url TEXT,
  PRIMARY KEY (set_num, fig_num)
);

CREATE TABLE IF NOT EXISTS set_parts (
  set_num TEXT NOT NULL REFERENCES lego_sets(set_num),
  part_num TEXT NOT NULL,
  color_id INTEGER NOT NULL DEFAULT 0,
  color_name TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  is_spare INTEGER NOT NULL DEFAULT 0,
  part_name TEXT,
  part_img_url TEXT,
  PRIMARY KEY (set_num, part_num, color_id)
);

-- Shared per-part price cache (E1 part-out): keyed (part_num, color_id), filled
-- by a budget-gated trickle and reused across every set containing the part.
CREATE TABLE IF NOT EXISTS part_prices (
  part_num TEXT NOT NULL,
  color_id INTEGER NOT NULL DEFAULT 0,
  price_new REAL,
  qty_new INTEGER,
  price_used REAL,
  qty_used INTEGER,
  cached_at TEXT,
  PRIMARY KEY (part_num, color_id)
);

-- Upcoming / coming-soon LEGO sets (G2b release feed), scraped from LEGO.com.
CREATE TABLE IF NOT EXISTS upcoming_sets (
  set_num TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_usd REAL,
  availability TEXT,
  first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  scraped_at TEXT
);

CREATE TABLE IF NOT EXISTS user_missing_parts (
  user_id TEXT NOT NULL,
  set_num TEXT NOT NULL,
  part_num TEXT NOT NULL,
  color_id INTEGER NOT NULL DEFAULT 0,
  missing_qty INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, set_num, part_num, color_id)
);

CREATE INDEX IF NOT EXISTS idx_set_minifigs_set ON set_minifigs(set_num);
CREATE INDEX IF NOT EXISTS idx_set_minifigs_fig ON set_minifigs(fig_num);
CREATE INDEX IF NOT EXISTS idx_set_parts_set ON set_parts(set_num);
CREATE INDEX IF NOT EXISTS idx_part_prices_cached ON part_prices(cached_at);
CREATE INDEX IF NOT EXISTS idx_user_missing_user ON user_missing_parts(user_id, set_num);

-- Alternate builds (MOCs buildable from a set's parts), cached from Rebrickable
-- GET /api/v3/lego/sets/{set}/alternates/. Catalog-level (shared across users);
-- powers the "What Can I Build?" feature. set_alts_fetched records which sets
-- have been queried so "no alternates" is distinct from "not fetched yet".
CREATE TABLE IF NOT EXISTS set_alt_builds (
  set_num TEXT NOT NULL,
  moc_num TEXT NOT NULL,
  name TEXT,
  num_parts INTEGER,
  year INTEGER,
  designer TEXT,
  moc_img_url TEXT,
  moc_url TEXT,
  cached_at TEXT,
  PRIMARY KEY (set_num, moc_num)
);
CREATE INDEX IF NOT EXISTS idx_set_alt_builds_set ON set_alt_builds(set_num);

CREATE TABLE IF NOT EXISTS set_alts_fetched (
  set_num TEXT PRIMARY KEY,
  fetched_at TEXT,
  alt_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_build_cache (
  user_id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  payload TEXT NOT NULL,
  computed_at INTEGER NOT NULL
);


CREATE TABLE IF NOT EXISTS user_showcase (
  user_id TEXT NOT NULL,
  set_num TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, set_num),
  FOREIGN KEY (set_num) REFERENCES lego_sets(set_num)
);

CREATE TABLE IF NOT EXISTS oauth_sessions (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_health (
  service TEXT PRIMARY KEY,
  last_ok_at TEXT,
  last_fail_at TEXT,
  last_error TEXT,
  ok_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  blocked_until TEXT
);

CREATE INDEX IF NOT EXISTS idx_svh_set ON set_value_history(set_num, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_uc_user ON user_collection(user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_wl_user ON user_wishlist(user_id);
CREATE INDEX IF NOT EXISTS idx_ps_user ON portfolio_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_rl_user ON rate_limits(user_id, endpoint);
CREATE INDEX IF NOT EXISTS idx_sets_theme ON lego_sets(theme);
CREATE INDEX IF NOT EXISTS idx_sets_retired ON lego_sets(retired);
CREATE INDEX IF NOT EXISTS idx_sets_upc ON lego_sets(upc);
-- Catalog filter/sort indexes (Phase-2 filters + ranges were full-scanning ~27k rows).
CREATE INDEX IF NOT EXISTS idx_sets_theme_group ON lego_sets(theme_group);
CREATE INDEX IF NOT EXISTS idx_sets_category ON lego_sets(category);
CREATE INDEX IF NOT EXISTS idx_sets_year ON lego_sets(year);
CREATE INDEX IF NOT EXISTS idx_sets_pieces ON lego_sets(pieces);
CREATE INDEX IF NOT EXISTS idx_sets_current_value ON lego_sets(current_value);
CREATE INDEX IF NOT EXISTS idx_sets_blended_value ON lego_sets(blended_value);
-- Default catalog browse sort (SORTS.value_desc in routes/sets-sql.ts). The two
-- plain indexes above CANNOT serve it: the ORDER BY is a CASE plus a
-- COALESCE(NULLIF(...)), and SQLite will not use a column index for an
-- expression. So the catalog's first screen scanned all ~27k rows and sorted
-- them in a temp b-tree to return 24 — measured at 55,320 rows read (the scan,
-- doubled by the set_market_ext join) and ~51ms, on every page load.
--
-- An EXPRESSION index matching the ORDER BY exactly turns that into an ordered
-- walk: measured 24 rows read and ~0.9ms, identical results. Keep this in sync
-- with SORTS.value_desc — if that expression changes and this does not, the
-- index silently stops matching and the full scan comes back.
CREATE INDEX IF NOT EXISTS idx_sets_browse_value ON lego_sets(
  (CASE WHEN valuation_method IN ('formula_bulk','local') THEN 1 ELSE 0 END),
  COALESCE(NULLIF(blended_value, 0), current_value) DESC,
  set_num
);
-- The remaining catalog sorts, same reasoning: every one of them was a full scan
-- plus a temp b-tree. Measured 55,320 rows -> 24-49 rows each.
--   az/za      -> plain name sort had no index at all
--   year_*     -> the leading (year IS NULL) expression blocked idx_sets_year
--   roi_*      -> a division expression, not a column
CREATE INDEX IF NOT EXISTS idx_sets_name ON lego_sets(name);
CREATE INDEX IF NOT EXISTS idx_sets_year_sort ON lego_sets((year IS NULL), year DESC, set_num);
CREATE INDEX IF NOT EXISTS idx_sets_roi ON lego_sets((current_value / NULLIF(retail_price, 0)) DESC, set_num);
-- sort=trending drives from the snapshot side (see routes/sets.ts): this makes
-- "the snapshot for date X" a range scan instead of 27k per-row probes.
CREATE INDEX IF NOT EXISTS idx_svh_date_set ON set_value_history(snapshot_date, set_num);
CREATE INDEX IF NOT EXISTS idx_showcase_user ON user_showcase(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prefs_handle ON user_prefs(handle) WHERE handle IS NOT NULL;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS native_push_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  token TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'android',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, token)
);
CREATE INDEX IF NOT EXISTS idx_native_push_user ON native_push_tokens(user_id);

-- FTS5 search — STANDALONE (not external-content), and IDEMPOTENT. schema.sql
-- runs on every deploy, so this must NOT drop + rebuild the index (that wrote
-- ~425k rows per deploy). The IF NOT EXISTS + backfill-when-empty form makes a
-- re-run a no-op once the index exists; the triggers keep it current. Standalone
-- (no content='lego_sets') so it can't raise SQLITE_CORRUPT_VTAB when it diverges
-- from lego_sets under heavy writes — the cause of the FTS rebuild loop.
CREATE VIRTUAL TABLE IF NOT EXISTS lego_sets_fts USING fts5(
  set_num,
  name,
  theme,
  subtheme,
  theme_group,
  brickset_tags
);

CREATE TRIGGER IF NOT EXISTS lego_sets_ai AFTER INSERT ON lego_sets BEGIN
  INSERT INTO lego_sets_fts(rowid, set_num, name, theme, subtheme, theme_group, brickset_tags)
  VALUES (new.rowid, new.set_num, new.name, new.theme, new.subtheme, new.theme_group, new.brickset_tags);
END;

CREATE TRIGGER IF NOT EXISTS lego_sets_ad AFTER DELETE ON lego_sets BEGIN
  DELETE FROM lego_sets_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER IF NOT EXISTS lego_sets_au AFTER UPDATE OF set_num, name, theme, subtheme, theme_group, brickset_tags ON lego_sets BEGIN
  DELETE FROM lego_sets_fts WHERE rowid = old.rowid;
  INSERT INTO lego_sets_fts(rowid, set_num, name, theme, subtheme, theme_group, brickset_tags)
  VALUES(new.rowid, new.set_num, new.name, new.theme, new.subtheme, new.theme_group, new.brickset_tags);
END;

-- One-time backfill: only runs while the index is empty (fresh DB). On an already
-- populated index this inserts nothing, so re-running schema.sql writes no rows.
INSERT INTO lego_sets_fts(rowid, set_num, name, theme, subtheme, theme_group, brickset_tags)
SELECT rowid, set_num, name, theme, subtheme, theme_group, brickset_tags FROM lego_sets
WHERE NOT EXISTS (SELECT 1 FROM lego_sets_fts);

-- Per-source daily external-API budget ledger (Pricing Engine v2.1 Phase 1c).
-- One row per (service, UTC day); `used` is incremented by spend/reserve
-- helpers in src/lib/api-quota.ts before external calls are made.
CREATE TABLE IF NOT EXISTS api_quota (
  service TEXT NOT NULL,
  day TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  cap INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  PRIMARY KEY (service, day)
);

-- Per-key monthly budget ledger for the pricesAPI.io rotating-key pool. Keys are
-- stored only as SHA-256 hashes. period_month (YYYY-MM) buckets the monthly
-- budget; a key is "drained" when used >= cap or exhausted_at is set in the
-- current month. See worker/src/lib/pricesapi-keys.ts.
CREATE TABLE IF NOT EXISTS pricesapi_keys (
  key_hash TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0,
  cap INTEGER NOT NULL DEFAULT 1000,
  period_month TEXT,
  exhausted_at TEXT,
  last_used_at TEXT,
  updated_at TEXT
);

-- Per-token monthly request safety cap for Bright Data Web Unlocker. The
-- provider may bill usage differently; this is a conservative one-request/one-
-- unit local ledger. Secrets are never stored: key_hash is SHA-256, and usage /
-- exhaustion resets by UTC month.
CREATE TABLE IF NOT EXISTS brightdata_keys (
  key_hash TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0,
  cap INTEGER NOT NULL DEFAULT 4900,
  period_month TEXT,
  exhausted_at TEXT,
  last_used_at TEXT,
  updated_at TEXT
);

-- Firecrawl key pool. NOT monthly: the balances are one-time credit allotments,
-- so `used` accumulates forever and a key is retired once Firecrawl answers 402.
CREATE TABLE IF NOT EXISTS firecrawl_keys (
  key_hash TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0,
  cap INTEGER NOT NULL DEFAULT 0,
  exhausted_at TEXT,
  last_used_at TEXT,
  updated_at TEXT
);


-- Generic key/value settings store (JSON values). Backs the admin source-tuning
-- console (key 'source_config'); read fail-open with code defaults so a bad or
-- missing row never breaks pricing. See worker/src/lib/source-config.ts.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);

-- Background-process run history. Every cron (via the run() wrapper in index.ts)
-- records a row: running -> ok|failed, with a short result summary. Powers the
-- admin "Activity" live view. Pruned to the last few rows per process name.
-- See worker/src/lib/cron-runs.ts.
CREATE TABLE IF NOT EXISTS cron_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  status TEXT DEFAULT 'running',
  summary TEXT,
  error TEXT,
  duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cron_runs_name ON cron_runs(name, id);

-- ============================================================
-- User contributions (admin-reviewed). Three purpose-built tables
-- sharing one moderation lifecycle: status pending|approved|rejected,
-- reviewer_id/review_note/reviewed_at set on moderation, deleted_at for
-- soft-deletes (withdrawals). See worker/src/routes/contributions.ts.
-- ============================================================

-- Per-set star ratings + optional written reviews (one live row per user/set).
CREATE TABLE IF NOT EXISTS set_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  set_num TEXT NOT NULL,
  rating INTEGER NOT NULL,
  title TEXT,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewer_id TEXT,
  review_note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME,
  deleted_at DATETIME
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_set_reviews_user_set ON set_reviews(user_id, set_num) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_set_reviews_set_status ON set_reviews(set_num, status);

-- Shared set-photo gallery; bytes live in PHOTO_BUCKET (R2) under r2_key.
CREATE TABLE IF NOT EXISTS set_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  set_num TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  caption TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewer_id TEXT,
  review_note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME,
  deleted_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_set_photos_set_status ON set_photos(set_num, status);

-- Catalog data fixes / reports: kind in barcode|price|image|partlist|metadata;
-- payload is JSON specific to the kind. Only barcode auto-applies on approve.
CREATE TABLE IF NOT EXISTS set_contributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  set_num TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewer_id TEXT,
  review_note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME,
  deleted_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_set_contributions_status ON set_contributions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_set_contributions_user ON set_contributions(user_id);

-- Translated set descriptions. Descriptions are CATALOG DATA, not UI copy: a
-- unique ~1,400-character paragraph per set, 9,681 sets, 13.3M characters. Bulk
-- pre-translation into eight languages would be ~106M characters of model
-- output for text most sets never have read. So they are translated ON VIEW and
-- cached here forever (a description changes only if Brickset rewrites it).
CREATE TABLE IF NOT EXISTS set_description_i18n (
  set_num TEXT NOT NULL REFERENCES lego_sets(set_num),
  lang TEXT NOT NULL,
  description TEXT NOT NULL,
  source_hash TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (set_num, lang)
);
