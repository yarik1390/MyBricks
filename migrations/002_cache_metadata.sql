ALTER TABLE lego_sets
  ADD COLUMN IF NOT EXISTS upc            TEXT,
  ADD COLUMN IF NOT EXISTS cached_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source         TEXT,
  ADD COLUMN IF NOT EXISTS valuation_method TEXT DEFAULT 'formula_bulk';