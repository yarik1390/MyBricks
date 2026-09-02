import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, it } from 'node:test';
import { createStackVaultRules } from '../../public/js/components/empty-vault-brick-3d.js';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const portfolio = read('public/js/views/portfolio.js');
const scene = read('public/js/components/empty-vault-brick-3d.js');
const css = read('public/app.css');
const en = read('public/js/locales/en.js');
const localeSources = ['de', 'es', 'fr', 'hi', 'ja', 'nl', 'uk', 'zh'].map((locale) => read(`public/js/locales/${locale}.js`));
const sw = read('public/sw.js');

function emptyVaultTemplate() {
  const match = portfolio.match(/function emptyVaultHTML\(\) \{([\s\S]*?)\n\}/);
  assert.ok(match, 'emptyVaultHTML must remain a focused template');
  return match[1];
}

describe('Stack the Vault mini-game', () => {
  it('uses deterministic bounded rules with a single terminal outcome', () => {
    const rules = createStackVaultRules({ durationMs: 15_000, target: 6 });
    assert.deepEqual(rules.snapshot(), { placed: 0, target: 6, remainingMs: 15_000, outcome: null });
    assert.equal(rules.place(0.49, 1_000).accepted, true);
    assert.equal(rules.place(0.19, 2_000).accepted, false);
    for (let i = 1; i < 6; i += 1) rules.place(0.8, 2_000 + i);
    assert.equal(rules.snapshot().outcome, 'won');
    assert.equal(rules.place(1, 3_000).accepted, false, 'a completed attempt cannot accept more input');

    const paused = createStackVaultRules({ durationMs: 15_000, target: 6 });
    assert.equal(paused.tick(14_999).outcome, null, 'active time just under the limit remains playable');
    assert.equal(paused.tick(15_001).outcome, 'lost', 'only accumulated active time ends the attempt');
  });

  it('keeps the static empty state and explicitly activates the lazy game', () => {
    const template = emptyVaultTemplate();
    assert.match(template, /class="empty-vault-brick-stage"/);
    assert.match(template, /brand-brick-transparent\.png/);
    assert.match(template, /class="empty-vault-brick-3d-trigger"/);
    assert.match(template, /t\('portfolio\.stackVault'\)/);
    assert.match(template, /t\('portfolio\.stackVaultLabel'\)/);
    assert.match(template, /href="#\/add"/);
    assert.match(template, /href="#\/pile"/);
    assert.match(portfolio, /import\(['"]\.\.\/components\/empty-vault-brick-3d\.js['"]\)/);
    assert.doesNotMatch(portfolio, /from ['"].*three/i, 'the Vault route must not eagerly import Three.js');
    assert.match(portfolio, /dataset\.emptyVault3dError/);
    assert.match(portfolio, /classList\.remove\(['"]is-stack-vault-active['"]\)/);
    assert.match(portfolio, /empty-vault-brick-fallback['"]\)\?\.removeAttribute\(['"]hidden['"]\)/);
    assert.match(portfolio, /hideEmptyVaultBrick3d/);
  });

  it('implements one 15-second, six-brick keyboard/touch attempt', () => {
    assert.match(scene, /GAME_DURATION_MS = 15_000/);
    assert.match(scene, /STACK_TARGET = 6/);
    assert.match(scene, /canvas\.addEventListener\(['"]pointerdown['"]/);
    assert.match(scene, /event\.key === ['"]Enter['"] \|\| event\.key === ['"] ['"]/);
    assert.match(scene, /canvas\.setAttribute\(['"]role['"], ['"]application['"]\)/);
    assert.match(scene, /labels\.miss/);
    assert.match(scene, /classList\.add\(['"]is-miss['"]\)/);
    assert.match(scene, /outcome = ['"]won['"]/);
    assert.match(scene, /outcome = ['"]lost['"]/);
    assert.doesNotMatch(scene, /addEventListener\(['"]pointermove['"]/, 'stacking must not conflict with scrolling gestures');
    assert.doesNotMatch(scene, /setInterval/, 'the attempt must use one bounded render loop');
  });

  it('pauses offscreen/hidden and fully disposes when its mount leaves the DOM', () => {
    assert.match(scene, /IntersectionObserver/);
    assert.match(scene, /visibilitychange/);
    assert.match(scene, /MutationObserver/);
    assert.match(scene, /if \(!stage\.isConnected\) controller\.destroy\(\)/);
    assert.match(scene, /cancelAnimationFrame/);
    assert.match(scene, /renderer\.dispose\(\)/);
    assert.match(scene, /geometry\?\.dispose/);
    assert.match(scene, /material\?\.dispose/);
    assert.doesNotMatch(scene, /WEBGL_lose_context/);
  });

  it('uses localized instructions/outcomes with English fallback copy', () => {
    for (const key of ['stackVault', 'stackVaultLabel', 'stackVaultInstructions', 'stackVaultWon', 'stackVaultLost', 'stackVaultProgress', 'stackVaultMiss']) {
      assert.match(en, new RegExp(`${key}:`));
      assert.match(portfolio, new RegExp(`t\\('portfolio\\.${key}'\\)`));
    }
    assert.match(portfolio, /startEmptyVaultBrick3D\(stage, \{/);
    for (const source of localeSources) {
      for (const key of ['stackVault', 'stackVaultLabel', 'stackVaultInstructions', 'stackVaultWon', 'stackVaultLost', 'stackVaultProgress', 'stackVaultMiss']) {
        assert.match(source, new RegExp(`${key}:`));
      }
    }
    assert.doesNotMatch(portfolio, /Drag to rotate|tap to snap/, 'obsolete passive-brick instructions must be removed');
  });

  it('is touch friendly, contained, outcome-visible, and reduced-motion safe', () => {
    assert.match(css, /\.empty-vault-brick-stage\.is-stack-vault-active/);
    assert.match(css, /\.empty-vault-brick-canvas[\s\S]*?touch-action:\s*manipulation/);
    assert.match(css, /data-stack-vault-outcome/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.empty-vault-brick-3d-trigger[\s\S]*?display:\s*none/);
  });

  it('ships Three.js locally and covers all game assets in the service worker', () => {
    const vendor = new URL('public/js/vendor/three-0.185.1.min.js', root);
    assert.equal(existsSync(vendor), true);
    assert.ok(statSync(vendor).size > 300_000);
    assert.match(scene, /import\(['"]\.\.\/vendor\/three-0\.185\.1\.min\.js['"]\)/);
    assert.match(sw, /['"]\/js\/components\/empty-vault-brick-3d\.js['"]/);
    assert.match(sw, /const VERSION = ['"]v480['"]/);
    assert.match(sw, /three-0\.185\.1\.min\.js/);
    assert.ok(
      sw.includes("'/js/vendor/three-0.185.1.min.js'") ||
      (/const STATIC_PREFIX\s*=\s*['"]\/js['"]/.test(sw) && /\$\{STATIC_PREFIX\}\/vendor\/three-0\.185\.1\.min\.js/.test(sw)),
      'the local Three.js module must be represented in STATIC_ASSETS',
    );
  });
});
