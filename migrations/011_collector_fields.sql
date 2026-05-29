ALTER TABLE user_collection
  ADD COLUMN IF NOT EXISTS storage_location   TEXT,
  ADD COLUMN IF NOT EXISTS acquisition_source TEXT,
  ADD COLUMN IF NOT EXISTS is_complete        BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS missing_pieces     INT     DEFAULT 0;
