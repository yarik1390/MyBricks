/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { expandSetNumKeys, extractBoxFrontNumbers, parseOcrSetNumbers, resolveOcrSetNum } from './lib/scan-ocr';

const db = (env as any).DB as D1Database;

async function freshSchema() {
  await db.prepare('DROP TABLE IF EXISTS lego_sets').run();
  await db.prepare(`CREATE TABLE lego_sets (
    set_num TEXT PRIMARY KEY,
    name TEXT NOT NULL
  )`).run();
  await db.prepare(`INSERT INTO lego_sets (set_num, name) VALUES
    ('75192', 'Millennium Falcon'),
    ('75313-1', 'AT-AT'),
    ('375-1', 'Yellow Castle')`).run();
}

describe('OCR set-number parsing', () => {
  it('accepts only explicit set-number labels', () => {
    expect(parseOcrSetNumbers('LEGO SET 75313-1 Star Wars')).toEqual(['75313-1']);
    expect(parseOcrSetNumbers('Set number: 75313')).toEqual(['75313']);
    expect(parseOcrSetNumbers('SET NO. 375 - 1')).toEqual(['375-1']);
  });

  it('rejects unlabeled years, piece counts, prices, and barcodes', () => {
    expect(parseOcrSetNumbers('Released in 2017')).toEqual([]);
    expect(parseOcrSetNumbers('2,316 pieces')).toEqual([]);
    expect(parseOcrSetNumbers('LEGO 75313 Star Wars')).toEqual([]);
    expect(parseOcrSetNumbers('UPC 673419376785')).toEqual([]);
    expect(parseOcrSetNumbers('$49.99')).toEqual([]);
  });

  it('deduplicates normalized candidates', () => {
    expect(parseOcrSetNumbers(['Set 75313 – 1', 'Set number 75313-1', 'Set 375-1'])).toEqual([
      '75313-1',
      '375-1',
    ]);
  });

  it('passes through bare tokens the client already extracted', () => {
    // The client sends label-stripped OCR tokens; the worker must not re-run
    // the label gate on them or the accept path can never fire.
    expect(parseOcrSetNumbers(['75192'])).toEqual(['75192']);
    expect(parseOcrSetNumbers(['75313-1', '375'])).toEqual(['75313-1', '375']);
  });

  it('expands canonical catalog keys', () => {
    expect(expandSetNumKeys('75313')).toEqual({
      raw: '75313', canonical: '75313-1', bare: '75313', keys: ['75313', '75313-1'],
    });
    expect(expandSetNumKeys('75313-1')).toEqual({
      raw: '75313-1', canonical: '75313-1', bare: '75313', keys: ['75313-1', '75313'],
    });
  });
});

describe('OCR catalog lookup', () => {
  beforeEach(freshSchema);

  it('accepts one exact catalog hit', async () => {
    await expect(resolveOcrSetNum(db, ['75313-1'])).resolves.toMatchObject({
      kind: 'accepted', setNum: '75313-1', token: '75313-1',
    });
    await expect(resolveOcrSetNum(db, ['75192-1'])).resolves.toMatchObject({
      kind: 'accepted', setNum: '75192', token: '75192-1',
    });
  });

  it('falls through on empty, unmapped, or ambiguous candidates', async () => {
    await expect(resolveOcrSetNum(db, [])).resolves.toEqual({ kind: 'empty' });
    await expect(resolveOcrSetNum(db, ['99999'])).resolves.toEqual({ kind: 'unmapped' });
    await expect(resolveOcrSetNum(db, ['75192', '75313-1'])).resolves.toEqual({
      kind: 'ambiguous', setNums: ['75192', '75313-1'],
    });
  });

  it('rejects a bare number when multiple variants exist', async () => {
    await db.prepare("INSERT INTO lego_sets (set_num, name) VALUES ('375-2', 'Yellow Castle Variant')").run();
    await expect(resolveOcrSetNum(db, ['375'])).resolves.toEqual({
      kind: 'ambiguous', setNums: ['375-1', '375-2'],
    });
  });
});

describe('OCR box-front numbers', () => {
  beforeEach(async () => {
    await db.prepare('DROP TABLE IF EXISTS lego_sets').run();
    await db.prepare(`CREATE TABLE lego_sets (
      set_num TEXT PRIMARY KEY, name TEXT NOT NULL, theme TEXT, pieces INTEGER
    )`).run();
    await db.prepare(`INSERT INTO lego_sets (set_num, name, theme, pieces) VALUES
      ('75313-1', 'AT-AT', 'Star Wars', 6785),
      ('42156-1', 'PEUGEOT 9X8 24H Le Mans Hybrid Hypercar', 'Technic', 1775),
      ('2017-1', 'Choo Choo Train', 'Duplo', 14),
      ('6785-1', 'Tow Truck', 'Town', 30),
      ('10316-1', 'Rivendell', 'Icons', 6167)`).run();
  });

  it('extracts bare numbers but skips piece counts, ages, years, prices and barcodes', () => {
    expect(extractBoxFrontNumbers([
      '75313', '6785 pcs', '6,785 pieces', 'Ages 18+', '18+', '8-14', '© 2024 LEGO Group',
      '$849.99', '€ 1999', '5702017153209', '42156 Peugeot',
    ])).toEqual(['75313', '42156']);
  });

  it('accepts a bare box number backed by the piece count', async () => {
    await expect(resolveOcrSetNum(db, [], ['LEGO STAR WARS', '75313', '6785 pcs', '18+']))
      .resolves.toMatchObject({ kind: 'accepted', setNum: '75313-1', method: 'box-front' });
  });

  it('accepts a bare box number backed by words from the name', async () => {
    await expect(resolveOcrSetNum(db, [], ['LEGO Technic 42156', 'PEUGEOT 9X8']))
      .resolves.toMatchObject({ kind: 'accepted', setNum: '42156-1', method: 'box-front' });
    await expect(resolveOcrSetNum(db, [], ['THE LORD OF THE RINGS', '10316', 'RIVENDELL']))
      .resolves.toMatchObject({ kind: 'accepted', setNum: '10316-1' });
  });

  it('does not accept a bare number with nothing backing it up', async () => {
    // 2017 and 6785 are real (old) set numbers; neither the theme alone nor a
    // year or piece count is enough.
    await expect(resolveOcrSetNum(db, [], ['© 2017 LEGO Group', '2017 pcs'])).resolves.toMatchObject({ kind: 'empty' });
    await expect(resolveOcrSetNum(db, [], ['LEGO STAR WARS 75313'])).resolves.toEqual({ kind: 'unmapped' });
    await expect(resolveOcrSetNum(db, [], ['Duplo 2017'])).resolves.toEqual({ kind: 'unmapped' });
  });

  it('keeps an explicit label ahead of box text', async () => {
    await expect(resolveOcrSetNum(db, ['42156'], ['75313', '6785 pcs']))
      .resolves.toMatchObject({ kind: 'accepted', setNum: '42156-1', method: 'label' });
  });

  it('works on a catalog without piece or theme columns', async () => {
    await freshSchema();
    await expect(resolveOcrSetNum(db, [], ['75313', 'AT-AT'])).resolves.toMatchObject({ kind: 'accepted', setNum: '75313-1' });
    await expect(resolveOcrSetNum(db, [], ['75313', 'Star Wars'])).resolves.toEqual({ kind: 'unmapped' });
  });
});
