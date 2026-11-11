import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navDirection } from '../lib/motion.js';

const tabs = ['/', '/add', '/wishlist', '/me'];
const nav = (fromRoute, toRoute, fromDepth, toDepth) => navDirection({ fromRoute, toRoute, fromDepth, toDepth, tabs });

test('bottom tabs move sideways toward the tapped tab', () => {
  assert.equal(nav('/', '/wishlist', 0, 1), 'tab-r');
  assert.equal(nav('/me', '/add', 3, 4), 'tab-l');
});

test('going deeper slides forward and returning slides back', () => {
  assert.equal(nav('/', '/set/75192-1', 0, 1), 'fwd');
  assert.equal(nav('/set/75192-1', '/', 1, 0), 'back');
});

test('a same-depth change outside the tabs has no direction', () => {
  assert.equal(nav('/set/1-1', '/set/2-1', 2, 2), '');
  assert.equal(nav('/', '/', 0, 0), '');
});
