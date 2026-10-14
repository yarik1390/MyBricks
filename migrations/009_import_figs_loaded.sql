-- SQLite/D1 has no ADD COLUMN IF NOT EXISTS; worker/schema_migrate.sql is the live path.
ALTER TABLE import_runs ADD COLUMN figs_loaded INTEGER;
