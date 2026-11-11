// Offline seed catalog: a snapshot of the top sets bundled INSIDE the app
// (public/data/seed-catalog.json, generated at build time from /api/catalog/seed).
// When the network/API is unreachable, the catalog and set-detail views fall
// back to this so a fresh install with no connection can still browse, search
// and open the sets that matter.
//
// The file is ~11 MB, so in the browser all the work (download, JSON parse,
// filtering) happens in a background worker (seed-catalog-worker.js) and only
// the small page of results crosses back. Where Worker is unavailable (Node
// tests, very old WebViews) or the worker fails, it runs in-process instead.

import { indexSeed, querySeed, detailFromSeed, headOfSeed } from './seed-catalog-core.js';

let _cache = null;        // in-process index (fallback path)
let _inflight = null;     // dedupe concurrent in-process loads

// In-process load + memoize. Returns null if the snapshot is absent (web
// deploys that never generated it) so callers can degrade gracefully.
export async function loadSeedCatalog() {
  if (_cache) return _cache;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await fetch('/data/seed-catalog.json', { cache: 'force-cache' });
      if (!res.ok) return null;
      _cache = indexSeed(await res.json());
      return _cache;
    } catch {
      return null;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

// ── background worker client ────────────────────────────────────────────────
let _worker = null;
let _workerBroken = false;
let _nextId = 0;
const _pending = new Map();

function failAll() {
  _workerBroken = true;
  for (const { reject } of _pending.values()) reject(new Error('seed worker failed'));
  _pending.clear();
  try { _worker?.terminate(); } catch { /* already gone */ }
  _worker = null;
}

function getWorker() {
  if (_workerBroken || typeof Worker === 'undefined') return null;
  if (_worker) return _worker;
  try {
    _worker = new Worker(new URL('./seed-catalog-worker.js', import.meta.url), { type: 'module' });
    _worker.onmessage = (e) => {
      const { id, ok, result } = e.data || {};
      const p = _pending.get(id);
      if (!p) return;
      _pending.delete(id);
      if (ok) p.resolve(result);
      else p.reject(new Error('seed worker error'));
    };
    _worker.onerror = failAll;
    _worker.onmessageerror = failAll;
  } catch {
    _workerBroken = true;
    _worker = null;
  }
  return _worker;
}

function ask(op, arg) {
  const w = getWorker();
  if (!w) return Promise.reject(new Error('seed worker unavailable'));
  const id = ++_nextId;
  return new Promise((resolve, reject) => {
    _pending.set(id, { resolve, reject });
    w.postMessage({ id, op, arg });
  });
}

/** Run op in the worker, or in-process when the worker is unavailable. */
async function run(op, arg, local) {
  try {
    return await ask(op, arg);
  } catch {
    const seed = await loadSeedCatalog();
    return seed ? local(seed) : null;
  }
}

// Mirrors the /api/sets/search response shape ({ sets, total, hasMore }) from
// the bundled data, so loadCatalog() can swap it in when the API call fails.
// `params` is a plain object of the same keys catalogQuery() emits.
export function searchSeedCatalog(params = {}) {
  const plain = { ...params };
  return run('search', plain, (seed) => querySeed(seed, plain));
}

// Offline set-detail fallback: return the bundled row for a set number, shaped
// like the /api/sets/:setnum payload ({ set, entry, set_minifigs }).
export function getSeedSetDetail(setNum) {
  return run('detail', String(setNum), (seed) => detailFromSeed(seed, setNum));
}

// The n most valuable sets in the snapshot (first-launch image prewarm).
export async function seedCatalogHead(n) {
  return (await run('head', n, (seed) => headOfSeed(seed, n))) || [];
}
