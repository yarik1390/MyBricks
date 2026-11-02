import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { versionNameFromSw } from '../android-version.mjs';

const gradle = readFileSync(new URL('../../android/app/build.gradle', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../../.github/workflows/build-android.yml', import.meta.url), 'utf8');

describe('Android versionName', () => {
  it('derives from the web version in public/sw.js', () => {
    assert.equal(versionNameFromSw('const VERSION = "v625";'), '1.0.625');
    const sw = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
    assert.match(versionNameFromSw(sw), /^1\.0\.\d+$/);
  });

  it('is never a hand-bumped literal in build.gradle', () => {
    assert.match(gradle, /versionName\s+derivedVersionName/);
    assert.doesNotMatch(gradle, /versionName\s+"/);
  });

  it('CI exports ANDROID_VERSION_NAME from sw.js', () => {
    assert.match(workflow, /ANDROID_VERSION_NAME=1\.0\.\$\{WEB\}/);
  });
});
