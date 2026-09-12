import test from 'node:test';
import assert from 'node:assert/strict';

const memory = new Map();
globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)), removeItem: key => memory.delete(key) };
globalThis.location = { hash: '' };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
globalThis.window = { IMAGE_BASE: '', addEventListener() {}, dispatchEvent() {}, location: globalThis.location };
const { saveSession } = await import('../api.js');
const { subcollectionRequest, GUEST_SUBCOLLECTIONS_KEY } = await import('../lib/subcollection-storage.js');
const id = '11111111-1111-4111-8111-111111111111';
const body = { name: 'Display', set_nums: ['123'], revision: 0 };

test('guest revision prevents stale changes and a damaged store is never silently overwritten', async () => {
  memory.clear(); saveSession(null);
  await subcollectionRequest(id, { method: 'PUT', body });
  await assert.rejects(subcollectionRequest(id, { method: 'PUT', body }), error => error.status === 409);
  await assert.rejects(subcollectionRequest(id, { method: 'DELETE', body: { revision: 0 } }), error => error.status === 409);
  const rows = (await subcollectionRequest()).subcollections;
  assert.equal(rows[0].revision, 1);
  assert.deepEqual(rows[0].set_nums, ['123-1']);
  memory.set(GUEST_SUBCOLLECTIONS_KEY, '{broken');
  await assert.rejects(subcollectionRequest(id, { method: 'PUT', body }));
  assert.equal(memory.get(GUEST_SUBCOLLECTIONS_KEY), '{broken');
});

test('waiting guest write cannot be committed into another account', async () => {
  memory.clear(); saveSession(null);
  let perform;
  navigator.locks = { request: async (_name, callback) => { perform = callback; } };
  await subcollectionRequest(id, { method: 'PUT', body });
  saveSession({ access_token: `x.${Buffer.from(JSON.stringify({ sub: 'other' })).toString('base64url')}.x` });
  assert.throws(perform, error => error.status === 409);
  assert.equal(memory.has(GUEST_SUBCOLLECTIONS_KEY), false);
  delete navigator.locks;
});

test('the final safe revision remains readable and removable without allowing another increment', async () => {
  memory.clear(); saveSession(null);
  memory.set(GUEST_SUBCOLLECTIONS_KEY, JSON.stringify([{ ...body, id, revision: Number.MAX_SAFE_INTEGER }]));
  assert.equal((await subcollectionRequest()).subcollections[0].revision, Number.MAX_SAFE_INTEGER);
  await assert.rejects(subcollectionRequest(id, { method: 'PUT', body: { ...body, revision: Number.MAX_SAFE_INTEGER } }), error => error.status === 400);
  await subcollectionRequest(id, { method: 'DELETE', body: { revision: Number.MAX_SAFE_INTEGER } });
  assert.deepEqual((await subcollectionRequest()).subcollections, []);
});

test('signed-in list deletes never queue offline and revision conflicts retain their status', async () => {
  memory.clear();
  saveSession({ access_token: `x.${Buffer.from(JSON.stringify({ sub: 'signed-in' })).toString('base64url')}.x` });
  const original = globalThis.fetch;
  let calls = 0;
  try {
    navigator.onLine = false;
    globalThis.fetch = async () => { calls++; throw new TypeError('offline'); };
    await assert.rejects(subcollectionRequest(id, { method: 'DELETE', body: { revision: 1 } }), /offline/);
    assert.equal(calls, 1);
    assert.equal(memory.has('bv_outbox'), false);
    navigator.onLine = true;
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Revision conflict' }), { status: 409, headers: { 'content-type': 'application/json' } });
    await assert.rejects(subcollectionRequest(id, { method: 'PUT', body: { ...body, revision: 1 } }), error => error.status === 409);
  } finally { globalThis.fetch = original; navigator.onLine = true; }
});
