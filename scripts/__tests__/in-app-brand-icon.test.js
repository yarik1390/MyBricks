import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const portfolio = readFileSync(new URL('../../public/js/views/portfolio.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../public/app.css', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

describe('in-app Brickvault brand icon', () => {
  it('uses the approved orange brick artwork in the vault header', () => {
    assert.match(
      portfolio,
      /<img class="brand-mark" src="\/icon-192\.png" alt="" width="30" height="30" aria-hidden="true">/,
    );
    assert.doesNotMatch(portfolio, /<div class="brand-mark"><\/div>/);
  });

  it('renders as an image rather than the old CSS-drawn two-stud mark', () => {
    assert.match(css, /\.brand-mark\s*\{[^}]*object-fit:\s*cover;/s);
    assert.doesNotMatch(css, /\.brand-mark::before,\s*\.brand-mark::after/);
  });

  it('bumps the static cache for the changed in-app module and CSS', () => {
    assert.match(sw, /const VERSION = "v476";/);
    assert.match(sw, /'\/js\/views\/portfolio\.js'/);
    assert.match(sw, /'\/icon-192\.png'/);
  });
});
