import test from 'node:test';
import assert from 'node:assert/strict';

const memory = new Map();
globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)), removeItem: key => memory.delete(key) };
globalThis.location = { hash: '', href: 'https://app.test/', origin: 'https://app.test' };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
globalThis.window = { IMAGE_BASE: '', addEventListener() {}, dispatchEvent() {}, location: globalThis.location };
const { api, migrateGuestVault, saveSession } = await import('../api.js');
const { state } = await import('../state.js');
const session = sub => ({ access_token: `x.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.x` });
const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const holding = { quantity: 3, condition: 'used_good', purchase_price: 10.123456, purchased_at: '2024-02-29', notes: 'Guest details' };
const snapshot = { ownedFigs: ['fig-a'], figDetails: { 'fig-a': { fig_num: 'fig-a', holding } } };

test('guest minifigure migration preserves every detail and retains local data on account collisions', async () => {
  saveSession(session('A'));
  memory.set('bv_guest_fig_details', JSON.stringify(snapshot.figDetails));
  const originalFetch = globalThis.fetch;
  const writes = [];
  let exists = true;
  globalThis.fetch = async (_url, init = {}) => {
    if (init.method === 'PUT') {
      writes.push(JSON.parse(init.body));
      return json({ ok: true, fig_num: 'fig-a', quantity: 3, holding });
    }
    return json({ minifig: { fig_num: 'fig-a' }, holding: exists ? { ...holding, notes: 'Account details' } : null });
  };
  try {
    const collision = await migrateGuestVault(snapshot);
    assert.equal(collision.minifigs, 0);
    assert.match(collision.errors[0], /already exists/);
    assert.equal(writes.length, 0);
    assert.equal(JSON.parse(memory.get('bv_guest_fig_details'))['fig-a'].holding.notes, 'Guest details');
    exists = false;
    const imported = await migrateGuestVault(snapshot);
    assert.equal(imported.minifigs, 1);
    assert.deepEqual(writes, [holding]);
    assert.equal(memory.has('bv_guest_fig_details'), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('an account switch during lookup stops migration before write and keeps guest data', async () => {
  saveSession(session('A'));
  memory.set('bv_guest_fig_details', JSON.stringify(snapshot.figDetails));
  const originalFetch = globalThis.fetch;
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  let writes = 0;
  globalThis.fetch = async (_url, init = {}) => {
    if (init.method === 'PUT') writes++;
    entered();
    return pending;
  };
  try {
    const migration = migrateGuestVault(snapshot);
    const rejected = assert.rejects(migration, error => error.code === 'OUTBOX_OWNER_CHANGED');
    await started;
    saveSession(session('B'));
    release(json({ minifig: { fig_num: 'fig-a' }, holding: null }));
    await rejected;
    assert.equal(writes, 0);
    assert.equal(JSON.parse(memory.get('bv_guest_fig_details'))['fig-a'].holding.notes, 'Guest details');
  } finally { globalThis.fetch = originalFetch; }
});

test('an unconfirmed migration save never removes the local minifigure record', async () => {
  saveSession(session('A'));
  memory.set('bv_guest_fig_details', JSON.stringify(snapshot.figDetails));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init = {}) => json(init.method === 'PUT' ? { ok: true } : { minifig: { fig_num: 'fig-a' }, holding: null });
  try {
    const result = await migrateGuestVault(snapshot);
    assert.equal(result.minifigs, 0);
    assert.equal(result.errors.length, 1);
    assert.equal(JSON.parse(memory.get('bv_guest_fig_details'))['fig-a'].holding.notes, 'Guest details');
  } finally { globalThis.fetch = originalFetch; }
});

test('guest portfolio counts every loose minifigure copy', async () => {
  saveSession(null, { preserveGuestFigs: true });
  memory.set('bv_figs', JSON.stringify(['fig-a']));
  memory.set('bv_guest_fig_details', JSON.stringify(snapshot.figDetails));
  state.ownedFigs = new Set(['fig-a']);
  const result = await api('/api/collection');
  assert.equal(result.fig_count, 3);
});
