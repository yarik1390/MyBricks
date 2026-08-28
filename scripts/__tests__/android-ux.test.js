import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('bounded Android UX configuration', () => {
  it('verifies the canonical App Link while preserving the auth custom scheme', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    assert.match(manifest, /android:autoVerify="true"[\s\S]*android:scheme="https"[\s\S]*android:host="bricksvault\.app"/);
    assert.match(manifest, /android:scheme="@string\/custom_url_scheme"[\s\S]*android:host="auth"[\s\S]*android:path="\/callback"/);
    assert.doesNotMatch(manifest, /android:host="brickvault-5ub\.pages\.dev"/);
  });

  it('boots system bars from the day/night splash resource and retains native sync/privacy', () => {
    const activity = read('android/app/src/main/java/app/bricksvault/MainActivity.java');
    const nightColors = read('android/app/src/main/res/values-night/colors.xml');
    assert.match(activity, /UI_MODE_NIGHT_MASK/);
    assert.match(activity, /R\.color\.brickvault_splash_background/);
    assert.match(activity, /setAppearanceLightStatusBars\(!isNightMode\)/);
    assert.match(activity, /setAppearanceLightNavigationBars\(!isNightMode\)/);
    assert.match(activity, /registerPlugin\(SystemBarsPlugin\.class\)/);
    assert.match(activity, /FLAG_SECURE/);
    assert.match(nightColors, /brickvault_splash_background">#16161C/);
  });
});

describe('scanner and haptic recovery hooks', () => {
  it('announces scanner hints and gives failures retry/manual-entry recovery', () => {
    const scanner = read('public/js/components/scanner.js');
    assert.match(scanner, /id="scanHint" role="status" aria-live="polite"/);
    assert.ok(scanner.includes("Scanner couldn't start. Try again or enter the barcode or set number manually."));
    assert.match(scanner, /if \(scanError\)[\s\S]*ensureNativeRescanButton\(\);[\s\S]*showManualBarcodeEntry\(\);/);
  });

  it('registers Haptics before falling back to the legacy registry', () => {
    const utils = read('public/js/utils.js');
    const registration = utils.indexOf('registerPlugin?.("Haptics")');
    const legacy = utils.indexOf('Plugins?.Haptics', registration);
    assert.ok(registration >= 0, 'expected Capacitor.registerPlugin Haptics fallback');
    assert.ok(legacy > registration, 'expected legacy Plugins lookup after registerPlugin');
    assert.match(utils, /navigator\.vibrate/);
  });
});
