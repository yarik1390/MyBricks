-- Additive migrations for databases created before v2.
-- Run with error suppression (|| true) — duplicate column errors are expected on re-deploys.
ALTER TABLE lego_sets ADD COLUMN ebay_value REAL;
ALTER TABLE lego_sets ADD COLUMN ebay_cached_at TEXT;
ALTER TABLE lego_sets ADD COLUMN ebay_new_value REAL;
ALTER TABLE lego_sets ADD COLUMN ebay_used_value REAL;
ALTER TABLE lego_sets ADD COLUMN ebay_new_qty INTEGER;
ALTER TABLE lego_sets ADD COLUMN ebay_used_qty INTEGER;
ALTER TABLE lego_sets ADD COLUMN ebay_new_cached_at TEXT;
ALTER TABLE lego_sets ADD COLUMN ebay_used_cached_at TEXT;
ALTER TABLE lego_sets ADD COLUMN used_value REAL;
ALTER TABLE lego_sets ADD COLUMN retirement_risk_score INTEGER;
ALTER TABLE lego_sets ADD COLUMN retirement_risk_updated_at TEXT;
ALTER TABLE wishlist_alerts ADD COLUMN alert_type TEXT NOT NULL DEFAULT 'drop';
ALTER TABLE user_collection ADD COLUMN spike_alerted_at TEXT;
ALTER TABLE user_prefs ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_runs ADD COLUMN job_type TEXT;
ALTER TABLE import_runs ADD COLUMN updated_at DATETIME;
ALTER TABLE import_runs ADD COLUMN progress_current INTEGER DEFAULT 0;
ALTER TABLE import_runs ADD COLUMN progress_total INTEGER;
ALTER TABLE import_runs ADD COLUMN progress_label TEXT;
CREATE TABLE IF NOT EXISTS user_showcase (
  user_id TEXT NOT NULL,
  set_num TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, set_num),
  FOREIGN KEY (set_num) REFERENCES lego_sets(set_num)
);
CREATE INDEX IF NOT EXISTS idx_showcase_user ON user_showcase(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prefs_handle ON user_prefs(handle) WHERE handle IS NOT NULL;

-- Google Sheets sync fields
ALTER TABLE user_prefs ADD COLUMN google_refresh_token TEXT;
ALTER TABLE user_prefs ADD COLUMN google_spreadsheet_id TEXT;

-- NOTE: a fake rarity seed used to live here (rarity derived from the last
-- digit of fig_num). It was meaningless — bulk-imported figs the seed never
-- re-touched stayed at the schema default 'common' (so every browse view was
-- all "common"), and where it did run it was just a hash. Removed 2026-06 in
-- favour of a real, data-driven backfill: rarity/series/year/appears_in_sets
-- are computed offline from the Rebrickable bulk CSVs (inventory_minifigs ×
-- inventories × sets × themes) and written directly to D1. The catalog importer
-- only touches name/image_url, so that backfill survives deploys — re-adding a
-- seed here would clobber it.

-- FTS5 search migration
DROP TRIGGER IF EXISTS lego_sets_ai;
DROP TRIGGER IF EXISTS lego_sets_ad;
DROP TRIGGER IF EXISTS lego_sets_au;
DROP TABLE IF EXISTS lego_sets_fts;

CREATE VIRTUAL TABLE lego_sets_fts USING fts5(
  set_num,
  name,
  theme,
  content='lego_sets',
  content_rowid='rowid'
);

CREATE TRIGGER lego_sets_ai AFTER INSERT ON lego_sets BEGIN
  INSERT INTO lego_sets_fts(rowid, set_num, name, theme)
  VALUES (new.rowid, new.set_num, new.name, new.theme);
END;

CREATE TRIGGER lego_sets_ad AFTER DELETE ON lego_sets BEGIN
  INSERT INTO lego_sets_fts(lego_sets_fts, rowid, set_num, name, theme)
  VALUES('delete', old.rowid, old.set_num, old.name, old.theme);
END;

CREATE TRIGGER lego_sets_au AFTER UPDATE OF set_num, name, theme ON lego_sets BEGIN
  INSERT INTO lego_sets_fts(lego_sets_fts, rowid, set_num, name, theme)
  VALUES('delete', old.rowid, old.set_num, old.name, old.theme);
  INSERT INTO lego_sets_fts(rowid, set_num, name, theme)
  VALUES(new.rowid, new.set_num, new.name, new.theme);
END;

INSERT INTO lego_sets_fts(rowid, set_num, name, theme)
SELECT rowid, set_num, name, theme FROM lego_sets
WHERE NOT EXISTS (SELECT 1 FROM lego_sets_fts LIMIT 1);

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

-- Expose public value privacy preference
ALTER TABLE user_prefs ADD COLUMN expose_public_value INTEGER DEFAULT 1;

-- BrickLink new sold price stored independently for cross-source UI
ALTER TABLE lego_sets ADD COLUMN bl_new_value REAL;
-- BrickLink lot counts for pricing confidence display
ALTER TABLE lego_sets ADD COLUMN bl_new_qty INTEGER;
ALTER TABLE lego_sets ADD COLUMN bl_used_qty INTEGER;

-- Valuation method tag and cache expiry (required by collection route SELECT)
ALTER TABLE lego_sets ADD COLUMN valuation_method TEXT DEFAULT 'formula_bulk';
ALTER TABLE lego_sets ADD COLUMN valuation_expires_at DATETIME;

-- Integration health tracking (external API success/failure)
CREATE TABLE IF NOT EXISTS integration_health (
  service TEXT PRIMARY KEY,
  last_ok_at TEXT,
  last_fail_at TEXT,
  last_error TEXT,
  ok_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);

-- Minifig enhancements: series categorization, market value, ownership tracking
ALTER TABLE minifigs ADD COLUMN series TEXT;
ALTER TABLE minifigs ADD COLUMN current_value REAL;
ALTER TABLE minifigs ADD COLUMN added_at DATETIME DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE minifigs ADD COLUMN source TEXT;

CREATE TABLE IF NOT EXISTS user_minifigs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  fig_num TEXT NOT NULL REFERENCES minifigs(fig_num),
  quantity INTEGER DEFAULT 1,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, fig_num)
);

