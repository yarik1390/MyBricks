export function isSearchIndexCorruption(error: unknown): boolean {
  const message = ((error as Error)?.message || String(error)).toLowerCase();
  return (
    message.includes('sqlite_corrupt_vtab') ||
    message.includes('database disk image is malformed')
  );
}

export async function rebuildSearchIndex(db: D1Database) {
  const statements = [
    'DROP TRIGGER IF EXISTS lego_sets_ai',
    'DROP TRIGGER IF EXISTS lego_sets_ad',
    'DROP TRIGGER IF EXISTS lego_sets_au',
    'DROP TABLE IF EXISTS lego_sets_fts',
    // NOTE: keep these columns in sync with worker/schema_search_index.sql
    // and worker/schema.sql — all three rebuild the same FTS index.
    `CREATE VIRTUAL TABLE lego_sets_fts USING fts5(
      set_num,
      name,
      theme,
      subtheme,
      theme_group,
      brickset_tags,
      content='lego_sets',
      content_rowid='rowid'
    )`,
    `CREATE TRIGGER lego_sets_ai AFTER INSERT ON lego_sets BEGIN
      INSERT INTO lego_sets_fts(rowid, set_num, name, theme, subtheme, theme_group, brickset_tags)
      VALUES (new.rowid, new.set_num, new.name, new.theme, new.subtheme, new.theme_group, new.brickset_tags);
    END`,
    `CREATE TRIGGER lego_sets_ad AFTER DELETE ON lego_sets BEGIN
      INSERT INTO lego_sets_fts(lego_sets_fts, rowid, set_num, name, theme, subtheme, theme_group, brickset_tags)
      VALUES('delete', old.rowid, old.set_num, old.name, old.theme, old.subtheme, old.theme_group, old.brickset_tags);
    END`,
    `CREATE TRIGGER lego_sets_au AFTER UPDATE OF set_num, name, theme, subtheme, theme_group, brickset_tags ON lego_sets BEGIN
      INSERT INTO lego_sets_fts(lego_sets_fts, rowid, set_num, name, theme, subtheme, theme_group, brickset_tags)
      VALUES('delete', old.rowid, old.set_num, old.name, old.theme, old.subtheme, old.theme_group, old.brickset_tags);
      INSERT INTO lego_sets_fts(rowid, set_num, name, theme, subtheme, theme_group, brickset_tags)
      VALUES(new.rowid, new.set_num, new.name, new.theme, new.subtheme, new.theme_group, new.brickset_tags);
    END`,
  ];

  for (const sql of statements) {
    await db.prepare(sql).run();
  }

  await db.prepare(`
    INSERT INTO lego_sets_fts(rowid, set_num, name, theme, subtheme, theme_group, brickset_tags)
    SELECT rowid, set_num, name, theme, subtheme, theme_group, brickset_tags FROM lego_sets
  `).run();

  const row = await db.prepare(
    'SELECT CAST(COUNT(*) AS INTEGER) AS indexed_sets FROM lego_sets_fts'
  ).first<{ indexed_sets: number }>();
  return { indexed_sets: Number(row?.indexed_sets || 0) };
}
