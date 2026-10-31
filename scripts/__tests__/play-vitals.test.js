import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Pins the fixes for Play Console's "for your next release" warnings
// (release 1.0.55): DEX optimisation, edge-to-edge, large screens.
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const javaDir = 'android/app/src/main/java/app/bricksvault/';

describe('Play Console Android warnings', () => {
  it('keeps R8 optimisation on by ignoring the -dontoptimize consumer rule', () => {
    const gradle = read('android/app/build.gradle');
    assert.match(gradle, /minifyEnabled true/);
    assert.match(gradle, /proguard-android-optimize\.txt/);
    assert.match(gradle, /ignoreFrom\("com\.revenuecat\.purchases:purchases-store-amazon"\)/);
    const rules = read('android/app/proguard-rules.pro');
    assert.doesNotMatch(rules, /^\s*-dont(optimize|shrink|obfuscate)/m);
    assert.match(rules, /^-keep class com\.amazon\.\*\* \{ \*; \}/m);
  });

  it('goes edge-to-edge without the APIs Android 15 deprecated', () => {
    const activity = read(`${javaDir}MainActivity.java`);
    assert.match(activity, /EdgeToEdge\.enable\(this/);
    assert.match(activity, /EdgeToEdgeInsets\.install\(this\)/);
    for (const file of readdirSync(new URL(`../../${javaDir}`, import.meta.url))) {
      const src = read(javaDir + file);
      assert.doesNotMatch(src, /\.set(StatusBar|NavigationBar)Color\(|setNavigationBarDividerColor|setStatusBarContrastEnforced|LAYOUT_IN_DISPLAY_CUTOUT_MODE_(SHORT_EDGES|DEFAULT)/, file);
    }
    const styles = ['values', 'values-night'].map((d) => {
      try { return read(`android/app/src/main/res/${d}/styles.xml`); } catch { return ''; }
    }).join('\n');
    assert.doesNotMatch(styles, /statusBarColor|navigationBarColor|navigationBarDividerColor/);
  });

  it('does not lock orientation or resizability on large screens', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    assert.doesNotMatch(manifest, /android:screenOrientation=/);
    assert.doesNotMatch(manifest, /android:resizeableActivity="false"/);
    assert.match(manifest, /GmsBarcodeScanningDelegateActivity"[\s\S]*?tools:remove="android:screenOrientation"/);
  });
});
