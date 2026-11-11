import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ensureAttestation, currentAttestation } from '../lib/play-attest.js';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

describe('Play Integrity attestation client', () => {
  beforeEach(() => store.clear());

  it('does nothing on the web (no plugin)', async () => {
    assert.equal(await ensureAttestation('u1', async () => { throw new Error('no call'); }, null), '');
  });

  it('fetches nonce, token and attestation, then reuses it', async () => {
    const calls = [];
    const call = async (path, opts) => {
      calls.push(path);
      if (path === '/api/attest/nonce') return { enabled: true, nonce: 'n'.repeat(20) };
      assert.equal(opts.body.token, 'play-token');
      return { attested: true, token: 'att', expires_at: 1_000_000 };
    };
    const plugin = { requestToken: async ({ nonce }) => ({ token: nonce.length >= 16 ? 'play-token' : '' }) };
    assert.equal(await ensureAttestation('u1', call, plugin, 1000), 'att');
    assert.equal(await ensureAttestation('u1', call, plugin, 2000), 'att');
    assert.deepEqual(calls, ['/api/attest/nonce', '/api/attest/android']);
    assert.equal(currentAttestation('u1', 2000), 'att');
    assert.equal(currentAttestation('u2', 2000), '', 'bound to the user');
  });

  it('backs off while the server has attestation switched off', async () => {
    let n = 0;
    const call = async () => { n++; return { enabled: false }; };
    const plugin = { requestToken: async () => ({ token: 'x' }) };
    assert.equal(await ensureAttestation('u1', call, plugin, 1000), '');
    assert.equal(await ensureAttestation('u1', call, plugin, 1000 + 3600), '');
    assert.equal(n, 1);
  });

  it('survives a native failure without throwing', async () => {
    const call = async () => ({ enabled: true, nonce: 'n'.repeat(20) });
    const plugin = { requestToken: async () => { throw new Error('play services missing'); } };
    assert.equal(await ensureAttestation('u1', call, plugin, 1000), '');
  });
});
