import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, it } from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const portfolio = read('public/js/views/portfolio.js');
const scene = read('public/js/components/empty-vault-brick-3d.js');
const css = read('public/app.css');
const sw = read('public/sw.js');

function emptyVaultTemplate() {
  const match = portfolio.match(/function emptyVaultHTML\(\) \{([\s\S]*?)\n\}/);
  assert.ok(match, 'emptyVaultHTML must remain a focused template');
  return match[1];
}

describe('opt-in empty Vault 3D brick', () => {
  it('starts as an accessible static image and offers explicit 3D activation', () => {
    const template = emptyVaultTemplate();
    assert.match(template, /class="empty-vault-brick-stage"/);
    assert.match(template, /brand-brick-transparent\.png/);
    assert.match(template, /class="empty-vault-brick-3d-trigger"/);
    assert.match(template, /t\('portfolio\.exploreBrick3d'\)/);
    assert.match(template, /t\('portfolio\.exploreBrick3dLabel'\)/);
    assert.doesNotMatch(portfolio, /from ['"].*three/i, 'the Vault route must not eagerly import Three.js');
  });

  it('loads the scene only after activation and preserves a fallback on failure', () => {
    assert.match(portfolio, /import\(['"]\.\.\/components\/empty-vault-brick-3d\.js['"]\)/);
    assert.match(portfolio, /dataset\.emptyVault3dError/);
    assert.match(portfolio, /if \(controller\) \{[\s\S]*?trigger\.hidden = true;/);
    assert.match(portfolio, /hideEmptyVaultBrick3d/);
    assert.match(portfolio, /list\.innerHTML = emptyVaultHTML\(\);\n\s+wireEmptyVaultBrick3D\(\);\n\s+if \(state\._portfolioObserver\)/);
    assert.match(portfolio, /matchMedia\(['"]\(prefers-reduced-motion: reduce\)['"]\)/);
    assert.match(scene, /canvas\.remove\(\);[\s\S]*?throw error;/);
    assert.match(scene, /canvas\.tabIndex = 0/);
    assert.match(scene, /canvas\.setAttribute\(['"]role['"], ['"]button['"]\)/);
    assert.match(scene, /keydown/);
    assert.match(scene, /event\.key === ['"]Enter['"] \|\| event\.key === ['"] ['"]/);
    assert.match(scene, /import\(['"]\.\.\/vendor\/three-0\.185\.1\.min\.js['"]\)/);
    assert.match(scene, /prefers-reduced-motion: reduce/);
    assert.match(scene, /deviceMemory/);
    assert.match(scene, /WebGLRenderingContext/);
    assert.doesNotMatch(scene, /WEBGL_lose_context/, 'capability detection must not destabilize the renderer context');
    assert.match(scene, /WebGLRenderer/);
    assert.match(scene, /IntersectionObserver/);
    assert.match(scene, /visibilitychange/);
    assert.match(scene, /renderer\.dispose\(\)/);
    assert.match(scene, /requestAnimationFrame/);
    assert.match(scene, /needsAnotherFrame/);
    assert.doesNotMatch(scene, /rotation\.y \+= velocityX \+/, 'the scene must not spin continuously when idle');
    assert.match(scene, /cancelAnimationFrame/);
  });

  it('keeps controls touch-sized and exposes reduced-motion behavior', () => {
    assert.match(css, /\.empty-vault-brick-canvas[\s\S]*?touch-action:\s*none/);
    assert.match(css, /\.empty-vault-brick-canvas:focus-visible[\s\S]*?outline:/);
    assert.match(css, /\.empty-vault-brick-3d-trigger[\s\S]*?min-height:\s*44px/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.empty-vault-brick-stage/);
  });

  it('vendors a bounded licensed Three.js module without precaching it', () => {
    const modulePath = new URL('public/js/vendor/three-0.185.1.min.js', root);
    const corePath = new URL('public/js/vendor/three.core.min.js', root);
    const licensePath = new URL('public/js/vendor/THREE-LICENSE.txt', root);
    assert.equal(existsSync(modulePath), true);
    assert.equal(existsSync(corePath), true, 'Three.js module imports its sibling core module');
    assert.equal(existsSync(licensePath), true);
    const totalBytes = statSync(modulePath).size + statSync(corePath).size;
    assert.ok(totalBytes < 800_000, 'the complete on-demand Three.js payload must stay bounded');
    assert.match(read('public/js/vendor/THREE-LICENSE.txt'), /MIT License/);
    assert.doesNotMatch(sw, /['"]\/js\/vendor\/three-0\.185\.1\.min\.js['"]/, 'Three.js must not inflate the install cache');
    assert.doesNotMatch(sw, /['"]\/js\/vendor\/three\.core\.min\.js['"]/, 'the Three.js core chunk must also stay out of the install cache');
    assert.match(sw, /const VERSION = "v478"/);
  });
});
