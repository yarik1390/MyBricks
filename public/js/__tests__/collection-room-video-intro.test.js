import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../components/collection-room-video-intro.js', import.meta.url), 'utf8');
const view = readFileSync(new URL('../views/collection-room.js', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');

test('video intro uses local muted inline media with bounded fallback and complete teardown', () => {
  assert.match(source, /'\/video\/vault-door-intro\.mp4'/);
  assert.match(source, /muted playsinline preload="metadata"/);
  assert.match(source, /START_TIMEOUT_MS = 3500/);
  assert.match(source, /STALL_TIMEOUT_MS = 2200/);
  assert.match(source, /HARD_TIMEOUT_MS = 8500/);
  assert.match(source, /Promise\.resolve\(video\.play\(\)\)\.catch\(\(\) => fallback\('play-rejected'\)\)/);
  assert.match(source, /video\.pause\(\)/);
  assert.match(source, /video\.removeAttribute\('src'\)/);
  assert.match(source, /document\.removeEventListener\('visibilitychange'/);
});

test('video eligibility respects reduced motion, save-data and slow networks', () => {
  assert.match(source, /!reduce && !isConnectionConstrained/);
  assert.match(source, /connection\.saveData === true/);
  assert.match(source, /2g/);
  assert.match(view, /doorIntroMode: useVideoIntro \? 'deferred' : 'native'/);
  assert.match(view, /controller\.finishDoorIntro\(\)/);
  assert.match(view, /controller\.playDoorIntro\(\)/);
});

test('service worker neither precaches nor runtime-caches the intro movie', () => {
  const staticAssets = sw.slice(sw.indexOf('const STATIC_ASSETS'), sw.indexOf('self.addEventListener(\'install\''));
  assert.doesNotMatch(staticAssets, /vault-door-intro\.mp4/);
  assert.match(sw, /url\.pathname === '\/video\/vault-door-intro\.mp4'\) return/);
});
