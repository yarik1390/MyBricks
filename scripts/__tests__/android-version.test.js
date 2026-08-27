import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ANDROID_VERSION_FLOOR, effectiveVersionCode } from '../android-version.mjs';

describe('Android versionCode', () => {
  it('never drops below the persisted Play floor', () => {
    assert.equal(effectiveVersionCode(100, 1140), 1140);
    assert.equal(effectiveVersionCode(1139, 1140), 1140);
  });

  it('continues increasing after the commit count passes the floor', () => {
    assert.equal(effectiveVersionCode(1141, 1140), 1141);
    assert.equal(effectiveVersionCode(1200, 1140), 1200);
  });

  it('uses a floor above the last uploaded Play code', () => {
    assert.ok(ANDROID_VERSION_FLOOR > 1139);
  });
});
