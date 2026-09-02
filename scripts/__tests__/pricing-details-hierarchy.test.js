import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const marketSource = read('public/js/views/portfolio-detail-market.js');
const appStyles = read('public/app.css');
const serviceWorker = read('public/sw.js');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name}() must exist`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`${name}() body must be brace-balanced`);
}

const pricingDetail = extractFunction(marketSource, 'investmentPricingDetailHTML');

describe('pricing details hierarchy', () => {
  it('adds an accessible released-set glance with valuation values but no Buy now', () => {
    assert.match(pricingDetail, /class="pricing-glance" aria-label="Pricing summary"/);
    const glance = pricingDetail.match(/<section class="pricing-glance"[\s\S]*?<\/section>/)?.[0] || '';
    assert.match(glance, />New market</);
    assert.match(glance, />Used</);
    assert.match(glance, />Sell now</);
    assert.match(glance, />Part out</);
    assert.doesNotMatch(glance, /Buy now/);
  });

  it('uses action-oriented framing, semantic ranges, warnings, and decision tiles', () => {
    assert.match(pricingDetail, /Compare the ways this set is valued/);
    assert.match(pricingDetail, /Resale, quick-sale, part-out, and forecast values use different evidence\./);
    assert.match(marketSource, /<dt>Typical range<\/dt>/);
    assert.match(marketSource, /class="pricing-condition-values"/);
    assert.match(marketSource, /class="pricing-warning-row"/);
    assert.match(marketSource, /class="u-sr-only">Data note:<\/span>/);
    assert.ok((pricingDetail.match(/pricing-decision-card/g) || []).length >= 4);
  });

  it('omits unavailable values from the compact glance instead of rendering fake amounts', () => {
    assert.match(pricingDetail, /fairValue > 0 \? `<article class="pricing-glance-item"/);
    assert.match(pricingDetail, /usedValue > 0 \? `<article class="pricing-glance-item"/);
    assert.match(pricingDetail, /liquidation > 0 \? `<article class="pricing-glance-item"/);
    assert.match(pricingDetail, /partOutValue > 0 \? `<article class="pricing-glance-item"/);
    const glance = pricingDetail.match(/<section class="pricing-glance"[\s\S]*?<\/section>/)?.[0] || '';
    assert.doesNotMatch(glance, /:\s*0\s*\}/);
  });

  it('renders the ready forecast from the API base scenario and preserves the history gate', () => {
    assert.match(marketSource, /forecastReady: forecast\.status === 'ready' \|\| forecast\.status === 'external'/);
    assert.match(pricingDetail, /forecastReady && Number\(forecast\.base\) > 0 \? fmtMoney\(forecast\.base\) : 'Not enough history yet'/);
    assert.doesNotMatch(pricingDetail, /forecast\.p50_2y/);
    assert.match(pricingDetail, /forecast\.methodology \|\| 'Unlocks after 180 days and 12 recorded values\.'/);
  });

  it('defines the responsive visual contract and bumps the service worker', () => {
    assert.match(appStyles, /\.pricing-glance\s*\{/);
    assert.match(appStyles, /\.pricing-glance-value[^}]*font-variant-numeric:\s*tabular-nums/s);
    assert.match(appStyles, /\.pricing-decision-card\s*\{/);
    assert.match(appStyles, /\.pricing-decision-card::before[^}]*background:\s*var\(--accent\)/s);
    assert.match(appStyles, /\.pricing-condition-metrics[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
    assert.match(appStyles, /@media\s*\(max-width:\s*430px\)[\s\S]*?\.pricing-decision-grid[^}]*grid-template-columns:\s*1fr/s);
    assert.match(serviceWorker, /const VERSION = "v477"/);
  });
});
