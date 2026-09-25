import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(root, '..', 'api.js'), 'utf8');
const block = src.slice(src.indexOf("export const OUTBOX_KEY ="), src.indexOf('export function loadSession()'))
  .replaceAll('export ', '');

function harness() {
  const values = new Map();
  let release;
  let calls = 0;
  let generation = 1;
  const ctx = {
    crypto, Date, Set, Object, JSON,
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
    getSessionOwnerSnapshot: () => ({ userId: 'user-a', generation }),
    api: async () => { calls++; await new Promise(resolve => { release = resolve; }); },
    invalidatePortfolio() {}, toast() {}, tPlural: () => '',
  };
  vm.createContext(ctx);
  vm.runInContext(`${block}\nthis.outboxEnqueue=outboxEnqueue;this.drainOutbox=drainOutbox;`, ctx);
  return { ctx, values, get release() { return release; }, get calls() { return calls; }, changeOwner() { generation++; } };
}

test('outbox retains a mutation enqueued while a prior item replays', async () => {
  const h = harness();
  h.ctx.outboxEnqueue({ path: '/one', method: 'POST' });
  const draining = h.ctx.drainOutbox();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls, 1);
  h.ctx.outboxEnqueue({ path: '/two', method: 'POST' });
  h.release();
  await draining;
  assert.deepEqual(JSON.parse(h.values.get('bv_outbox')).map(item => item.path), ['/two']);
});

test('outbox IDs are unique and an owner change keeps the pending queue', async () => {
  const h = harness();
  h.ctx.outboxEnqueue({ path: '/one' });
  h.ctx.outboxEnqueue({ path: '/two' });
  const before = JSON.parse(h.values.get('bv_outbox'));
  assert.equal(new Set(before.map(item => item.id)).size, 2);
  const draining = h.ctx.drainOutbox();
  await new Promise(resolve => setImmediate(resolve));
  h.changeOwner();
  h.release();
  await draining;
  assert.deepEqual(JSON.parse(h.values.get('bv_outbox')).map(item => item.path), ['/one', '/two']);
});
