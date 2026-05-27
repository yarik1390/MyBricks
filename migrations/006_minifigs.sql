ALTER TABLE minifigs
  ADD COLUMN IF NOT EXISTS added_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS source   TEXT;

ALTER TABLE user_collection
  ADD COLUMN IF NOT EXISTS condition TEXT DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS notes     TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='user_collection' AND column_name='condition'
  ) THEN
    ALTER TABLE user_collection ADD COLUMN condition TEXT DEFAULT 'new';
  END IF;
END $$;