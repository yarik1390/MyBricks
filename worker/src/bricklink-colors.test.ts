import { describe, it, expect } from 'vitest';
import { buildColorMap, lookupBlColor } from './lib/bricklink-colors';

// Rebrickable and BrickLink number colors differently; these are real examples
// (Rebrickable Black=0 -> BrickLink 11; White=15 -> 1; Red=4 -> 5).
const results = [
  { id: 0, external_ids: { BrickLink: { ext_ids: [11] } } },
  { id: 15, external_ids: { BrickLink: { ext_ids: [1] } } },
  { id: 4, external_ids: { BrickLink: { ext_ids: [5] } } },
  { id: 9999, external_ids: {} }, // "[Unknown]" — no BrickLink id
  { id: 1000 },                   // no external_ids at all
];

describe('bricklink color mapping', () => {
  it('builds a Rebrickable->BrickLink map, skipping colors with no BL id', () => {
    const map = buildColorMap(results);
    expect(map).toEqual({ 0: 11, 15: 1, 4: 5 });
    expect(9999 in map).toBe(false);
    expect(1000 in map).toBe(false);
  });

  it('translates known colors and skips ones with no BrickLink equivalent', () => {
    const map = buildColorMap(results);
    expect(lookupBlColor(map, 0)).toBe(11);
    expect(lookupBlColor(map, 15)).toBe(1);
    expect(lookupBlColor(map, 4)).toBe(5);
    expect(lookupBlColor(map, 9999)).toBeNull();
  });

  it('fails open (passthrough) when the map is unavailable', () => {
    expect(lookupBlColor(null, 4)).toBe(4);
  });

  it('handles empty / undefined input', () => {
    expect(buildColorMap(undefined)).toEqual({});
    expect(buildColorMap([])).toEqual({});
  });
});
