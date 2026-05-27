CREATE TABLE IF NOT EXISTS rate_limits (
  user_id      TEXT NOT NULL,
  endpoint     TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  hit_count    INT DEFAULT 0,
  PRIMARY KEY (user_id, endpoint, window_start)
);

ALTER TABLE user_collection
  ADD COLUMN IF NOT EXISTS purchased_at   DATE,
  ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_modified  TIMESTAMPTZ DEFAULT now();

ALTER TABLE lego_sets
  ADD COLUMN IF NOT EXISTS valuation_expires_at TIMESTAMPTZ;