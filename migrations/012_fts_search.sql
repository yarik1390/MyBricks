CREATE VIRTUAL TABLE IF NOT EXISTS lego_sets_fts USING fts5(
  set_num,
  name,
  theme,
  content='lego_sets',
  content_rowid='rowid'
);

-- Trigger to keep FTS table in sync on INSERT
CREATE TRIGGER IF NOT EXISTS lego_sets_ai AFTER INSERT ON lego_sets BEGIN
  INSERT INTO lego_sets_fts(rowid, set_num, name, theme)
  VALUES (new.rowid, new.set_num, new.name, new.theme);
END;

-- Trigger to keep FTS table in sync on DELETE
CREATE TRIGGER IF NOT EXISTS lego_sets_ad AFTER DELETE ON lego_sets BEGIN
  INSERT INTO lego_sets_fts(lego_sets_fts, rowid, set_num, name, theme)
  VALUES('delete', old.rowid, old.set_num, old.name, old.theme);
END;

-- Trigger to keep FTS table in sync on UPDATE
CREATE TRIGGER IF NOT EXISTS lego_sets_au AFTER UPDATE ON lego_sets BEGIN
  INSERT INTO lego_sets_fts(lego_sets_fts, rowid, set_num, name, theme)
  VALUES('delete', old.rowid, old.set_num, old.name, old.theme);
  INSERT INTO lego_sets_fts(rowid, set_num, name, theme)
  VALUES(new.rowid, new.set_num, new.name, new.theme);
END;

-- Populate the FTS table with existing sets
INSERT INTO lego_sets_fts(rowid, set_num, name, theme)
SELECT rowid, set_num, name, theme FROM lego_sets
WHERE NOT EXISTS (SELECT 1 FROM lego_sets_fts LIMIT 1);
