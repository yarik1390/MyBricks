import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const removedViewerFiles = [
  'public/js/__tests__/set-3d-viewer.test.js',
  'public/js/components/set-3d-viewer-lifecycle.js',
  'public/js/components/set-3d-viewer.js',
  'public/js/vendor/OrbitControls.js',
  'public/js/vendor/three.module.js',
];

test('set detail has no generic 3D viewer affordance or implementation', () => {
  const detailSource = read('public/js/views/portfolio-detail.js');
  const appStyles = read('public/app.css');
  const serviceWorker = read('public/sw.js');
  const packageJson = JSON.parse(read('package.json'));

  assert.doesNotMatch(detailSource, /detail3d|set3d|set-3d|3D preview/i);
  assert.doesNotMatch(appStyles, /detail-3d|set-3d/i);
  assert.doesNotMatch(serviceWorker, /set-3d-viewer|three\.module|OrbitControls/i);
  assert.equal(packageJson.dependencies?.three, undefined);

  for (const path of removedViewerFiles) {
    assert.equal(existsSync(new URL(`../../${path}`, import.meta.url)), false, `${path} should be removed`);
  }
});
