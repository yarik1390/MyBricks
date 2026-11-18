import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { affiliateStoreOf, affiliateStoreUrl } from '../lib/pure.js';

const cfg = {
  web: true,
  android: false,
  ebay_campid: '5339000000',
  templates: {
    lego: 'https://click.linksynergy.com/deeplink?id=SID&mid=13923&murl={url}',
    'lego:FR': 'https://www.awin1.com/cread.php?awinmid=1&awinaffid=2&ued={url}',
  },
};

describe('affiliate store links', () => {
  it('recognises the stores it can tag', () => {
    assert.equal(affiliateStoreOf('https://www.lego.com/fr-fr/product/10316'), 'lego');
    assert.equal(affiliateStoreOf('https://www.ebay.co.uk/sch/i.html?_nkw=x'), 'ebay');
    assert.equal(affiliateStoreOf('https://www.walmart.com/search?q=x'), 'walmart');
    assert.equal(affiliateStoreOf('https://example.com/'), null);
    assert.equal(affiliateStoreOf('not a url'), null);
  });

  it('leaves links alone when nothing is set up or the platform is off', () => {
    const url = 'https://www.lego.com/en-us/product/10316';
    assert.deepEqual(affiliateStoreUrl(url, 'US', null), { url, tagged: false });
    assert.deepEqual(affiliateStoreUrl(url, 'US', cfg, 'android'), { url, tagged: false });
    assert.deepEqual(affiliateStoreUrl('https://www.target.com/s?searchTerm=x', 'US', cfg), { url: 'https://www.target.com/s?searchTerm=x', tagged: false });
  });

  it('wraps a store link in its deep-link template, country first', () => {
    const us = affiliateStoreUrl('https://www.lego.com/en-us/product/10316', 'US', cfg);
    assert.equal(us.tagged, true);
    assert.equal(us.url, 'https://click.linksynergy.com/deeplink?id=SID&mid=13923&murl=https%3A%2F%2Fwww.lego.com%2Fen-us%2Fproduct%2F10316');
    const fr = affiliateStoreUrl('https://www.lego.com/fr-fr/product/10316', 'fr', cfg);
    assert.match(fr.url, /^https:\/\/www\.awin1\.com\/cread\.php\?awinmid=1&awinaffid=2&ued=https%3A%2F%2Fwww\.lego\.com%2Ffr-fr/);
  });

  it('adds eBay Partner Network parameters for the local eBay site', () => {
    const r = affiliateStoreUrl('https://www.ebay.fr/sch/i.html?_nkw=LEGO%2010316', 'FR', cfg);
    assert.equal(r.tagged, true);
    const u = new URL(r.url);
    assert.equal(u.searchParams.get('_nkw'), 'LEGO 10316');
    assert.equal(u.searchParams.get('campid'), '5339000000');
    assert.equal(u.searchParams.get('mkrid'), '709-53476-19255-0');
    assert.equal(u.searchParams.get('mkcid'), '1');
    assert.equal(u.searchParams.get('toolid'), '10001');
    assert.equal(u.searchParams.get('mkevt'), '1');
  });
});
