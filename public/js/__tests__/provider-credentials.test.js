import test from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.get(key) ?? null; }
  setItem(key, value) { this.#values.set(key, String(value)); }
  removeItem(key) { this.#values.delete(key); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();

const {
  getProviderCredential,
  hasPersistentProviderCredential,
  setProviderCredential,
} = await import('../lib/provider-credentials.js');

test('provider credentials are session-only by default', () => {
  setProviderCredential('gemini', 'session-secret');
  assert.equal(getProviderCredential('gemini'), 'session-secret');
  assert.equal(sessionStorage.getItem('bv_session_gemini_key'), 'session-secret');
  assert.equal(localStorage.getItem('bv_gemini_key'), null);
  assert.equal(hasPersistentProviderCredential('gemini'), false);
});

test('remembered provider credentials are explicit and can be removed', () => {
  setProviderCredential('openai', 'persistent-secret', true);
  assert.equal(getProviderCredential('openai'), 'persistent-secret');
  assert.equal(localStorage.getItem('bv_openai_key'), 'persistent-secret');
  assert.equal(hasPersistentProviderCredential('openai'), true);
  setProviderCredential('openai', '');
  assert.equal(getProviderCredential('openai'), '');
  assert.equal(localStorage.getItem('bv_openai_key'), null);
});
