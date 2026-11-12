// Background worker for the ~11 MB offline seed catalog: the download, JSON
// parse, index and every filter/sort run here so the UI thread never freezes.
// Protocol: postMessage({ id, op, arg }) → { id, ok, result } | { id, ok:false }.
// op: 'search' (params), 'detail' (setNum), 'barcode' (code), 'head' (n), 'info'.

import { indexSeed, querySeed, detailFromSeed, headOfSeed, barcodeFromSeed } from './seed-catalog-core.js';

let seedPromise = null;

function loadSeed() {
  if (!seedPromise) {
    seedPromise = fetch('/data/seed-catalog.json', { cache: 'force-cache' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => (json ? indexSeed(json) : null))
      .catch(() => null);
    // A failed load (offline first launch) may succeed later: allow a retry.
    seedPromise.then((seed) => { if (!seed) seedPromise = null; });
  }
  return seedPromise;
}

self.onmessage = async (event) => {
  const { id, op, arg } = event.data || {};
  try {
    const seed = await loadSeed();
    let result = null;
    if (seed) {
      if (op === 'search') result = querySeed(seed, arg || {});
      else if (op === 'detail') result = detailFromSeed(seed, arg);
      else if (op === 'barcode') result = barcodeFromSeed(seed, arg);
      else if (op === 'head') result = headOfSeed(seed, arg);
      else if (op === 'info') result = { generated_at: seed.generated_at, count: seed.count };
    }
    self.postMessage({ id, ok: true, result });
  } catch {
    self.postMessage({ id, ok: false });
  }
};
