-- Rebuild the derived FTS5 catalog search index.
-- Safe to run repeatedly: it does not delete rows from lego_sets.
DROP TRIGGER IF EXISTS lego_sets_ai;
DROP TRIGGER IF EXISTS lego_sets_ad;
DROP TRIGGER IF EXISTS lego_sets_au;
DROP TABLE IF EXISTS lego_sets_fts;

CREATE VIRTUAL TABLE lego_sets_fts USING fts5(
  set_num,
  name,
  theme,
  subtheme,
  theme_group,
  brickset_tags,
  content='lego_sets',
  content_rowid='rowid'
);

CREATE TRIGGER lego_sets_ai AFTER INSERT ON lego_sets BEGIN
  INSERT INTO lego_sets_fts(rowid, set_num, name, theme, subtheme, theme_group, brickset_tags)
  VALUES (new.rowid, new.set_num, new.name, new.theme, new.subtheme, new.theme_group, new.brickset_tags);
END;

CREATE TRIGGER lego_sets_ad AFTER DELETE ON lego_sets BEGIN
  INSERT INTO lego_sets_fts(lego_sets_fts, rowid, set_num, name, theme, subtheme, theme_group, brickset_tags)
  VALUES('delete', old.rowid, old.set_num, old.name, old.theme, old.subtheme, old.theme_group, old.brickset_tags);
END;

CREATE TRIGGER lego_sets_au AFTER UPDATE OF set_num, name, theme, subtheme, theme_group, brickset_tags ON lego_sets BEGIN
  INSERT INTO lego_sets_fts(lego_sets_fts, rowid, set_num, name, theme, subtheme, theme_group, brickset_tags)
  VALUES('delete', old.rowid, old.set_num, old.name, old.theme, old.subtheme, old.theme_group, old.brickset_tags);
  INSERT INTO lego_sets_fts(rowid, set_num, name, theme, subtheme, theme_group, brickset_tags)
  VALUES(new.rowid, new.set_num, new.name, new.theme, new.subtheme, new.theme_group, new.brickset_tags);
END;

INSERT INTO lego_sets_fts(rowid, set_num, name, theme, subtheme, theme_group, brickset_tags)
SELECT rowid, set_num, name, theme, subtheme, theme_group, brickset_tags FROM lego_sets;
