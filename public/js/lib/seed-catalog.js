// Offline seed catalog: a snapshot of the top sets bundled INSIDE the app
// (public/data/seed-catalog.json, generated at build time from /api/catalog/seed).
// When the network/API is unreachable, the catalog and set-detail views fall
// back to this so a fresh install with no connection can still browse, search
// and open the sets that matter. Everything here is DOM-free and state-free so
// it's unit-testable; the pure filter/sort core lives in pure.js.

import { seedFilterSort } from './pure.js';

let _cache = null;        // { generated_at, count, sets, byNum }
let _inflight = null;     // dedupe concurrent loads

// Load + memoize the bundled snapshot. Returns null if it's absent (web deploys
// that never generated it) so callers can degrade gracefully.
export async function loadSeedCatalog() {
  if (_cache) return _cache;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await fetch('/data/seed-catalog.json', { cache: 'force-cache' });
      if (!res.ok) return null;
      const json = await res.json();
      const sets = Array.isArray(json?.sets) ? json.sets : [];
      const byNum = new Map(sets.map((s) => [String(s.set_num), s]));
      _cache = { generated_at: json.generated_at || null, count: sets.length, sets, byNum };
      return _cache;
    } catch {
      return null;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

// Mirrors the /api/sets/search response shape ({ sets, total, hasMore }) from
// the bundled data, so loadCatalog() can swap it in when the API call fails.
// `params` is a plain object of the same keys catalogQuery() emits.
export async function searchSeedCatalog(params = {}) {
  const seed = await loadSeedCatalog();
  if (!seed) return null;
  const limit = Number(params.limit) || 24;
  const offset = Number(params.offset) || 0;
  const filtered = seedFilterSort(seed.sets, params);
  const page = filtered.slice(offset, offset + limit).map((s) => ({ ...s, _seed: true }));
  return { sets: page, total: filtered.length, hasMore: offset + limit < filtered.length, _seed: true };
}

// Offline set-detail fallback: return the bundled row for a set number, shaped
// like the /api/sets/:setnum payload ({ set, entry, set_minifigs }).
export async function getSeedSetDetail(setNum) {
  const seed = await loadSeedCatalog();
  const row = seed?.byNum.get(String(setNum));
  if (!row) return null;
  return { set: { ...row, _seed: true }, entry: null, set_minifigs: [] };
}
