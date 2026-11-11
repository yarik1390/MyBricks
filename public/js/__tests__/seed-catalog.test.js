import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { indexSeed, querySeed, detailFromSeed, headOfSeed } from '../lib/seed-catalog-core.js';
import { searchSeedCatalog, getSeedSetDetail, seedCatalogHead } from '../lib/seed-catalog.js';

const json = {
  generated_at: '2026-11-11',
  sets: [
    { set_num: '10294-1', name: 'Titanic', theme: 'Icons', pieces: 9092, market_value: 571 },
    { set_num: '10276-1', name: 'Colosseum', theme: 'Icons', pieces: 9036, market_value: 1094 },
    { set_num: '60337-1', name: 'Express Passenger Train', theme: 'City', pieces: 764, market_value: 120 },
  ],
};

describe('offline seed catalog core', () => {
  const seed = indexSeed(json);
  it('indexes by set number', () => {
    assert.equal(seed.count, 3);
    assert.equal(detailFromSeed(seed, '10294-1').set.name, 'Titanic');
    assert.equal(detailFromSeed(seed, 'nope'), null);
  });
  it('pages search results in the API shape', () => {
    const r = querySeed(seed, { sort: 'value_desc', limit: 2 });
    assert.deepEqual(r.sets.map((s) => s.set_num), ['10276-1', '10294-1']);
    assert.equal(r.total, 3);
    assert.equal(r.hasMore, true);
    assert.equal(r.sets[0]._seed, true);
  });
  it('returns the head rows', () => {
    assert.equal(headOfSeed(seed, 2).length, 2);
    assert.equal(headOfSeed(seed, 0).length, 0);
  });
});

describe('offline seed catalog without Worker (in-process fallback)', () => {
  it('serves search, detail and head from one fetch', async () => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify(json), { status: 200 }); };
    try {
      assert.equal(typeof globalThis.Worker, 'undefined');
      assert.equal((await searchSeedCatalog({ theme: 'City' })).sets[0].set_num, '60337-1');
      assert.equal((await getSeedSetDetail('10276-1')).set.name, 'Colosseum');
      assert.equal((await seedCatalogHead(1)).length, 1);
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
