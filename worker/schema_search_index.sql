-- FORCE-rebuild the derived FTS5 catalog search index (standalone form).
-- This DROPs and rebuilds, so it is NOT run on every deploy — schema.sql now
-- bootstraps the index idempotently. Use this only to force a clean rebuild.
-- Standalone (no content='lego_sets') so the index stores its own text and can't
-- raise SQLITE_CORRUPT_VTAB when it diverges from lego_sets under heavy writes —
-- the cause of the runaway rebuild loop that dominated D1 rows-written.
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
  brickset_tags
);

-- Backfill before creating the triggers so a concurrent lego_sets write can't
-- collide with the bulk insert on a duplicate rowid.
INSERT INTO lego_sets_fts(rowid, set_num, name, theme, subtheme, theme_group, brickset_tags)
SELECT rowid, set_num, name, theme, subtheme, theme_group, brickset_tags FROM lego_sets;

CREATE TRIGGER lego_sets_ai AFTER INSERT ON lego_sets BEGIN
  INSERT INTO lego_sets_fts(rowid, set_num, name, theme, subtheme, theme_group, brickset_tags)
  VALUES (new.rowid, new.set_num, new.name, new.theme, new.subtheme, new.theme_group, new.brickset_tags);
END;

CREATE TRIGGER lego_sets_ad AFTER DELETE ON lego_sets BEGIN
  DELETE FROM lego_sets_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER lego_sets_au AFTER UPDATE OF set_num, name, theme, subtheme, theme_group, brickset_tags ON lego_sets BEGIN
  DELETE FROM lego_sets_fts WHERE rowid = old.rowid;
  INSERT INTO lego_sets_fts(rowid, set_num, name, theme, subtheme, theme_group, brickset_tags)
  VALUES(new.rowid, new.set_num, new.name, new.theme, new.subtheme, new.theme_group, new.brickset_tags);
END;
