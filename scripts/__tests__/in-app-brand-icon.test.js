import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const portfolio = readFileSync(new URL('../../public/js/views/portfolio.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../public/app.css', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
const renderer = readFileSync(new URL('../render-brick-icons.py', import.meta.url), 'utf8');

function pngInfo(path) {
  const data = readFileSync(new URL(path, import.meta.url));
  assert.equal(data.toString('ascii', 1, 4), 'PNG');
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    colorType: data[25],
  };
}

describe('in-app Brickvault brand icon', () => {
  it('uses a dedicated transparent orange brick in the vault header', () => {
    assert.match(
      portfolio,
      /<img class="brand-mark" src="\/brand-brick-transparent\.png" alt="" width="36" height="36" aria-hidden="true">/,
    );
    assert.deepEqual(pngInfo('../../public/brand-brick-transparent.png'), {
      width: 192,
      height: 192,
      colorType: 6,
    });
    assert.match(renderer, /brand-brick-transparent\.png/);
    assert.doesNotMatch(portfolio, /<div class="brand-mark"><\/div>/);
  });

  it('lets the 3D brick float without an app-icon frame', () => {
    const brandRule = css.match(/^\.brand-mark \{([^}]*)\}/m)?.[1] ?? '';
    assert.match(brandRule, /object-fit:\s*contain;/);
    assert.doesNotMatch(brandRule, /border:/);
    assert.doesNotMatch(brandRule, /border-radius:/);
    assert.doesNotMatch(css, /\.brand-mark::before,\s*\.brand-mark::after/);
  });

  it('bumps the static cache for the changed in-app module and artwork', () => {
    assert.match(sw, /const VERSION = "v482";/);
    assert.match(sw, /'\/js\/views\/portfolio\.js'/);
    assert.match(sw, /'\/brand-brick-transparent\.png'/);
  });
});
