import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeGoogleIdToken, sha256Hex } from '../lib/native-auth.js';

const nativeWin = (plugin) => ({ Capacitor: { isNativePlatform: () => true, Plugins: plugin ? { GoogleIdSignIn: plugin } : {} } });

test('sha256Hex matches the known digest', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('nativeGoogleIdToken is null on the web, without the plugin, or without a client id', async () => {
  assert.equal(await nativeGoogleIdToken({ serverClientId: 'x', nonce: 'n' }, {}), null);
  assert.equal(await nativeGoogleIdToken({ serverClientId: 'x', nonce: 'n' }, nativeWin(null)), null);
  assert.equal(await nativeGoogleIdToken({ serverClientId: '', nonce: 'n' }, nativeWin({ signIn: async () => ({ idToken: 't' }) })), null);
});

test('nativeGoogleIdToken passes the client id and hashed nonce and returns the token', async () => {
  let seen;
  const win = nativeWin({ signIn: async (opts) => { seen = opts; return { idToken: 'tok' }; } });
  assert.equal(await nativeGoogleIdToken({ serverClientId: 'web.apps.googleusercontent.com', nonce: 'h' }, win), 'tok');
  assert.deepEqual(seen, { serverClientId: 'web.apps.googleusercontent.com', nonce: 'h' });
});

test('a closed sheet surfaces as a canceled error', async () => {
  const win = nativeWin({ signIn: async () => { const e = new Error('Sign-in canceled'); e.code = 'canceled'; throw e; } });
  await assert.rejects(nativeGoogleIdToken({ serverClientId: 'x', nonce: 'n' }, win), (e) => e.code === 'canceled');
});
