CREATE TABLE IF NOT EXISTS user_prefs (
  user_id           TEXT PRIMARY KEY,
  handle            TEXT,
  display_name      TEXT,
  currency          TEXT DEFAULT 'USD',
  notify_price_drops BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);