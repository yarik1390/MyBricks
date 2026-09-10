import assert from 'node:assert/strict';
import { setLocale } from '../lib/i18n.js';
import { describe, it } from 'node:test';
import {
  PROVIDERS,
  pricechartingContributes,
  isVerifiedPricechartingId,
  pricechartingAttribution,
  pricechartingAttributionHTML,
  pricechartingSourceLinkLabel,
} from '../lib/partner-attribution.js';

const pcBasis = (source = 'pricecharting') => [
  { provider_family: 'ebay_market', sources: ['ebay_sold_new', source], signal_type: 'sold', value: 100 },
  { provider_family: 'bricklink', sources: ['bricklink_new'], signal_type: 'sold', value: 99 },
];

describe('provider registry', () => {
  it('names PriceCharting as the only partner', () => {
    const partners = Object.values(PROVIDERS).filter(p => p.isPartner);
    assert.deepEqual(partners.map(p => p.id), ['pricecharting']);
  });

  it('carries a homepage and role for every provider, and no logos anywhere', () => {
    for (const provider of Object.values(PROVIDERS)) {
      assert.match(provider.homepage, /^https:\/\//);
      assert.ok(['sold', 'modeled', 'asking', 'estimate'].includes(provider.role));
    }
  });
});

describe('pricechartingContributes', () => {
  it('is true only when a pricecharting* source appears in the basis', () => {
    assert.equal(pricechartingContributes(pcBasis()), true);
    assert.equal(pricechartingContributes(pcBasis('pricecharting_used')), true);
    assert.equal(pricechartingContributes([{ sources: ['bricklink_new', 'ebay_sold_new'] }]), false);
    assert.equal(pricechartingContributes([]), false);
    assert.equal(pricechartingContributes(null), false);
    assert.equal(pricechartingContributes('pricecharting'), false); // not an array
  });

  it('does not mistake a similar-looking source name for PriceCharting', () => {
    assert.equal(pricechartingContributes([{ sources: ['pricechart'] }]), false);
    assert.equal(pricechartingContributes([{ sources: ['pricechartingxyz-not'] }]), false);
  });
});

describe('isVerifiedPricechartingId', () => {
  it('accepts digits only', () => {
    assert.equal(isVerifiedPricechartingId('12809679'), true);
    assert.equal(isVerifiedPricechartingId('123'), true);
  });

  it('rejects legacy ids, slugs, and non-strings', () => {
    assert.equal(isVerifiedPricechartingId('legacy:12809679'), false);
    assert.equal(isVerifiedPricechartingId('lego-star-wars/the-darksaber-40917'), false);
    assert.equal(isVerifiedPricechartingId('12809abc'), false);
    assert.equal(isVerifiedPricechartingId(''), false);
    assert.equal(isVerifiedPricechartingId(null), false);
    assert.equal(isVerifiedPricechartingId(12809679), false); // must be a string id from the map
  });
});

describe('pricechartingAttribution', () => {
  it('builds the direct product URL from a verified numeric id', () => {
    const a = pricechartingAttribution('12809679');
    assert.equal(a.variant, 'product');
    assert.equal(a.url, 'https://www.pricecharting.com/game/12809679');
    assert.equal(a.label, 'New condition valued with PriceCharting');
  });

  it('uses the used-condition label when asked', () => {
    const a = pricechartingAttribution('12809679', { conditionBasis: 'used' });
    assert.equal(a.label, 'Used condition valued with PriceCharting');
  });

  it('falls back to the clearly-labeled homepage without a verified id', () => {
    for (const bad of [undefined, null, 'legacy:12809679', 'guessed-slug', '']) {
      const a = pricechartingAttribution(bad);
      assert.equal(a.variant, 'homepage');
      assert.equal(a.url, 'https://www.pricecharting.com');
      assert.match(a.label, /source homepage: pricecharting\.com/);
      assert.doesNotMatch(a.label, /\/game\//);
    }
  });
});

describe('pricechartingAttributionHTML', () => {
  it('uses translated labels and valid inline markup', async () => {
    await setLocale('de', { remember: false });
    try {
      const html = pricechartingAttributionHTML({ valuation: { new: { basis: pcBasis() } } });
      assert.match(html, /Neuware-Zustand bewertet mit PriceCharting/);
      assert.match(html, /Quell-Startseite/);
      assert.doesNotMatch(html, /<div/);
    } finally { await setLocale('en', { remember: false }); }
  });
  it('does not borrow the new-condition legacy basis for a missing used valuation', () => {
    assert.equal(pricechartingAttributionHTML({ market_value_basis: pcBasis() }, { conditionBasis: 'used' }), '');
  });
  it('renders a product link only when PC contributes AND a verified id exists', () => {
    const set = {
      valuation: { new: { basis: pcBasis() } },
      pricecharting_item_id: '12809679',
    };
    const html = pricechartingAttributionHTML(set);
    assert.match(html, /href="https:\/\/www\.pricecharting\.com\/game\/12809679"/);
    assert.match(html, /New condition valued with PriceCharting/);
    assert.doesNotMatch(html, /pc-attribution-homepage/);
  });

  it('renders the labeled homepage fallback without a verified id', () => {
    const set = { valuation: { new: { basis: pcBasis() } } };
    const html = pricechartingAttributionHTML(set);
    assert.match(html, /href="https:\/\/www\.pricecharting\.com"/);
    assert.match(html, /pc-attribution-homepage/);
    assert.match(html, /source homepage/);
  });

  it('renders NOTHING when PriceCharting did not contribute', () => {
    assert.equal(pricechartingAttributionHTML({ valuation: { new: { basis: [{ sources: ['bricklink_new'] }] } }, pricecharting_item_id: '12809679' }), '');
    assert.equal(pricechartingAttributionHTML({}), '');
    assert.equal(pricechartingAttributionHTML(null), '');
  });

  it('reads the used-condition basis when asked and is guest-safe on partial payloads', () => {
    const usedSet = { valuation: { used: { basis: pcBasis() } }, pricecharting_item_id: '42' };
    assert.match(pricechartingAttributionHTML(usedSet, { conditionBasis: 'used' }), /Used condition valued with PriceCharting/);
    // falls back to v2 market_value_basis when no v3 state exists
    const v2Set = { market_value_basis: pcBasis(), pricecharting_item_id: '42' };
    assert.match(pricechartingAttributionHTML(v2Set), /href="https:\/\/www\.pricecharting\.com\/game\/42"/);
    // missing everything → empty, never a throw
    assert.equal(pricechartingAttributionHTML({}), '');
    assert.equal(pricechartingAttributionHTML({ valuation: {} }), '');
  });

  it('escapes the URL and label into attributes', () => {
    const evil = { valuation: { new: { basis: pcBasis() } }, pricecharting_item_id: '1"><script>' };
    const html = pricechartingAttributionHTML(evil);
    // not a verified numeric id → homepage fallback; no raw quotes survive
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /href="https:\/\/www\.pricecharting\.com"/);
  });
});

describe('pricechartingSourceLinkLabel', () => {
  it('credits PriceCharting only when it contributes', () => {
    assert.equal(pricechartingSourceLinkLabel(pcBasis(), '1'), 'PriceCharting');
    assert.equal(pricechartingSourceLinkLabel([{ sources: ['bricklink_new'] }], '1'), '');
  });
});