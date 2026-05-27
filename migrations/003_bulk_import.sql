CREATE TABLE IF NOT EXISTS import_runs (
  id            SERIAL PRIMARY KEY,
  started_at    TIMESTAMPTZ DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  status        TEXT DEFAULT 'running',
  themes_loaded INT DEFAULT 0,
  sets_loaded   INT DEFAULT 0,
  sets_skipped  INT DEFAULT 0,
  error         TEXT
);

CREATE TABLE IF NOT EXISTS lego_themes (
  id        INT PRIMARY KEY,
  name      TEXT NOT NULL,
  parent_id INT
);