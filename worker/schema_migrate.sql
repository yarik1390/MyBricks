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

-- Seed realistic minifigure rarities
UPDATE minifigs
SET rarity = CASE substr(fig_num, -1)
  WHEN '7' THEN 'legendary'
  WHEN '3' THEN 'rare'
  WHEN '8' THEN 'rare'
  WHEN '1' THEN 'uncommon'
  WHEN '4' THEN 'uncommon'
  WHEN '9' THEN 'uncommon'
  ELSE 'common'
END;

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



