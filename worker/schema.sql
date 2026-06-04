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
  used_value REAL,
  retirement_risk_score INTEGER,
  retirement_risk_updated_at TEXT
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
  source TEXT
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
  status TEXT DEFAULT 'running',
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
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
  google_refresh_token TEXT,
  google_spreadsheet_id TEXT,
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
  PRIMARY KEY (set_num, snapshot_date)
);

CREATE TABLE IF NOT EXISTS user_showcase (
  user_id TEXT NOT NULL,
  set_num TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, set_num),
  FOREIGN KEY (set_num) REFERENCES lego_sets(set_num)
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

-- FTS5 search
CREATE VIRTUAL TABLE IF NOT EXISTS lego_sets_fts USING fts5(
  set_num,
  name,
  theme,
  content='lego_sets',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS lego_sets_ai AFTER INSERT ON lego_sets BEGIN
  INSERT INTO lego_sets_fts(rowid, set_num, name, theme)
  VALUES (new.rowid, new.set_num, new.name, new.theme);
END;

CREATE TRIGGER IF NOT EXISTS lego_sets_ad AFTER DELETE ON lego_sets BEGIN
  INSERT INTO lego_sets_fts(lego_sets_fts, rowid, set_num, name, theme)
  VALUES('delete', old.rowid, old.set_num, old.name, old.theme);
END;

CREATE TRIGGER IF NOT EXISTS lego_sets_au AFTER UPDATE ON lego_sets BEGIN
  INSERT INTO lego_sets_fts(lego_sets_fts, rowid, set_num, name, theme)
  VALUES('delete', old.rowid, old.set_num, old.name, old.theme);
  INSERT INTO lego_sets_fts(rowid, set_num, name, theme)
  VALUES(new.rowid, new.set_num, new.name, new.theme);
END;

