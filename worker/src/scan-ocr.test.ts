/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { expandSetNumKeys, parseOcrSetNumbers, resolveOcrSetNum } from './lib/scan-ocr';

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
  it('reads a printed set number with and without a variant suffix', () => {
    expect(parseOcrSetNumbers('75313-1')).toEqual(['75313-1']);
    expect(parseOcrSetNumbers('Set 75313 Star Wars')).toEqual(['75313']);
    expect(parseOcrSetNumbers('75313 - 1')).toEqual(['75313-1']);
    expect(parseOcrSetNumbers('75313–1')).toEqual(['75313-1']);
  });

  it('skips years, piece counts, ages and prices', () => {
    expect(parseOcrSetNumbers('Released in 2017')).toEqual([]);
    expect(parseOcrSetNumbers('2,316 pieces / Set 75313')).toEqual(['75313']);
    expect(parseOcrSetNumbers('2316 pcs')).toEqual([]);
    expect(parseOcrSetNumbers('Ages 9+  75313-1')).toEqual(['75313-1']);
    expect(parseOcrSetNumbers('$49.99')).toEqual([]);
  });

  it('keeps classic 3-digit numbers and numeric JSON values', () => {
    expect(parseOcrSetNumbers('375-1')).toEqual(['375-1']);
    expect(parseOcrSetNumbers(75313)).toEqual(['75313']);
    expect(parseOcrSetNumbers(['ITEM 75313', '8+', '2316 pcs'])).toEqual(['75313']);
  });

  it('dedupes and never invents tokens from prose', () => {
    expect(parseOcrSetNumbers('75313-1 / 75313')).toEqual(['75313-1', '75313']);
    expect(parseOcrSetNumbers('hello box art')).toEqual([]);
    expect(parseOcrSetNumbers(null)).toEqual([]);
  });

  it('expands Brickognize-style catalog keys', () => {
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

  it('accepts a unique catalog hit from a suffixed or bare number', async () => {
    await expect(resolveOcrSetNum(db, ['75313-1'])).resolves.toMatchObject({
      kind: 'accepted', setNum: '75313-1', token: '75313-1',
    });
    await expect(resolveOcrSetNum(db, ['75192-1'])).resolves.toMatchObject({
      kind: 'accepted', setNum: '75192', token: '75192-1',
    });
    await expect(resolveOcrSetNum(db, ['375'])).resolves.toMatchObject({
      kind: 'accepted', setNum: '375-1', token: '375',
    });
  });

  it('ignores unmapped noise when exactly one candidate hits', async () => {
    await expect(resolveOcrSetNum(db, ['75192', '99999'])).resolves.toMatchObject({
      kind: 'accepted', setNum: '75192',
    });
  });

  it('treats several catalog hits as ambiguous', async () => {
    const result = await resolveOcrSetNum(db, ['75192', '75313-1']);
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      expect(result.setNums.sort()).toEqual(['75192', '75313-1']);
    }
  });

  it('does not invent a set when nothing maps', async () => {
    await expect(resolveOcrSetNum(db, [])).resolves.toEqual({ kind: 'empty' });
    await expect(resolveOcrSetNum(db, ['88888'])).resolves.toEqual({ kind: 'unmapped' });
  });
});
