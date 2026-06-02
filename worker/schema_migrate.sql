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

