ALTER TABLE import_runs
  ADD COLUMN IF NOT EXISTS figs_loaded INT;
