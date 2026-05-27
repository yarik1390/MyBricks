CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id            SERIAL PRIMARY KEY,
  user_id       TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  snapshot_at   TIMESTAMPTZ DEFAULT now(),
  total_value   NUMERIC(12,2) DEFAULT 0,
  total_paid    NUMERIC(12,2) DEFAULT 0,
  set_count     INT DEFAULT 0,
  UNIQUE (user_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS user_wishlist (
  id           SERIAL PRIMARY KEY,
  user_id      TEXT NOT NULL,
  set_num      TEXT NOT NULL REFERENCES lego_sets(set_num),
  target_price NUMERIC(10,2),
  notes        TEXT,
  added_at     TIMESTAMPTZ DEFAULT now(),
  alerted_at   TIMESTAMPTZ,
  UNIQUE (user_id, set_num)
);

CREATE TABLE IF NOT EXISTS wishlist_alerts (
  id            SERIAL PRIMARY KEY,
  user_id       TEXT NOT NULL,
  set_num       TEXT NOT NULL,
  set_name      TEXT,
  target_price  NUMERIC(10,2),
  current_value NUMERIC(10,2),
  triggered_at  TIMESTAMPTZ DEFAULT now(),
  read_at       TIMESTAMPTZ
);