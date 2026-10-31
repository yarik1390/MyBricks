import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const LOCALES = ['en', 'de', 'es', 'fr', 'hi', 'ja', 'nl', 'uk', 'zh'];
const KEYS = ['showPassword', 'hidePassword', 'rateApp', 'rateAppSub', 'rateAppFailed', 'shareApp', 'shareAppSub', 'shareAppText', 'shareAppCopied', 'shareAppFailed'];

describe('tester feedback: password eye, rate and share', () => {
  it('installs the password eye at boot and skips numeric Kids PINs', () => {
    const app = read('public/js/app.js');
    const toggle = read('public/js/lib/password-toggle.js');
    assert.match(app, /installPasswordToggles\(\)/);
    assert.match(toggle, /inputmode'\) === 'numeric'/);
    assert.match(toggle, /aria-pressed/);
    assert.match(read('public/bv.css'), /\.bv-pw-toggle \{[\s\S]*width: 44px; height: 44px/);
  });

  it('adds Rate (app only) and Share rows to Profile > Help', () => {
    const me = read('public/js/views/me.js');
    assert.match(me, /canRateApp\(\) \? row\(\{ icon: 'star', title: t\('bvAccount\.rateApp'\)/);
    assert.match(me, /id: 'shareAppRow'/);
  });

  it('registers the native AppReview plugin with the Play review library', () => {
    assert.match(read('android/app/src/main/java/app/bricksvault/MainActivity.java'), /registerPlugin\(AppReviewPlugin\.class\)/);
    assert.match(read('android/app/build.gradle'), /com\.google\.android\.play:review:/);
    const plugin = read('android/app/src/main/java/app/bricksvault/AppReviewPlugin.java');
    assert.match(plugin, /@CapacitorPlugin\(name = "AppReview"\)/);
    assert.match(plugin, /market:\/\/details\?id=/);
  });

  it('asks for an in-app review only from the milestone path, once', () => {
    const rs = read('public/js/lib/rate-share.js');
    assert.match(rs, /Number\(count\) >= 10/);
    assert.match(rs, /bv_review_asked_v1/);
    assert.match(read('public/js/views/portfolio-detail.js'), /maybeAskForReview\(curCount\)/);
  });

  it('translates every new string in all locales', () => {
    for (const loc of LOCALES) {
      const src = read(`public/js/locales/${loc}.js`);
      for (const k of KEYS) assert.match(src, new RegExp(`\\n\\s*${k}: "`), `${loc}.${k}`);
    }
  });

  it('precaches the new modules', () => {
    const sw = read('public/sw.js');
    assert.match(sw, /'\/js\/lib\/password-toggle\.js'/);
    assert.match(sw, /'\/js\/lib\/rate-share\.js'/);
  });
});
