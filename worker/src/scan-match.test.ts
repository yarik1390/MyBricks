/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { matchSetsToCatalog } from './lib/scan-match';

const db = (env as any).DB as D1Database;

async function freshSchema() {
  await db.prepare('DROP TABLE IF EXISTS lego_sets_fts').run();
  await db.prepare('DROP TABLE IF EXISTS lego_sets').run();
  await db.prepare(`CREATE TABLE lego_sets (
    set_num TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    year INTEGER,
    theme TEXT
  )`).run();
  await db.prepare(`CREATE VIRTUAL TABLE lego_sets_fts USING fts5(
    set_num UNINDEXED, name, theme, content='lego_sets', content_rowid='rowid'
  )`).run();
  await db.prepare(`INSERT INTO lego_sets (set_num, name, year, theme) VALUES
    ('75192-1', 'Millennium Falcon', 2017, 'Star Wars'),
    ('52236-1', 'Millennium Falcon Bag Tag', 2026, 'Gear')`).run();
  await db.prepare(`INSERT INTO lego_sets_fts(rowid, set_num, name, theme)
    SELECT rowid, set_num, name, theme FROM lego_sets`).run();
}

describe('scan catalog matching', () => {
  beforeEach(freshSchema);

  it('prefers the core LEGO set over an accessory that merely extends its name', async () => {
    const result = await matchSetsToCatalog(env as any, [{
      set_num: null,
      name: 'Millennium Falcon',
      theme: 'Star Wars',
      year: 2017,
      confidence: 'high',
      reasoning: 'Large Star Wars spacecraft',
    }]);

    expect(result.sets[0]?.set_num).toBe('75192-1');
  });
});
