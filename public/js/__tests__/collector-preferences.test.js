import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readCollectorPreferences, writeCollectorPreferences } from '../lib/collector-preferences.js';
describe('collector preferences', () => {
  it('keeps room choice, layout and collection pins separate for guests and accounts', () => {
    const values = new Map();
    const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
    writeCollectorPreferences(null, { view: 'room', pins: ['guest-list'] }, storage);
    writeCollectorPreferences('alice', { pins: ['alice-list'] }, storage);
    writeCollectorPreferences('alice', { layout: 'grid' }, storage);
    assert.deepEqual(readCollectorPreferences('alice', storage), { view: 'grid', layout: 'grid', pins: ['alice-list'] });
    assert.deepEqual(readCollectorPreferences('bob', storage), { view: 'grid', layout: 'list', pins: [] });
    assert.equal(readCollectorPreferences(null, storage).view, 'room');
    assert.equal(readCollectorPreferences(null, storage).layout, 'list');
  });
  it('rejects unknown layouts and keeps the other preferences on partial writes', () => {
    const values = new Map();
    const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
    writeCollectorPreferences('alice', { layout: 'table', pins: ['a'] }, storage);
    assert.equal(readCollectorPreferences('alice', storage).layout, 'list');
    writeCollectorPreferences('alice', { layout: 'grid' }, storage);
    writeCollectorPreferences('alice', { pins: ['b'] }, storage);
    assert.deepEqual(readCollectorPreferences('alice', storage), { view: 'grid', layout: 'grid', pins: ['b'] });
  });
  it('recovers from damaged or blocked device storage', () => {
    assert.deepEqual(readCollectorPreferences('alice', { getItem: () => '{' }), { view: 'grid', layout: 'list', pins: [] });
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
    assert.equal(writeCollectorPreferences('alice', { view: 'room' }, blocked), false);
  });
});
