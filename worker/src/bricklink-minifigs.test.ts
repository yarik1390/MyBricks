import { describe, it, expect } from 'vitest';
import { parseMinifigCatalog, normalizeMinifigName, resolveBlId } from './lib/bricklink-minifigs';

const SAMPLE = [
  'Category ID\tCategory Name\tNumber\tName\tYear Released\tWeight (in Grams)',
  '',
  '65\tStar Wars / Episode 4/5/6\tsw0002\tBoba Fett - Classic Grays\t2000\t4',
  "102\tScala\tscaFemA05\tScala Doll Female Adult (Olivia)\t1998\t31",
  '9\tCastle\tcas004\tDark Forest - Forestman 1\t1996\t3.5',
  'bad line with no tabs',
].join('\n');

describe('parseMinifigCatalog', () => {
  it('parses tab rows, skipping header and malformed lines', () => {
    const rows = parseMinifigCatalog(SAMPLE);
    expect(rows.map((r) => r.bl_id)).toEqual(['sw0002', 'scaFemA05', 'cas004']);
    const boba = rows[0];
    expect(boba.name).toBe('Boba Fett - Classic Grays');
    expect(boba.year).toBe(2000);
    expect(boba.category).toBe('Star Wars / Episode 4/5/6');
    expect(boba.norm_name).toBe('boba fett classic grays');
  });

  it('drops parenthetical variant notes in the normalized name', () => {
    const rows = parseMinifigCatalog(SAMPLE);
    const scala = rows.find((r) => r.bl_id === 'scaFemA05');
    expect(scala?.norm_name).toBe('scala doll female adult'); // "(Olivia)" dropped
  });

  it('handles empty input', () => {
    expect(parseMinifigCatalog('')).toEqual([]);
  });
});

describe('normalizeMinifigName', () => {
  it('lowercases, strips punctuation and parentheticals', () => {
    expect(normalizeMinifigName('Anakin Skywalker (Brown Aviator Cap)')).toBe('anakin skywalker');
    expect(normalizeMinifigName('Dark Forest - Forestman 4, Brown Legs')).toBe('dark forest forestman 4 brown legs');
  });
});

describe('resolveBlId', () => {
  it('returns the id on a unique match', () => {
    expect(resolveBlId([{ bl_id: 'sw0002', year: 2000 }], 2000)).toBe('sw0002');
  });
  it('disambiguates multiple candidates by year', () => {
    const cands = [{ bl_id: 'sw0004', year: 1999 }, { bl_id: 'sw0200', year: 2010 }];
    expect(resolveBlId(cands, 2010)).toBe('sw0200');
  });
  it('returns null when ambiguous and year does not disambiguate', () => {
    const cands = [{ bl_id: 'sw0004', year: 1999 }, { bl_id: 'sw0005', year: 1999 }];
    expect(resolveBlId(cands, 1999)).toBeNull();
    expect(resolveBlId(cands, null)).toBeNull();
  });
  it('returns null on no candidates', () => {
    expect(resolveBlId([], 2000)).toBeNull();
  });
});