-- Rate limiting for AI and scan endpoints
CREATE TABLE IF NOT EXISTS rate_limits (
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  window_start DATETIME NOT NULL,
  hit_count INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, endpoint, window_start)
);
CREATE INDEX IF NOT EXISTS idx_rl_user ON rate_limits(user_id, endpoint);

-- Portfolio value snapshots for historical charting
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
CREATE INDEX IF NOT EXISTS idx_ps_user ON portfolio_snapshots(user_id);

-- Per-set value snapshots for trend data in AI advisor
CREATE TABLE IF NOT EXISTS set_value_history (
  set_num TEXT NOT NULL REFERENCES lego_sets(set_num),
  snapshot_date DATE NOT NULL,
  current_value REAL,
  PRIMARY KEY (set_num, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_svh_set ON set_value_history(set_num, snapshot_date);

-- Per-minifig value snapshots powering the minifig trend chart (mirrors
-- set_value_history). Added alongside catalog-wide minifig valuation.
CREATE TABLE IF NOT EXISTS minifig_value_history (
  fig_num TEXT NOT NULL REFERENCES minifigs(fig_num),
  snapshot_date DATE NOT NULL,
  current_value REAL,
  ebay_value REAL,
  PRIMARY KEY (fig_num, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_mvh_fig ON minifig_value_history(fig_num, snapshot_date);

-- Circuit breaker: skip an external service until this timestamp after
-- access-denied failures (currently used for eBay Marketplace Insights).
ALTER TABLE integration_health ADD COLUMN blocked_until TEXT;

-- Multi-source price history: track eBay and BrickLink series alongside the
-- primary value so divergence over time can be charted.
ALTER TABLE set_value_history ADD COLUMN ebay_value REAL;
ALTER TABLE set_value_history ADD COLUMN bl_value REAL;

-- Per-source freshness: BrickLink and BrickEconomy get their own timestamps
-- instead of borrowing the shared cached_at.
ALTER TABLE lego_sets ADD COLUMN bl_cached_at TEXT;
ALTER TABLE lego_sets ADD COLUMN be_cached_at TEXT;

-- eBay supply signal: median asking price + active listing count (Browse API).
ALTER TABLE lego_sets ADD COLUMN ebay_ask_value REAL;
ALTER TABLE lego_sets ADD COLUMN ebay_ask_qty INTEGER;
ALTER TABLE lego_sets ADD COLUMN ebay_ask_cached_at TEXT;
ALTER TABLE lego_sets ADD COLUMN ebay_new_last_sold TEXT;
ALTER TABLE lego_sets ADD COLUMN ebay_used_last_sold TEXT;

-- Sprint 1: Brickset rich metadata, BrickEconomy growth rate, BrickLink price ranges, minifig valuation cache
ALTER TABLE lego_sets ADD COLUMN subtheme TEXT;
ALTER TABLE lego_sets ADD COLUMN age_min INTEGER;
ALTER TABLE lego_sets ADD COLUMN age_max INTEGER;
ALTER TABLE lego_sets ADD COLUMN brickset_rating REAL;
ALTER TABLE lego_sets ADD COLUMN brickset_review_count INTEGER;
ALTER TABLE lego_sets ADD COLUMN retired_year INTEGER;
ALTER TABLE lego_sets ADD COLUMN be_growth_12m REAL;
ALTER TABLE lego_sets ADD COLUMN bl_new_min REAL;
ALTER TABLE lego_sets ADD COLUMN bl_new_max REAL;
ALTER TABLE lego_sets ADD COLUMN bl_used_min REAL;
ALTER TABLE lego_sets ADD COLUMN bl_used_max REAL;
ALTER TABLE minifigs ADD COLUMN cached_at TEXT;

-- Sprint 2: email/Discord alerts, LEGO.com stock checks
ALTER TABLE user_prefs ADD COLUMN email TEXT;
ALTER TABLE user_prefs ADD COLUMN discord_webhook_url TEXT;
ALTER TABLE lego_sets ADD COLUMN lego_in_stock INTEGER;
ALTER TABLE lego_sets ADD COLUMN lego_retiring_soon INTEGER DEFAULT 0;
ALTER TABLE lego_sets ADD COLUMN lego_checked_at TEXT;
ALTER TABLE lego_sets ADD COLUMN lego_availability TEXT;

-- Sprint 3: BrickOwl pricing, minifig-set relationships, set parts
ALTER TABLE lego_sets ADD COLUMN bo_new_value REAL;
ALTER TABLE lego_sets ADD COLUMN bo_used_value REAL;
ALTER TABLE lego_sets ADD COLUMN bo_new_qty INTEGER;
ALTER TABLE lego_sets ADD COLUMN bo_used_qty INTEGER;
ALTER TABLE lego_sets ADD COLUMN bo_cached_at TEXT;

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


-- Sprint 4: minifig metadata, Brickset sync
ALTER TABLE minifigs ADD COLUMN year INTEGER;
ALTER TABLE minifigs ADD COLUMN num_parts INTEGER;
ALTER TABLE minifigs ADD COLUMN appears_in_sets INTEGER;

-- Multi-source minifig valuation (G1b): corroborated eBay sold comps blended
-- into current_value alongside the BrickLink guide price. Stored for
-- transparency; current_value carries the blend.
ALTER TABLE minifigs ADD COLUMN ebay_value REAL;
ALTER TABLE minifigs ADD COLUMN ebay_qty INTEGER;
ALTER TABLE minifigs ADD COLUMN ebay_cached_at TEXT;
ALTER TABLE user_prefs ADD COLUMN brickset_user_hash TEXT;

-- Sprint 5: R2 photo upload
ALTER TABLE user_collection ADD COLUMN custom_image_url TEXT;

-- Sprint 6: Web Push subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, endpoint)
);

-- Native app push subscriptions (Firebase Cloud Messaging on Android).
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

-- Pricing Engine v2.1 Phase 1c: per-source daily external-API budget ledger.
CREATE TABLE IF NOT EXISTS api_quota (
  service TEXT NOT NULL,
  day TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  cap INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  PRIMARY KEY (service, day)
);

-- Valuation v2 / Approach A: persisted blended fair value. The portfolio total,
-- profile stat and daily snapshots COALESCE(blended_value, current_value) so
-- portfolio values reflect real multi-source market pricing instead of the
-- formula estimate. Written by the valuation job + on-demand refresh/revalue.
-- NOTE (migration model): a bare `wrangler d1 execute --file` aborts on the
-- first duplicate-column error on existing DBs, so the deploy workflow extracts
-- and runs every single-line "ALTER TABLE ... ADD COLUMN" in this file
-- INDEPENDENTLY (tolerating only duplicate-column errors). That makes this file
-- the single source of truth for additive columns. To add a column: add it to
-- schema.sql's CREATE TABLE (fresh DBs) AND add one ALTER line in the
-- consolidated section below (existing DBs). Keep each ALTER on one line.
ALTER TABLE lego_sets ADD COLUMN blended_value REAL;

-- ===========================================================================
-- Consolidated additive columns — SINGLE SOURCE OF TRUTH (see NOTE above).
-- ===========================================================================
-- Columns the deploy workflow's old inline ALTER array carried, mirrored here so
-- this file is the complete superset once that array is removed:
ALTER TABLE lego_sets ADD COLUMN upc TEXT;
ALTER TABLE lego_sets ADD COLUMN cached_at DATETIME;
ALTER TABLE lego_sets ADD COLUMN source TEXT;
ALTER TABLE user_collection ADD COLUMN purchased_at DATE;
ALTER TABLE user_collection ADD COLUMN deleted_at DATETIME;
ALTER TABLE user_collection ADD COLUMN last_modified DATETIME;
ALTER TABLE user_collection ADD COLUMN storage_location TEXT;
ALTER TABLE user_collection ADD COLUMN acquisition_source TEXT;
ALTER TABLE user_collection ADD COLUMN is_complete INTEGER DEFAULT 1;
ALTER TABLE user_collection ADD COLUMN missing_pieces INTEGER DEFAULT 0;
ALTER TABLE import_runs ADD COLUMN figs_loaded INTEGER;

-- DRIFT FIX: Brickset enrichment (Phases 1-3) + BrickInsights ratings. Present
-- in schema.sql's CREATE TABLE (so fresh DBs had them) but never added to any
-- migration — existing DBs received them only via a manual D1-token apply, so a
-- from-migrations rebuild (or any other environment) would silently lack them.
ALTER TABLE lego_sets ADD COLUMN brickinsights_rating INTEGER;
ALTER TABLE lego_sets ADD COLUMN brickinsights_review_count INTEGER;
ALTER TABLE lego_sets ADD COLUMN brickinsights_url TEXT;
ALTER TABLE lego_sets ADD COLUMN brickinsights_cached_at TEXT;
ALTER TABLE lego_sets ADD COLUMN brickset_msrp REAL;
ALTER TABLE lego_sets ADD COLUMN launch_date TEXT;
ALTER TABLE lego_sets ADD COLUMN exit_date TEXT;
ALTER TABLE lego_sets ADD COLUMN brickset_enriched_at TEXT;
ALTER TABLE lego_sets ADD COLUMN theme_group TEXT;
ALTER TABLE lego_sets ADD COLUMN category TEXT;
ALTER TABLE lego_sets ADD COLUMN brickset_tags TEXT;
ALTER TABLE lego_sets ADD COLUMN brickset_dimensions TEXT;
ALTER TABLE lego_sets ADD COLUMN packaging_type TEXT;
ALTER TABLE lego_sets ADD COLUMN instructions_count INTEGER;
ALTER TABLE lego_sets ADD COLUMN additional_image_count INTEGER;
ALTER TABLE lego_sets ADD COLUMN brickset_description TEXT;
ALTER TABLE lego_sets ADD COLUMN brickset_set_id INTEGER;
ALTER TABLE lego_sets ADD COLUMN brickset_image_urls TEXT;
ALTER TABLE lego_sets ADD COLUMN brickset_images_cached_at TEXT;

-- BrickEconomy via Firecrawl (replaces the ~$1,000/mo BrickEconomy API): the
-- enrich cron scrapes the public set page into these staging columns; the
-- valuation job reads them (current value + real 2y/5y forecasts) under the
-- existing isPlausibleMarketValue gate, so a scraped figure is corroborated
-- before it can set current_value. be_growth_12m + be_cached_at already exist.
ALTER TABLE lego_sets ADD COLUMN be_value_new REAL;
ALTER TABLE lego_sets ADD COLUMN be_value_used REAL;
ALTER TABLE lego_sets ADD COLUMN be_forecast_2y REAL;
ALTER TABLE lego_sets ADD COLUMN be_forecast_5y REAL;
ALTER TABLE lego_sets ADD COLUMN be_retail REAL;

-- Part-out (sum-of-parts) value (E1): the part-out compute job sums
-- quantity x unit price over set_parts into these columns. part_out_coverage is
-- the quantity-weighted fraction of the set we actually have a price for, so the
-- value is surfaced only once coverage is high enough to be trustworthy.
ALTER TABLE lego_sets ADD COLUMN part_out_value REAL;
ALTER TABLE lego_sets ADD COLUMN part_out_coverage REAL;
ALTER TABLE lego_sets ADD COLUMN part_out_cached_at TEXT;

-- Shared per-part price cache keyed (part_num, color_id). Filled by a slow,
-- budget-gated trickle and reused across every set that contains the part, so
-- part-out coverage rises without per-set re-pricing.
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
CREATE INDEX IF NOT EXISTS idx_part_prices_cached ON part_prices(cached_at);

-- Persisted deal signal (single source of truth for the catalog deal filter +
-- deal alerts). Written by persistBlendedValue/recomputeBlendedValues using the
-- same computeDealSignal as the read-time badge, so filter/alerts/badge agree.
ALTER TABLE lego_sets ADD COLUMN deal_signal TEXT;
ALTER TABLE lego_sets ADD COLUMN deal_discount_pct REAL;
ALTER TABLE lego_sets ADD COLUMN deal_strong INTEGER;
ALTER TABLE lego_sets ADD COLUMN deal_cached_at TEXT;
CREATE INDEX IF NOT EXISTS idx_lego_deal_signal ON lego_sets(deal_signal);

-- Persisted blend confidence + likely-range band (valuation v2.2). Written by
-- persistBlendedValue/recomputeBlendedValues alongside blended_value so the
-- portfolio can roll up "% priced with high/medium confidence" and the detail
-- view shows a calibrated range without re-running the JS blend.
ALTER TABLE lego_sets ADD COLUMN blended_confidence TEXT;
ALTER TABLE lego_sets ADD COLUMN blended_low REAL;
ALTER TABLE lego_sets ADD COLUMN blended_high REAL;

-- Image pre-warm marker: stamped once the set's Rebrickable image has been
-- pulled into the R2 image cache (or attempted), so the pre-warm cron advances
-- through the catalog instead of re-checking the same sets.
ALTER TABLE lego_sets ADD COLUMN img_prewarmed_at TEXT;

-- Upcoming / coming-soon LEGO sets (G2b release feed), scraped from LEGO.com.
-- Separate from lego_sets so pre-catalog announcements never collide with the
-- Rebrickable-sourced catalog; rows are pruned once no longer listed.
CREATE TABLE IF NOT EXISTS upcoming_sets (
  set_num TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_usd REAL,
  availability TEXT,
  first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  scraped_at TEXT
);

ALTER TABLE user_prefs ADD COLUMN is_supporter INTEGER DEFAULT 0;
ALTER TABLE user_prefs ADD COLUMN supporter_since TEXT;
ALTER TABLE user_prefs ADD COLUMN stripe_customer_id TEXT;

-- User contributions (admin-reviewed). New tables — safe in the whole-file
-- backstop run; schema.sql is authoritative. See routes/contributions.ts.
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

-- PriceCharting pricing source (independent sold-comp for high-confidence blend)
ALTER TABLE lego_sets ADD COLUMN pc_new_value REAL;
ALTER TABLE lego_sets ADD COLUMN pc_complete_value REAL;
ALTER TABLE lego_sets ADD COLUMN pc_id TEXT;
ALTER TABLE lego_sets ADD COLUMN pc_cached_at TEXT;

-- Extended market fields (PriceCharting loose/liquidity + pricesAPI retail/offers)
-- live in a side table because lego_sets is at D1's 100-column ceiling.
CREATE TABLE IF NOT EXISTS set_market_ext (
  set_num TEXT PRIMARY KEY,
  pc_loose_value REAL,
  pc_sales_volume INTEGER,
  pa_retail_value REAL,
  pa_lowest_offer REAL,
  pa_in_stock INTEGER,
  pa_best_merchant TEXT,
  pa_offer_count INTEGER,
  pa_market TEXT,
  pa_cached_at TEXT
);

-- Per-key monthly budget ledger for the pricesAPI rotating-key pool.
CREATE TABLE IF NOT EXISTS pricesapi_keys (
  key_hash TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0,
  cap INTEGER NOT NULL DEFAULT 1000,
  period_month TEXT,
  exhausted_at TEXT,
  last_used_at TEXT,
  updated_at TEXT
);

-- Bright Data Web Unlocker per-key monthly budget pool (eBay sold-comp scraping).

-- Generic key/value settings store backing the admin source-tuning console.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);

-- Background-process run history (admin "Activity" live view). See lib/cron-runs.ts.
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

-- Kids Experience: PIN-gated gamification (XP + badges)
ALTER TABLE user_prefs ADD COLUMN kids_pin_hash TEXT;
ALTER TABLE user_prefs ADD COLUMN kids_xp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_prefs ADD COLUMN kids_level INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS kids_badges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  badge_slug TEXT NOT NULL,
  awarded_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, badge_slug)
);
CREATE INDEX IF NOT EXISTS idx_kids_badges_user ON kids_badges(user_id);

