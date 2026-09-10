import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const worker = 'worker/src';
const setsRoute = read(`${worker}/routes/sets.ts`);
const marketSources = read(`${worker}/lib/market-sources.ts`);
const partnerModule = read('public/js/lib/partner-attribution.js');
const serviceWorker = read('public/sw.js');
const dataPartners = read('public/data-partners.html');
const meView = read('public/js/views/me.js');
const methodology = read('public/methodology.html');
const detailView = read('public/js/views/portfolio-detail.js');
const marketView = read('public/js/views/portfolio-detail-market.js');
const portfolioView = read('public/js/views/portfolio.js');
const enLocale = read('public/js/locales/en.js');

describe('PriceCharting partner release (worker payload)', () => {
  it('looks up only verified/manual numeric PriceCharting mappings for set detail', () => {
    assert.match(setsRoute, /pricing_source_map/);
    assert.match(setsRoute, /source='pricecharting'/);
    assert.match(setsRoute, /status IN \('verified','manual'\)/);
    // legacy:* ids are quarantined history — never eligible for a link
    assert.match(setsRoute, /source_item_id NOT LIKE 'legacy:%'/);
    // numeric-only ids (D1 GLOB pattern in the lookup SQL)
    assert.match(setsRoute, /GLOB '\[0-9\]\*'/);
  });

  it('exposes additive attribution fields from enrichSetRecord without touching pricing', () => {
    assert.match(marketSources, /pricecharting_contributes/);
    assert.match(marketSources, /pricecharting_item_id/);
    assert.match(marketSources, /__pricecharting_item_id/);
    // additive only — no weight or algorithm changes
    assert.doesNotMatch(marketSources, /pricecharting_weight|pc_weight/);
  });
});

describe('PriceCharting partner registry (public JS)', () => {
  it('names PriceCharting as the only partner', () => {
    assert.match(partnerModule, /id: 'pricecharting',[\s\S]*?isPartner: true/);
    for (const other of ['bricklink', 'ebay_market', 'brickowl', 'brickeconomy', 'brickset', 'rebrickable', 'stockx']) {
      const block = partnerModule.split(`${other}: {`)[1]?.split('},')[0] ?? '';
      assert.ok(block && !block.includes('isPartner: true'), `${other} must not be a partner`);
    }
  });

  it('never builds a guessed slug or product URL outside the verified numeric id', () => {
    // Code URLs: homepage constant + one templated /game/<verifiedItemId>
    const urlLiterals = [...partnerModule.matchAll(/'https:\/\/www\.pricecharting\.com[^']*'/g)].map(m => m[0]);
    for (const url of urlLiterals) {
      assert.ok(url === "'https://www.pricecharting.com'", `unexpected literal URL: ${url}`);
    }
    // The only /game/ URL is built from the verified id variable, never a literal slug
        assert.match(partnerModule, /game\/\$\{verifiedItemId\}/);
        assert.doesNotMatch(partnerModule, /\/game\/[a-z0-9-]+[a-z]/);
        // digits-only guard in isVerifiedPricechartingId
        assert.match(partnerModule, /\/\^\\d\+\$\/\.test/);
  });

  it('labels the homepage fallback as a homepage, not a product link', () => {
    assert.match(partnerModule, /source homepage/);
    assert.match(partnerModule, /pc-attribution-homepage/);
  });

  it('renders nothing when PriceCharting is not in the valuation basis', () => {
    assert.match(partnerModule, /pricechartingContributes/);
    assert.match(partnerModule, /if \(!pricechartingContributes\(basis\)\) return '';/);
  });
});

describe('Partner page + footer credits', () => {
  it('ships a public data-partners page naming PriceCharting as the sole partner', () => {
    assert.match(dataPartners, /Confirmed data partner/);
    assert.match(dataPartners, /PriceCharting/);
    assert.doesNotMatch(dataPartners, /BrickLink/);
    assert.doesNotMatch(dataPartners, /BrickEconomy/);
    assert.doesNotMatch(dataPartners, /BrickOwl/);
    assert.doesNotMatch(dataPartners, /Brickset/);
    // no logos
    assert.doesNotMatch(dataPartners, /<img/);
  });

  it('links the page from the Me footer and methodology, with only PriceCharting as partner', () => {
    assert.match(meView, /\/data-partners\.html/);
    assert.match(meView, /Market data partner: PriceCharting\. Sources: BrickLink, eBay, BrickOwl, BrickEconomy &amp; Brickset/);
    assert.doesNotMatch(meView, /Pricing from BrickLink, eBay, PriceCharting/);
    assert.match(methodology, /\/data-partners\.html/);
    assert.match(methodology, /Sources, roles and freshness/);
  });

  it('registers the page and module in the service worker with a version bump', () => {
    assert.match(serviceWorker, /'\/data-partners\.html'/);
    assert.match(serviceWorker, /'\/js\/lib\/partner-attribution\.js'/);
    assert.match(serviceWorker, /const VERSION = "v483"/);
  });
});

describe('Honest value + history wording', () => {
  it('credits the used valuation in the real pricing breakdown', () => {
    assert.match(marketView, /pricechartingAttributionHTML\(set, \{ conditionBasis: 'used' \}\)/);
    assert.doesNotMatch(partnerModule, /<div class="pc-attribution/);
  });
  it('labels the 90-day chart as blend snapshots with an i18n note', () => {
    assert.match(detailView, /spark-note-snap/);
    assert.match(enLocale, /historySnapshotNote: 'Daily blend snapshots, not raw per-source feeds'/);
    assert.match(detailView, /t\('market\.historySnapshotNote'\)/);
  });

  it('uses estimated-not-realized wording on the portfolio hero with a source link', () => {
    assert.match(portfolioView, /estimatedNotRealized/);
    assert.match(portfolioView, /data-partners\.html/);
    assert.match(enLocale, /estimatedNotRealized: 'Estimated value — not realized proceeds'/);
  });

  it('keeps attribution English-first in the locale catalogue', () => {
    assert.match(enLocale, /pcAttributionNew: 'New condition valued with PriceCharting'/);
    assert.match(enLocale, /pcAttributionUsed: 'Used condition valued with PriceCharting'/);
  });
});