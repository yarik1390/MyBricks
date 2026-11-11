// Offline seed catalog core: parse, index and query the bundled snapshot.
// Shared by the background worker (seed-catalog-worker.js) and the in-process
// fallback in seed-catalog.js. DOM-free and state-free apart from the index.

import { seedFilterSort } from './pure.js';

/** Build the in-memory index from the parsed JSON. */
export function indexSeed(json) {
  const sets = Array.isArray(json?.sets) ? json.sets : [];
  const byNum = new Map(sets.map((s) => [String(s.set_num), s]));
  return { generated_at: json?.generated_at || null, count: sets.length, sets, byNum };
}

/** Same shape as /api/sets/search ({ sets, total, hasMore }). */
export function querySeed(seed, params = {}) {
  const limit = Number(params.limit) || 24;
  const offset = Number(params.offset) || 0;
  const filtered = seedFilterSort(seed.sets, params);
  const page = filtered.slice(offset, offset + limit).map((s) => ({ ...s, _seed: true }));
  return { sets: page, total: filtered.length, hasMore: offset + limit < filtered.length, _seed: true };
}

/** Same shape as /api/sets/:setnum, or null. */
export function detailFromSeed(seed, setNum) {
  const row = seed.byNum.get(String(setNum));
  return row ? { set: { ...row, _seed: true }, entry: null, set_minifigs: [] } : null;
}

/** The first n rows (the snapshot is ordered by value, highest first). */
export function headOfSeed(seed, n) {
  return seed.sets.slice(0, Math.max(0, Number(n) || 0));
}
