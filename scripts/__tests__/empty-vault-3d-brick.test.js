import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, it } from 'node:test';
import { createCrackVaultRules } from '../../public/js/components/empty-vault-brick-3d.js';

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

describe('Crack the Brickvault mini-game', () => {
  it('runs three deterministic memory rounds and retries mistakes without ending the attempt', () => {
    const sequences = [[0, 2], [3, 1, 0], [1, 3, 2, 0]];
    const rules = createCrackVaultRules({ sequences });
    assert.deepEqual(rules.snapshot(), { round: 0, totalRounds: 3, phase: 'presenting', expectedIndex: 0, outcome: null });
    assert.equal(rules.press(0).accepted, false, 'input stays locked during sequence playback');

    rules.ready();
    assert.equal(rules.press(0).correct, true);
    assert.equal(rules.press(1).correct, false, 'a wrong stud provides feedback');
    assert.deepEqual(rules.snapshot(), { round: 0, totalRounds: 3, phase: 'presenting', expectedIndex: 0, outcome: null });

    for (const sequence of sequences) {
      rules.ready();
      for (const stud of sequence) assert.equal(rules.press(stud).correct, true);
    }
    assert.equal(rules.snapshot().outcome, 'unlocked');
    assert.equal(rules.press(0).accepted, false, 'an unlocked vault cannot accept more input');
  });

  it('keeps the static empty state and explicitly activates the lazy game', () => {
    const template = emptyVaultTemplate();
    assert.match(template, /class="empty-vault-brick-stage"/);
    assert.match(template, /brand-brick-transparent\.png/);
    assert.match(template, /class="empty-vault-brick-3d-trigger"/);
    assert.match(template, /t\('portfolio\.crackVault'\)/);
    assert.match(template, /t\('portfolio\.crackVaultLabel'\)/);
    assert.match(template, /href="#\/add"/);
    assert.match(template, /href="#\/pile"/);
    assert.match(portfolio, /import\(['"]\.\.\/components\/empty-vault-brick-3d\.js['"]\)/);
    assert.doesNotMatch(portfolio, /from ['"].*three/i, 'the Vault route must not eagerly import Three.js');
    assert.match(portfolio, /dataset\.emptyVault3dError/);
    assert.match(portfolio, /classList\.remove\(['"]is-crack-vault-active['"]\)/);
    assert.match(portfolio, /empty-vault-brick-fallback['"]\)\?\.removeAttribute\(['"]hidden['"]\)/);
    assert.match(portfolio, /hideEmptyVaultBrick3d/);
  });

  it('uses four accessible HTML stud controls and bounded 3D presentation', () => {
    assert.match(scene, /crack-vault-studs/);
    assert.match(scene, /document\.createElement\(['"]button['"]\)/);
    assert.match(scene, /aria-label/);
    assert.match(scene, /ArrowLeft|ArrowRight/);
    assert.match(scene, /labels\.wrong/);
    assert.match(scene, /crack-vault-reward/);
    assert.match(scene, /labels\.replay/);
    assert.match(scene, /outcome = ['"]unlocked['"]/);
    assert.doesNotMatch(scene, /canvas\.addEventListener\(['"]pointerdown['"]/, 'game input belongs to accessible HTML controls');
    assert.doesNotMatch(scene, /addEventListener\(['"]pointermove['"]/, 'memory input must not conflict with scrolling gestures');
    assert.doesNotMatch(scene, /setInterval/, 'presentation must use bounded timers and animations');
  });

  it('pauses offscreen/hidden and fully disposes when its mount leaves the DOM', () => {
    assert.match(scene, /IntersectionObserver/);
    assert.match(scene, /visibilitychange/);
    assert.match(scene, /MutationObserver/);
    assert.match(scene, /if \(!stage\.isConnected\) controller\.destroy\(\)/);
    assert.match(scene, /cancelAnimationFrame/);
    assert.match(scene, /waitUntilVisible/);
    assert.match(scene, /waitVisibleDuration/);
    assert.match(scene, /remaining\s*-=\s*Math\.max\(0, performance\.now\(\) - startedAt\)/, 'sequence waits must count visible time only');
    assert.doesNotMatch(scene, /while \([^\n]+document\.hidden[^\n]+\) await wait\(/, 'hidden state must not poll timers');
    assert.match(scene, /unlockElapsed\s*\+=\s*Math\.max\(0, now - unlockLastFrame\)/, 'unlock animation must resume from visible elapsed time');
    assert.doesNotMatch(scene, /\(now - started\) \/ 700/, 'unlock animation must not jump after a hidden interval');
    assert.match(scene, /renderer\.dispose\(\)/);
    assert.match(scene, /geometry\?\.dispose/);
    assert.match(scene, /material\?\.dispose/);
    assert.doesNotMatch(scene, /WEBGL_lose_context/);
  });

  it('uses localized instructions, rounds, feedback, and unlocked copy', () => {
    const keys = ['crackVault', 'crackVaultLabel', 'crackVaultInstructions', 'crackVaultWatch', 'crackVaultRepeat', 'crackVaultProgress', 'crackVaultWrong', 'crackVaultUnlocked', 'crackVaultStud', 'crackVaultReward', 'crackVaultReplay'];
    for (const key of keys) {
      assert.match(en, new RegExp(`${key}:`));
      assert.match(portfolio, new RegExp(`t\\('portfolio\\.${key}'`));
    }
    assert.match(portfolio, /startEmptyVaultBrick3D\(stage, \{/);
    for (const source of localeSources) {
      for (const key of keys) assert.match(source, new RegExp(`${key}:`));
    }
    assert.doesNotMatch(portfolio, /stackVault|Stack the Vault|Drag to rotate|tap to snap/);
    assert.doesNotMatch(portfolio, /window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches\s*\|\|/, 'reduced motion must not hide the explicit game trigger');
  });

  it('is touch friendly, contained, outcome-visible, and reduced-motion safe', () => {
    assert.match(css, /\.empty-vault-brick-stage\.is-crack-vault-active/);
    assert.match(css, /\.crack-vault-stud[\s\S]*?min-width:\s*44px/);
    assert.match(css, /\.crack-vault-stud[\s\S]*?min-height:\s*44px/);
    assert.match(css, /data-crack-vault-outcome/);
    assert.match(scene, /const reducedMotion = window\.matchMedia/);
    assert.doesNotMatch(scene, /if \(window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches\) return \{ ok: false/);
    assert.match(scene, /if \(reducedMotion\) \{[\s\S]*?hinge\.rotation\.y/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.crack-vault-reward[\s\S]*?animation:\s*none/);
  });

  it('ships Three.js locally and covers all game assets in the service worker', () => {
    const vendor = new URL('public/js/vendor/three-0.185.1.min.js', root);
    assert.equal(existsSync(vendor), true);
    assert.ok(statSync(vendor).size > 300_000);
    assert.match(scene, /import\(['"]\.\.\/vendor\/three-0\.185\.1\.min\.js['"]\)/);
    assert.match(sw, /['"]\/js\/components\/empty-vault-brick-3d\.js['"]/);
    assert.match(sw, /const VERSION = ['"]v481['"]/);
    assert.match(sw, /three-0\.185\.1\.min\.js/);
    assert.ok(
      sw.includes("'/js/vendor/three-0.185.1.min.js'") ||
      (/const STATIC_PREFIX\s*=\s*['"]\/js['"]/.test(sw) && /\$\{STATIC_PREFIX\}\/vendor\/three-0\.185\.1\.min\.js/.test(sw)),
      'the local Three.js module must be represented in STATIC_ASSETS',
    );
  });
});
