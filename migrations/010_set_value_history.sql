-- Per-set price history. Populated daily for sets that any user owns or
-- wishlists (see api/jobs/snapshot-set-values.js) so the set-detail chart can
-- show real trends instead of synthetic data. Volume stays small because we
-- only track sets that matter to a user.
CREATE TABLE IF NOT EXISTS set_value_history (
  set_num       TEXT NOT NULL REFERENCES lego_sets(set_num),
  snapshot_date DATE NOT NULL,
  current_value NUMERIC(12,2),
  PRIMARY KEY (set_num, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_svh_set ON set_value_history (set_num, snapshot_date);
