/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { barcodeCandidates, isValidGtin, findSetByBarcodeLocal, setFromProductTitle, saveBarcodeStatements } from './lib/barcodes';

describe('barcode helpers', () => {
  it('expands a code into every UPC/EAN spelling', () => {
    expect(barcodeCandidates('673419375092')).toEqual(expect.arrayContaining(['673419375092', '0673419375092']));
    expect(barcodeCandidates('0673419375092')).toEqual(expect.arrayContaining(['673419375092']));
    expect(barcodeCandidates('5 702017 41632 8')).toContain('5702017416328');
    expect(barcodeCandidates('123')).toEqual([]);
  });

  it('checks the GS1 check digit', () => {
    expect(isValidGtin('5702017416328')).toBe(true);
    expect(isValidGtin('5702017416327')).toBe(false);
    expect(isValidGtin('673419375092')).toBe(true);
  });
});

describe('barcode lookup against D1', () => {
  let db: D1Database;
  beforeEach(async () => {
    db = (env as any).DB;
    for (const s of [
      'DROP TABLE IF EXISTS lego_sets',
      'DROP TABLE IF EXISTS set_barcodes',
      'DROP TABLE IF EXISTS set_contributions',
      'CREATE TABLE lego_sets (set_num TEXT PRIMARY KEY, name TEXT NOT NULL, upc TEXT)',
      'CREATE TABLE set_barcodes (code TEXT PRIMARY KEY, set_num TEXT NOT NULL, kind TEXT, source TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)',
      `CREATE TABLE set_contributions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, set_num TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'pending', reviewer_id TEXT, review_note TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, reviewed_at DATETIME, deleted_at DATETIME)`,
    ]) await db.prepare(s).run();
    await db.prepare(`INSERT INTO lego_sets VALUES ('60372-1', 'Police Training Academy', '673419375092')`).run();
  });

  it('finds the US UPC on lego_sets', async () => {
    expect(await findSetByBarcodeLocal(env as any, '0673419375092')).toEqual({ setNum: '60372-1', source: 'catalog' });
  });

  it('finds the EU EAN of a set that already has a US UPC', async () => {
    expect(await findSetByBarcodeLocal(env as any, '5702017416328')).toBeNull();
    await db.batch(saveBarcodeStatements(env as any, '60372-1', ['673419375092', '5702017416328'], 'brickset'));
    expect(await findSetByBarcodeLocal(env as any, '5702017416328')).toEqual({ setNum: '60372-1', source: 'barcode_table' });
  });

  it('a cached miss never answers, and a real mapping replaces it', async () => {
    await db.prepare(`INSERT INTO set_barcodes (code, set_num, kind, source) VALUES ('5702017416328', '', 'ean', 'miss')`).run();
    expect(await findSetByBarcodeLocal(env as any, '5702017416328')).toBeNull();
    await db.batch(saveBarcodeStatements(env as any, '60372-1', ['5702017416328'], 'brickset'));
    expect(await findSetByBarcodeLocal(env as any, '5702017416328')).toEqual({ setNum: '60372-1', source: 'barcode_table' });
  });

  it('never overwrites an existing different mapping', async () => {
    await db.prepare(`INSERT INTO lego_sets VALUES ('1-1', 'Other', NULL)`).run();
    await db.batch(saveBarcodeStatements(env as any, '60372-1', ['5702017416328'], 'brickset'));
    await db.batch(saveBarcodeStatements(env as any, '1-1', ['5702017416328'], 'community'));
    expect((await db.prepare(`SELECT set_num FROM set_barcodes WHERE code='5702017416328'`).first<any>()).set_num).toBe('60372-1');
  });

  it('a code you taught works for you right away, not for others', async () => {
    await db.prepare(`INSERT INTO set_contributions (user_id, set_num, kind, payload) VALUES ('me', '60372-1', 'barcode', '{"upc":"5702017416328"}')`).run();
    expect(await findSetByBarcodeLocal(env as any, '5702017416328', 'me')).toEqual({ setNum: '60372-1', source: 'taught_by_you' });
    expect(await findSetByBarcodeLocal(env as any, '5702017416328', 'someone-else')).toBeNull();
    expect(await findSetByBarcodeLocal(env as any, '5702017416328')).toBeNull();
  });

  it('reads a set number out of a retailer title only when the name agrees', async () => {
    expect(await setFromProductTitle(env as any, 'LEGO City Police Training Academy 60372 Building Toy, 823 pieces')).toBe('60372-1');
    expect(await setFromProductTitle(env as any, 'LEGO Friends Heartlake Cafe 60372')).toBeNull();
    expect(await setFromProductTitle(env as any, 'Police Training Academy 60372')).toBeNull();
  });
});