-- Minifig BrickLink id (resolved from the uploaded BrickLink minifig catalog).
-- Lets minifig price lookups use the real BrickLink id (e.g. sw0001) instead of
-- the Rebrickable fig-number, which BrickLink's price guide doesn't recognize.
ALTER TABLE minifigs ADD COLUMN bl_id TEXT;

-- BrickLink minifig catalog (uploaded via the admin console). The id<->name/year
-- source used to resolve minifigs.bl_id by normalized-name match.
CREATE TABLE IF NOT EXISTS bricklink_minifigs (
  bl_id TEXT PRIMARY KEY,
  name TEXT,
  norm_name TEXT,
  category TEXT,
  year INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bl_mf_norm ON bricklink_minifigs(norm_name);

-- BrickLink no-data backoff: stamped when a set's sold guide returns no reliable
-- price (<5 lots). The valuation job skips that set's BrickLink calls for 90 days
-- so the ~5,000/day API budget isn't spent re-querying sets that will never have
-- data. Cleared (set NULL) the moment a BrickLink price does come back. Lives in
-- the set_market_ext side table because lego_sets is at D1's 100-column ceiling.
ALTER TABLE set_market_ext ADD COLUMN bl_nodata_at TEXT;

-- Image mirror: stamp minifigs once their Rebrickable image has been pre-warmed
-- into R2 (same pattern as lego_sets.img_prewarmed_at) so the hourly prewarm
-- queue advances instead of re-fetching.
ALTER TABLE minifigs ADD COLUMN img_prewarmed_at TEXT;

-- Pricing Engine v3 side tables. schema.sql creates these on production deploys;
-- they live here as well for local/manual migration tooling.
CREATE TABLE IF NOT EXISTS pricing_source_map (source TEXT NOT NULL, source_item_id TEXT NOT NULL, set_num TEXT, source_title TEXT, upc TEXT, variant_key TEXT, match_method TEXT, match_confidence REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'quarantined' CHECK(status IN ('verified','quarantined','rejected','manual')), verified_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (source, source_item_id));
CREATE INDEX IF NOT EXISTS idx_pricing_source_map_set ON pricing_source_map(set_num, source, status);
CREATE INDEX IF NOT EXISTS idx_pricing_source_map_review ON pricing_source_map(status, source, updated_at);
CREATE INDEX IF NOT EXISTS idx_pricing_source_map_upc ON pricing_source_map(source, upc);
CREATE TABLE IF NOT EXISTS pricing_signals (set_num TEXT NOT NULL, source TEXT NOT NULL, source_item_id TEXT, provider_family TEXT NOT NULL, condition TEXT NOT NULL CHECK(condition IN ('new_sealed','used_complete','loose')), signal_type TEXT NOT NULL CHECK(signal_type IN ('sold','modeled','asking','estimate')), currency TEXT NOT NULL DEFAULT 'USD', value REAL NOT NULL, low REAL, high REAL, sample_count INTEGER, sales_volume INTEGER, source_observed_at TEXT, checked_at TEXT NOT NULL, match_status TEXT NOT NULL DEFAULT 'quarantined', flags_json TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (set_num, source, condition));
CREATE INDEX IF NOT EXISTS idx_pricing_signals_refresh ON pricing_signals(condition, checked_at);
CREATE INDEX IF NOT EXISTS idx_pricing_signals_family ON pricing_signals(set_num, condition, provider_family);
CREATE TABLE IF NOT EXISTS set_valuation_state (set_num TEXT NOT NULL, condition TEXT NOT NULL CHECK(condition IN ('new_sealed','used_complete','loose')), fair_value REAL, low REAL, high REAL, liquidation_value REAL, confidence TEXT NOT NULL DEFAULT 'estimated', confidence_score INTEGER NOT NULL DEFAULT 0, sample_count INTEGER NOT NULL DEFAULT 0, independent_family_count INTEGER NOT NULL DEFAULT 0, basis_json TEXT NOT NULL DEFAULT '[]', flags_json TEXT NOT NULL DEFAULT '[]', forecast_json TEXT, as_of TEXT, model_version TEXT NOT NULL DEFAULT 'v3-shadow', updated_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (set_num, condition));
CREATE INDEX IF NOT EXISTS idx_valuation_state_confidence ON set_valuation_state(condition, confidence, as_of);
CREATE TABLE IF NOT EXISTS set_valuation_history_v2 (set_num TEXT NOT NULL, condition TEXT NOT NULL CHECK(condition IN ('new_sealed','used_complete','loose')), snapshot_date TEXT NOT NULL, fair_value REAL, low REAL, high REAL, confidence TEXT, model_version TEXT, PRIMARY KEY (set_num, condition, snapshot_date));
CREATE INDEX IF NOT EXISTS idx_valuation_history_v2_date ON set_valuation_history_v2(snapshot_date);
CREATE TABLE IF NOT EXISTS retail_price_current (set_num TEXT NOT NULL, market TEXT NOT NULL, currency TEXT NOT NULL, item_price REAL, delivered_price REAL, merchant TEXT, stock TEXT, offer_count INTEGER, msrp REAL, lowest_90d REAL, all_time_low REAL, checked_at TEXT NOT NULL, source TEXT, PRIMARY KEY (set_num, market));
CREATE INDEX IF NOT EXISTS idx_retail_current_refresh ON retail_price_current(market, checked_at);
CREATE TABLE IF NOT EXISTS retail_price_history (set_num TEXT NOT NULL, market TEXT NOT NULL, observed_at TEXT NOT NULL, delivered_price REAL, merchant TEXT, stock TEXT, source TEXT, PRIMARY KEY (set_num, market, observed_at));
CREATE INDEX IF NOT EXISTS idx_retail_history_lookup ON retail_price_history(set_num, market, observed_at);
CREATE TABLE IF NOT EXISTS pricing_anomalies (anomaly_key TEXT PRIMARY KEY, set_num TEXT, condition TEXT, source TEXT, anomaly_type TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'warning', detail_json TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','ignored')), first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP, last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT);
CREATE INDEX IF NOT EXISTS idx_pricing_anomalies_open ON pricing_anomalies(status, severity, last_seen_at);
CREATE TABLE IF NOT EXISTS amazon_product_map (set_num TEXT NOT NULL, market TEXT NOT NULL, asin TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'quarantined', match_method TEXT, match_confidence REAL NOT NULL DEFAULT 0, checked_at TEXT, PRIMARY KEY (set_num, market), UNIQUE (market, asin));
CREATE TABLE IF NOT EXISTS pricing_write_ledger (day TEXT NOT NULL, job TEXT NOT NULL, rows_written INTEGER NOT NULL DEFAULT 0, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (day, job));
ALTER TABLE user_prefs ADD COLUMN retail_market TEXT DEFAULT 'FR';
ALTER TABLE user_collection ADD COLUMN sold_price REAL;
ALTER TABLE user_collection ADD COLUMN sold_at DATE;
ALTER TABLE user_prefs ADD COLUMN notify_weekly_digest INTEGER DEFAULT 0;
ALTER TABLE set_market_ext ADD COLUMN stockx_ask REAL;
ALTER TABLE set_market_ext ADD COLUMN stockx_cached_at TEXT;
ALTER TABLE set_market_ext ADD COLUMN ebay_sold_attempted_at TEXT;
ALTER TABLE set_market_ext ADD COLUMN ebay_used_attempted_at TEXT;
ALTER TABLE set_market_ext ADD COLUMN pc_attempted_at TEXT;

-- Bright Data Web Unlocker monthly request-safety ledger (SHA-256 hashes only).
CREATE TABLE IF NOT EXISTS brightdata_keys (
  key_hash TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0,
  cap INTEGER NOT NULL DEFAULT 4900,
  period_month TEXT,
  exhausted_at TEXT,
  last_used_at TEXT,
  updated_at TEXT
);

-- ScrapingAnt monthly credit-safety ledger (SHA-256 hashes only).
CREATE TABLE IF NOT EXISTS scrapingant_keys (
  key_hash TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0,
  cap INTEGER NOT NULL DEFAULT 9800,
  period_month TEXT,
  exhausted_at TEXT,
  last_used_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS set_description_i18n (set_num TEXT NOT NULL, lang TEXT NOT NULL, description TEXT NOT NULL, source_hash TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (set_num, lang));
