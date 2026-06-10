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
  bl_new_min REAL,
  bl_new_max REAL,
  bl_used_min REAL,
  bl_used_max REAL,
  lego_in_stock INTEGER,
  lego_retiring_soon INTEGER DEFAULT 0,
  lego_checked_at TEXT,
  bo_new_value REAL,
  bo_used_value REAL,
  bo_cached_at TEXT
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
  UNIQUE(user_id, set_num)
);

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
  appears_in_sets INTEGER
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
  notify_price_drops INTEGER DEFAULT 1,
  is_public INTEGER NOT NULL DEFAULT 0,
  expose_public_value INTEGER DEFAULT 1,
  google_refresh_token TEXT,
  google_spreadsheet_id TEXT,
  email TEXT,
  discord_webhook_url TEXT,
  brickset_user_hash TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

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

-- FTS5 search. This index is derived from lego_sets and can be rebuilt safely.
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
SELECT rowid, set_num, name, theme FROM lego_sets;
