import test from 'node:test';
import assert from 'node:assert/strict';
import { scrollKeyFor, shouldRestoreScroll } from '../lib/scroll-memory.js';

test('a set page opened again from a list starts at the top', () => {
  assert.equal(shouldRestoreScroll('/set/71016-1', { fromDepth: 2, toDepth: 3 }), false);
  assert.equal(shouldRestoreScroll('/retiring', { fromDepth: 1, toDepth: 2 }), false);
});

test('Back to a page keeps where it was left', () => {
  assert.equal(shouldRestoreScroll('/retiring', { fromDepth: 3, toDepth: 2 }), true);
  assert.equal(shouldRestoreScroll('/set/71016-1', { fromDepth: 4, toDepth: 3 }), true);
});

test('bottom-bar destinations keep their scroll on every visit', () => {
  for (const hash of ['/', '/add', '/wishlist', '/me', '/minifigs']) {
    assert.equal(shouldRestoreScroll(hash, { fromDepth: 1, toDepth: 2 }), true, hash);
  }
});

test('a re-render in place keeps the position', () => {
  assert.equal(shouldRestoreScroll('/set/71016-1', { fromDepth: 3, toDepth: 3 }), true);
  assert.equal(shouldRestoreScroll('/set/71016-1', { fromDepth: null, toDepth: 0 }), true);
});

test('set page sections share one scroll key', () => {
  assert.equal(scrollKeyFor('/set/71016-1/history'), '/set/71016-1');
  assert.equal(scrollKeyFor('/set/71016-1'), '/set/71016-1');
  assert.equal(scrollKeyFor('/retiring'), '/retiring');
});
