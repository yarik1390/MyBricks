import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openverseMatches, bareSetNum, imageRows } from '../openverse-photos.mjs';

test('keeps Openverse results only when title or tags name the set number', () => {
  const base = { url: 'https://live.staticflickr.com/1/2_b.jpg' };
  assert.equal(openverseMatches('75192-1', { ...base, title: 'LEGO 75192 Millennium Falcon' }), true);
  assert.equal(openverseMatches('75192-1', { ...base, title: 'Falcon', tags: [{ name: 'lego75192' }] }), true);
  assert.equal(openverseMatches('75192-1', { ...base, title: 'LEGO 751923 something' }), false);
  assert.equal(openverseMatches('75192-1', { ...base, title: 'A LEGO ship' }), false);
  assert.equal(openverseMatches('75192-1', { title: 'LEGO 75192' }), false); // no URL
  assert.equal(openverseMatches('10-1', { ...base, title: 'LEGO 10' }), false); // too short to match safely
  assert.equal(bareSetNum('10294-2'), '10294');
});

test('builds attribution rows for kept photos', () => {
  const rows = imageRows('75192-1', [
    { url: 'https://a/1.jpg', title: 'LEGO 75192', source: 'flickr', license: 'by', license_version: '2.0', creator: 'Ann', foreign_landing_url: 'https://flickr.com/p/1' },
    { url: 'https://a/2.jpg', title: 'Some ship' },
  ]);
  assert.deepEqual(rows, [['75192-1', 'https://a/1.jpg', 'openverse:flickr', 'by 2.0', 'Ann', 'https://flickr.com/p/1']]);
});
