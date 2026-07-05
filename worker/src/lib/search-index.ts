export function isSearchIndexCorruption(error: unknown): boolean {
  const message = ((error as Error)?.message || String(error)).toLowerCase();
  return (
    message.includes('sqlite_corrupt_vtab') ||
    message.includes('database disk image is malformed')
  );
}

// Enrichment columns indexed for search IN ADDITION to set_num/name/theme when
// they exist on lego_sets (Phase 2: subtheme, theme group, Brickset tags). They
// are detected at runtime rather than hardcoded so this stays in sync with the
// production schema (6 columns — must match worker/schema_search_index.sql and
// worker/schema.sql) without breaking minimal schemas (e.g. unit-test DBs) that
// only have the base columns.
const OPTIONAL_FTS_COLUMNS = ['subtheme', 'theme_group', 'brickset_tags'];

export async function rebuildSearchIndex(db: D1Database) {
  let present: string[] = [];
  try {
    const { results } = await db.prepare("SELECT name FROM pragma_table_info('lego_sets')").all<{ name: string }>();
    const have = new Set((results || []).map((r) => r.name));
    present = OPTIONAL_FTS_COLUMNS.filter((c) => have.has(c));
  } catch {
    present = [];
  }

  const cols = ['set_num', 'name', 'theme', ...present];
  const colList = cols.join(', ');
  const ftsCols = cols.join(',\n      ');
  const newVals = cols.map((c) => `new.${c}`).join(', ');

  // STANDALONE FTS5 (not external-content). It stores its own copy of the text,
  // so it never reads lego_sets at query time and cannot raise SQLITE_CORRUPT_VTAB
  // when the index and the content table diverge. The old external-content form
  // (content='lego_sets') corrupted constantly under our heavy lego_sets write
  // load, and every corrupt search triggered a full ~425k-row rebuild.
  const setup = [
    'DROP TRIGGER IF EXISTS lego_sets_ai',
    'DROP TRIGGER IF EXISTS lego_sets_ad',
    'DROP TRIGGER IF EXISTS lego_sets_au',
    'DROP TABLE IF EXISTS lego_sets_fts',
    `CREATE VIRTUAL TABLE lego_sets_fts USING fts5(
      ${ftsCols}
    )`,
  ];
  for (const sql of setup) {
    await db.prepare(sql).run();
  }

  // Backfill BEFORE creating the triggers so a concurrent lego_sets write can't
  // collide with the bulk insert on a duplicate rowid; triggers then keep it live.
  await db.prepare(`
    INSERT INTO lego_sets_fts(rowid, ${colList})
    SELECT rowid, ${colList} FROM lego_sets
  `).run();

  const triggers = [
    `CREATE TRIGGER lego_sets_ai AFTER INSERT ON lego_sets BEGIN
      INSERT INTO lego_sets_fts(rowid, ${colList})
      VALUES (new.rowid, ${newVals});
    END`,
    `CREATE TRIGGER lego_sets_ad AFTER DELETE ON lego_sets BEGIN
      DELETE FROM lego_sets_fts WHERE rowid = old.rowid;
    END`,
    `CREATE TRIGGER lego_sets_au AFTER UPDATE OF ${colList} ON lego_sets BEGIN
      DELETE FROM lego_sets_fts WHERE rowid = old.rowid;
      INSERT INTO lego_sets_fts(rowid, ${colList})
      VALUES(new.rowid, ${newVals});
    END`,
  ];
  for (const sql of triggers) {
    await db.prepare(sql).run();
  }

  const row = await db.prepare(
    'SELECT CAST(COUNT(*) AS INTEGER) AS indexed_sets FROM lego_sets_fts'
  ).first<{ indexed_sets: number }>();
  return { indexed_sets: Number(row?.indexed_sets || 0) };
}
