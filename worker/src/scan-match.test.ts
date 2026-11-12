/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { isNameCompatible, matchSetsToCatalog, scanBox } from './lib/scan-match';
import { applyTestTables } from './test-schema';

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

  it('extracts an explicit set number from model reasoning before fuzzy name matching', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, theme) VALUES
      ('4488-1', 'Millennium Falcon', 2003, 'Star Wars')`).run();
    await db.prepare(`INSERT INTO lego_sets_fts(rowid, set_num, name, theme)
      SELECT rowid, set_num, name, theme FROM lego_sets WHERE set_num = '4488-1'`).run();

    const result = await matchSetsToCatalog(env as any, [{
      set_num: null,
      name: 'Millennium Falcon',
      theme: 'Star Wars',
      year: null,
      confidence: 'high',
      reasoning: 'This is the Ultimate Collector Series Millennium Falcon set 75192.',
    }]);

    expect(result.sets[0]?.set_num).toBe('75192-1');
  });

  it('does not mistake a release year for an exact set number', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, theme) VALUES
      ('2017-1', 'Choo Choo Train', 1987, 'Duplo')`).run();
    await db.prepare(`INSERT INTO lego_sets_fts(rowid, set_num, name, theme)
      SELECT rowid, set_num, name, theme FROM lego_sets WHERE set_num = '2017-1'`).run();

    const result = await matchSetsToCatalog(env as any, [{
      set_num: null,
      name: 'Millennium Falcon',
      theme: 'Star Wars',
      year: 2017,
      confidence: 'high',
      reasoning: 'Released in 2017, this appears to be the Millennium Falcon.',
    }]);

    expect(result.sets[0]?.set_num).toBe('75192-1');
  });

  it('passes a located shelf box through and drops a malformed one', async () => {
    const result = await matchSetsToCatalog(env as any, [
      { set_num: '75192', name: 'Millennium Falcon', confidence: 'high', reasoning: '', box: [120.4, 50, 610, 480] },
      { set_num: '52236', name: 'Millennium Falcon Bag Tag', confidence: 'high', reasoning: '', box: [500, 10, 400, 90] },
    ]);
    expect(result.sets[0]?.scan_box).toEqual([120, 50, 610, 480]);
    expect(result.sets[1]?.set_num).toBe('52236-1');
    expect(result.sets[1]).not.toHaveProperty('scan_box');
  });

  it('rejects an exact set number when the catalog name contradicts the described name', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, theme) VALUES
      ('21031-1', 'Burj Khalifa', 2016, 'Architecture'),
      ('21000-1', 'Willis Tower', 2011, 'Architecture')`).run();
    await db.prepare(`INSERT INTO lego_sets_fts(rowid, set_num, name, theme)
      SELECT rowid, set_num, name, theme FROM lego_sets WHERE set_num IN ('21031-1', '21000-1')`).run();

    // Model hallucinated 21031 (Burj Khalifa) for a photo it correctly described as Willis Tower.
    const result = await matchSetsToCatalog(env as any, [{
      set_num: '21031',
      name: 'Willis Tower',
      theme: 'Architecture',
      year: 2011,
      confidence: 'high',
      reasoning: 'Black skyscraper model of Willis Tower',
    }]);

    expect(result.sets[0]?.set_num).toBe('21000-1');
    expect(result.sets[0]?.name).toBe('Willis Tower');
  });
});

describe('scan name checks', () => {
  it('rejects names that share only a short or generic word', () => {
    expect(isNameCompatible('Starfarer', 'Star Destroyer')).toBe(false);
    expect(isNameCompatible('Cargo Heli', 'Car Transporter')).toBe(false);
    expect(isNameCompatible('Hogwarts Castle', 'Disney Castle Tower')).toBe(false);
  });

  it('keeps real matches and abbreviations', () => {
    expect(isNameCompatible('Millennium Falcon UCS', 'Millennium Falcon')).toBe(true);
    expect(isNameCompatible("The Mandalorian's Razor Crest", 'Razor Crest')).toBe(true);
    expect(isNameCompatible('Batmobile', 'The Batmobile Tumbler')).toBe(true);
    expect(isNameCompatible('Titanic', 'Titanic Ship')).toBe(true);
    expect(isNameCompatible('Ferrari Daytona SP3', 'Ferrari Daytona')).toBe(true);
  });

  it('demotes a key chain below the boxed set unless the model asked for one', async () => {
    await freshSchema();
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, theme) VALUES
      ('854124-1', 'Hogwarts Castle', 2021, 'Key Chains'),
      ('71043-1', 'Hogwarts Castle', 2018, 'Harry Potter')`).run();
    await db.prepare(`INSERT INTO lego_sets_fts(rowid, set_num, name, theme)
      SELECT rowid, set_num, name, theme FROM lego_sets WHERE set_num IN ('854124-1', '71043-1')`).run();
    const boxed = await matchSetsToCatalog(env as any, [{ name: 'Hogwarts Castle', confidence: 'high' }]);
    expect(boxed.sets[0]?.set_num).toBe('71043-1');
    const keychain = await matchSetsToCatalog(env as any, [{ name: 'Hogwarts Castle Key Chain', theme: 'Key Chains', confidence: 'high' }]);
    expect(keychain.sets[0]?.set_num).toBe('854124-1');
  });
});

describe('scan prices match the set page', () => {
  beforeEach(async () => {
    await db.prepare('DROP TABLE IF EXISTS lego_sets_fts').run();
    await applyTestTables(db, ['lego_sets', 'set_market_ext', 'set_valuation_state']);
    await db.prepare(`CREATE VIRTUAL TABLE lego_sets_fts USING fts5(
      set_num UNINDEXED, name, theme, content='lego_sets', content_rowid='rowid'
    )`).run();
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, theme, pieces, current_value, retail_price)
      VALUES ('75192-1', 'Millennium Falcon', 2017, 'Star Wars', 7541, 100, 849.99)`).run();
    await db.prepare(`INSERT INTO set_valuation_state (set_num, condition, fair_value, low, high, confidence, model_version, as_of)
      VALUES ('75192-1', 'new_sealed', 912, 850, 990, 'high', 'v3', '2026-11-12')`).run();
  });

  it('uses the stored v3 valuation instead of recomputing from the raw row', async () => {
    const result = await matchSetsToCatalog(env as any, [{ set_num: '75192', name: 'Millennium Falcon', confidence: 'medium', reasoning: 'UCS dish' }]);
    const set = result.sets[0] as any;
    expect(set.set_num).toBe('75192-1');
    expect(set.valuation.new.fair_value).toBe(912);
    expect(set.match_confidence).toBe('medium');
    expect(set.reasoning).toBe('UCS dish');
    expect(Object.keys(set).some((k) => k.startsWith('v3_') || k.startsWith('__valuation'))).toBe(false);
  });
});

describe('scanBox', () => {
  it('accepts only four in-range coordinates with positive size', () => {
    expect(scanBox([0, 0, 1000, 1000])).toEqual([0, 0, 1000, 1000]);
    expect(scanBox(['10', '20', '30', '40'])).toEqual([10, 20, 30, 40]);
    expect(scanBox(null)).toBeNull();
    expect(scanBox([1, 2, 3])).toBeNull();
    expect(scanBox([0, 0, 1001, 10])).toBeNull();
    expect(scanBox([-1, 0, 10, 10])).toBeNull();
    expect(scanBox([10, 10, 10, 20])).toBeNull();
    expect(scanBox([0, 'x', 10, 10])).toBeNull();
  });
});
