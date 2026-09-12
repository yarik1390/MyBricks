import test from 'node:test';
import assert from 'node:assert/strict';

const memory = new Map();
globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)), removeItem: key => memory.delete(key) };
globalThis.location = { hash: '' };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
globalThis.window = { WORKER_BASE: 'https://worker.test', IMAGE_BASE: '', addEventListener() {}, dispatchEvent() {}, location: globalThis.location };

const apiModule = await import('../api.js');
const { api, drainOutbox, getSessionOwnerSnapshot, outboxEnqueue, saveSession, setSupabaseConfig, OUTBOX_KEY } = apiModule;
const session = (sub, suffix = '') => ({
  access_token: `x.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.${suffix || 'x'}`,
  refresh_token: `refresh-${sub}-${suffix || 'x'}`,
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('offlineQueue false rejects a failed mutation and never records fake success', async () => {
  memory.clear();
  navigator.onLine = false;
  saveSession(session('A'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  try {
    await assert.rejects(api('/api/subcollections/id', { method: 'DELETE', retry: false, offlineQueue: false }));
    assert.equal(memory.has(OUTBOX_KEY), false);
  } finally { globalThis.fetch = originalFetch; navigator.onLine = true; }
});

test('HTTP failures retain status for conflict-aware callers', async () => {
  saveSession(session('A'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => json({ error: 'Revision conflict' }, 409);
  try {
    await assert.rejects(api('/api/subcollections/id', { retry: false }), error => error.status === 409 && /Revision conflict/.test(error.message));
  } finally { globalThis.fetch = originalFetch; }
});

test('a refresh started for account A cannot overwrite account B', async () => {
  setSupabaseConfig('https://auth.test', 'anon');
  saveSession(session('A'));
  const originalFetch = globalThis.fetch;
  let releaseRefresh;
  let enteredRefresh;
  const refreshStarted = new Promise(resolve => { enteredRefresh = resolve; });
  const refreshGate = new Promise(resolve => { releaseRefresh = resolve; });
  globalThis.fetch = async url => {
    if (String(url).startsWith('https://auth.test/')) {
      enteredRefresh();
      await refreshGate;
      return json(session('A', 'fresh'));
    }
    return json({ error: 'Invalid JWT' }, 401);
  };
  try {
    const request = api('/api/private', { retry: false });
    await refreshStarted;
    saveSession(session('B'));
    releaseRefresh();
    await assert.rejects(request, error => error.code === 'OUTBOX_OWNER_CHANGED');
    assert.equal(getSessionOwnerSnapshot().userId, 'B');
  } finally { globalThis.fetch = originalFetch; }
});

test('an account switch during outbox replay stops later requests and preserves the cleared queue', async () => {
  memory.clear();
  saveSession(session('A'));
  outboxEnqueue({ path: '/api/first', method: 'POST', body: { value: 1 } });
  outboxEnqueue({ path: '/api/second', method: 'POST', body: { value: 2 } });
  const originalFetch = globalThis.fetch;
  let releaseFirst;
  let enteredFirst;
  const firstStarted = new Promise(resolve => { enteredFirst = resolve; });
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const requests = [];
  globalThis.fetch = async url => {
    requests.push(String(url));
    enteredFirst();
    await firstGate;
    return json({ ok: true });
  };
  try {
    const draining = drainOutbox();
    await firstStarted;
    saveSession(session('B'));
    releaseFirst();
    await draining;
    assert.deepEqual(requests, ['https://worker.test/api/first']);
    assert.equal(memory.has(OUTBOX_KEY), false);
  } finally { globalThis.fetch = originalFetch; }
});
