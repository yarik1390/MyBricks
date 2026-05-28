CREATE TABLE IF NOT EXISTS lego_themes (
  id        INT PRIMARY KEY,
  name      TEXT NOT NULL,
  parent_id INT
);

CREATE TABLE IF NOT EXISTS import_runs (
  id           SERIAL PRIMARY KEY,
  status       TEXT NOT NULL DEFAULT 'running',
  started_at   TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  themes_loaded INT,
  sets_loaded   INT,
  sets_skipped  INT,
  figs_loaded   INT,
  error        TEXT
);
