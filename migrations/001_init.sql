-- Core tables for MyBricks

CREATE TABLE IF NOT EXISTS lego_sets (
  set_num       TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  year          INT,
  theme         TEXT,
  pieces        INT,
  minifigs      INT DEFAULT 0,
  image_url     TEXT,
  retail_price  NUMERIC(10,2),
  current_value NUMERIC(10,2),
  forecast_2y   NUMERIC(10,2),
  forecast_5y   NUMERIC(10,2),
  retired       BOOLEAN DEFAULT false,
  valuation_method TEXT DEFAULT 'formula_bulk',
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_collection (
  id            SERIAL PRIMARY KEY,
  user_id       TEXT NOT NULL,
  set_num       TEXT NOT NULL REFERENCES lego_sets(set_num),
  quantity      INT DEFAULT 1,
  condition     TEXT DEFAULT 'new' CHECK (condition IN ('new','used_good','used_acceptable','sealed')),
  purchase_price NUMERIC(10,2),
  notes         TEXT,
  added_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, set_num)
);

CREATE TABLE IF NOT EXISTS minifigs (
  fig_num       TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  series        TEXT,
  rarity        TEXT DEFAULT 'common' CHECK (rarity IN ('common','uncommon','rare','legendary')),
  current_value NUMERIC(10,2),
  image_url     TEXT
);

CREATE TABLE IF NOT EXISTS user_minifigs (
  id       SERIAL PRIMARY KEY,
  user_id  TEXT NOT NULL,
  fig_num  TEXT NOT NULL REFERENCES minifigs(fig_num),
  quantity INT DEFAULT 1,
  added_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, fig_num)
);