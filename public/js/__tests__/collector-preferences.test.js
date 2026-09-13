import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readCollectorPreferences, writeCollectorPreferences } from '../lib/collector-preferences.js';
describe('collector preferences', () => {
  it('keeps room choice and collection pins separate for guests and accounts', () => {
    const values = new Map();
    const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
    writeCollectorPreferences(null, { view: 'room', pins: ['guest-list'] }, storage);
    writeCollectorPreferences('alice', { pins: ['alice-list'] }, storage);
    assert.deepEqual(readCollectorPreferences('alice', storage), { view: 'grid', pins: ['alice-list'] });
    assert.deepEqual(readCollectorPreferences('bob', storage), { view: 'grid', pins: [] });
    assert.equal(readCollectorPreferences(null, storage).view, 'room');
  });
  it('recovers from damaged or blocked device storage', () => {
    assert.deepEqual(readCollectorPreferences('alice', { getItem: () => '{' }), { view: 'grid', pins: [] });
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
    assert.equal(writeCollectorPreferences('alice', { view: 'room' }, blocked), false);
  });
});
