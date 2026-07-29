import { describe, it, expect } from 'vitest';
import { parseMinifigCatalog, normalizeMinifigName, resolveBlId, namePrefixes, matchBlCandidates } from './lib/bricklink-minifigs';

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
  it('falls back to a ±1 year match when no candidate matches the year exactly', () => {
    const cands = [{ bl_id: 'loc031', year: 2013 }, { bl_id: 'loc131', year: 2018 }];
    expect(resolveBlId(cands, 2014)).toBe('loc031');
  });
  it('does not use the ±1 fallback when two candidates are equally near', () => {
    const cands = [{ bl_id: 'a', year: 2013 }, { bl_id: 'b', year: 2015 }];
    expect(resolveBlId(cands, 2014)).toBeNull();
  });
});

describe('namePrefixes', () => {
  it('returns cumulative prefixes longest-first, excluding the single-token one', () => {
    expect(namePrefixes('batman black suit black cape')).toEqual([
      'batman black suit black',
      'batman black suit',
      'batman black',
    ]);
  });
  it('returns nothing for short names', () => {
    expect(namePrefixes('gorzan')).toEqual([]);
    expect(namePrefixes('sir fangar')).toEqual([]);
  });
});

describe('matchBlCandidates', () => {
  const row = (bl_id: string, norm_name: string, year: number | null = null) => ({ bl_id, norm_name, year });

  it('prefers an exact match over a longer BrickLink name', () => {
    const rows = [row('loc102', 'sir fangar', 2014), row('loc161', 'sir fangar dark blue cape', 2015)];
    expect(matchBlCandidates(rows, 'sir fangar', 2014)).toMatchObject({ bl_id: 'loc102', tier: 'exact' });
  });

  it('matches a BrickLink name that extends ours when it is the only one', () => {
    const rows = [row('loc087', 'sir fangar heavy armor cape', 2014)];
    expect(matchBlCandidates(rows, 'sir fangar', 2014)).toMatchObject({ bl_id: 'loc087', tier: 'bl_longer' });
  });

  it('parks rival extensions for price verification instead of guessing', () => {
    const rows = [
      row('loc050', 'gorzan pearl gold heavy armor', 2014),
      row('loc068', 'gorzan flat silver heavy armor', 2014),
      row('loc091', 'gorzan fire chi', 2014),
    ];
    const m = matchBlCandidates(rows, 'gorzan', 2014);
    expect(m.bl_id).toBeNull();
    expect(m.tier).toBe('bl_longer');
    expect(m.ambiguous.map((c) => c.bl_id).sort()).toEqual(['loc050', 'loc068', 'loc091']);
  });

  it('ranks parked candidates by release-year proximity and caps the fan-out', () => {
    const rows = [
      ...Array.from({ length: 7 }, (_, i) => row(`far${i}`, `gorzan far ${i}`, 1990 + i)),
      row('near1', 'gorzan near one', 2014),
      row('near2', 'gorzan near two', 2014), // two same-year rivals -> no unique pick
    ];
    const m = matchBlCandidates(rows, 'gorzan', 2014);
    expect(m.bl_id).toBeNull();
    expect(m.ambiguous).toHaveLength(6);
    expect(m.ambiguous.slice(0, 2).map((c) => c.bl_id).sort()).toEqual(['near1', 'near2']);
  });

  it('matches the longest BrickLink prefix when our name is more specific', () => {
    const rows = [row('bat001', 'batman black suit', 2012), row('bat000', 'batman black', 2011)];
    expect(matchBlCandidates(rows, 'batman black suit black cape and cowl', 2012))
      .toMatchObject({ bl_id: 'bat001', tier: 'rb_longer' });
  });

  it('never mixes tiers — an exact miss does not fall through to a prefix pick', () => {
    const rows = [row('a', 'gorzan', 2013), row('b', 'gorzan', 2015), row('c', 'gorzan fire chi', 2014)];
    const m = matchBlCandidates(rows, 'gorzan', 2019);
    expect(m.bl_id).toBeNull();
    expect(m.tier).toBe('exact');
    expect(m.ambiguous.map((c) => c.bl_id).sort()).toEqual(['a', 'b']);
  });

  it('refuses a lone prefix match whose release year disagrees (regression: fig-011751)', () => {
    // Rebrickable "Captain America - Zombie" (2021) truncates to "captain
    // america" — exactly what BrickLink sh0028 "Captain America (Toy Fair 2012
    // Exclusive)" normalizes to. That figure is worth $884; before the year gate
    // it was assigned outright and priced the zombie at $884.
    const rows = [row('sh0028', 'captain america', 2012)];
    const m = matchBlCandidates(rows, 'captain america zombie', 2021);
    expect(m.bl_id).toBeNull();
    expect(m.tier).toBe('rb_longer');
    expect(m.ambiguous.map((c) => c.bl_id)).toEqual(['sh0028']); // verifier decides
  });

  it('refuses a lone prefix match when either year is unknown', () => {
    expect(matchBlCandidates([row('x', 'gorzan fire chi', null)], 'gorzan', 2014).bl_id).toBeNull();
    expect(matchBlCandidates([row('x', 'gorzan fire chi', 2014)], 'gorzan', null).bl_id).toBeNull();
  });

  it('still trusts an exact name match with no year to compare', () => {
    expect(matchBlCandidates([row('loc031', 'gorzan', null)], 'gorzan', 2014))
      .toMatchObject({ bl_id: 'loc031', tier: 'exact' });
  });

  it('ignores unrelated rows and reports no tier', () => {
    const rows = [row('z', 'harry potter', 2001)];
    expect(matchBlCandidates(rows, 'gorzan', 2014)).toEqual({ bl_id: null, ambiguous: [], tier: null });
  });
});
