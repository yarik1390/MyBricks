-- Additive migrations for databases created before v2.
-- Run with error suppression (|| true) — duplicate column errors are expected on re-deploys.
ALTER TABLE lego_sets ADD COLUMN ebay_value REAL;
ALTER TABLE lego_sets ADD COLUMN ebay_cached_at TEXT;
ALTER TABLE lego_sets ADD COLUMN used_value REAL;
ALTER TABLE lego_sets ADD COLUMN retirement_risk_score INTEGER;
ALTER TABLE lego_sets ADD COLUMN retirement_risk_updated_at TEXT;
ALTER TABLE wishlist_alerts ADD COLUMN alert_type TEXT NOT NULL DEFAULT 'drop';
ALTER TABLE user_collection ADD COLUMN spike_alerted_at TEXT;
ALTER TABLE user_prefs ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;
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



