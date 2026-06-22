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
