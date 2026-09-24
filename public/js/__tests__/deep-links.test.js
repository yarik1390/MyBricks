import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deepLinkHash, scanIntentFromHash } from '../lib/deep-links.js';

describe('deep links', () => {
  it('routes launcher shortcut URLs to their hash routes', () => {
    assert.equal(deepLinkHash('https://bricksvault.app/#/pile?scan=barcode'), '#/pile?scan=barcode');
    assert.equal(deepLinkHash('https://bricksvault.app/#/pile?scan=shelf'), '#/pile?scan=shelf');
    assert.equal(deepLinkHash('https://bricksvault.app/#/wishlist'), '#/wishlist');
    assert.equal(deepLinkHash('https://bricksvault.app/#/set/75192-1/sell'), '#/set/75192-1/sell');
  });

  it('accepts path aliases and the root', () => {
    assert.equal(deepLinkHash('https://bricksvault.app/scan'), '#/pile?scan=barcode');
    assert.equal(deepLinkHash('https://bricksvault.app/shelf/'), '#/pile?scan=shelf');
    assert.equal(deepLinkHash('https://bricksvault.app/Wishlist'), '#/wishlist');
    assert.equal(deepLinkHash('https://bricksvault.app/'), '#/');
    assert.equal(deepLinkHash('app.bricksvault://open/scan'), '#/pile?scan=barcode');
  });

  it('ignores OAuth callbacks, other origins and junk', () => {
    assert.equal(deepLinkHash('https://bricksvault.app/#access_token=abc&type=bearer'), '');
    assert.equal(deepLinkHash('app.bricksvault://auth/callback#error=denied'), '');
    assert.equal(deepLinkHash('https://evil.example/#/wishlist'), '');
    assert.equal(deepLinkHash('http://bricksvault.app/#/wishlist'), '');
    assert.equal(deepLinkHash('https://bricksvault.app/unknown'), '');
    assert.equal(deepLinkHash('not a url'), '');
    assert.equal(deepLinkHash(`https://bricksvault.app/#/${'x'.repeat(400)}`), '');
  });

  it('reads the scanner mode a shortcut asks for', () => {
    assert.equal(scanIntentFromHash('#/pile?scan=barcode'), 'barcode');
    assert.equal(scanIntentFromHash('#/pile?scan=photo'), 'photo');
    assert.equal(scanIntentFromHash('#/pile?scan=shelf'), 'shelf');
    assert.equal(scanIntentFromHash('#/pile?scan=rocket'), null);
    assert.equal(scanIntentFromHash('#/pile'), null);
    assert.equal(scanIntentFromHash('#/add?scan=barcode'), null);
  });
});
