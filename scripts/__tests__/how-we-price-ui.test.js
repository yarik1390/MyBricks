import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const methodology = read('public/methodology.html');
const appStyles = read('public/app.css');
const methodologyComponent = read('public/js/components/methodology.js');
const serviceWorker = read('public/sw.js');

describe('How we price UI upgrade', () => {
  it('preserves the methodology promises and evidence rules', () => {
    assert.match(methodology, /<h2>Independent sources, counted honestly<\/h2>/);
    assert.match(methodology, /Sold prices are facts; asking prices are wishes/);
    assert.match(methodology, /No invented numbers: a set without enough verified evidence/);
  });

  it('adds scannable numbered hierarchy and evidence cards without changing semantics', () => {
    assert.match(methodology, /main > h2::before/);
    assert.match(methodology, /main > h2:nth-of-type\(1\)::before \{ content:'01'; \}/);
    assert.match(methodology, /main > h2:first-of-type \+ ol \{[\s\S]*grid-template-columns:repeat\(5/);
    assert.match(methodology, /main > h2:nth-of-type\(9\) \+ ul \{[\s\S]*grid-template-columns:repeat\(3/);
  });

  it('defines every standalone visual token used by the redesign', () => {
    const rootTokens = methodology.match(/:root \{([^}]*)\}/)?.[1] ?? '';
    for (const token of ['--surface', '--shadow', '--accent-soft']) {
      assert.match(rootTokens, new RegExp(`${token}:`), `${token} must be defined in methodology.html`);
    }
  });

  it('keeps the confidence table semantic and overflow-safe', () => {
    assert.match(methodology, /main > h2:nth-of-type\(6\) \+ table \{[\s\S]*overflow-x:auto/);
    assert.match(methodology, /<th>Badge<\/th>/);
    assert.match(methodology, /class="tier high">Reliable price<\/span>/);
    assert.match(methodology, /class="tier med">Good estimate<\/span>/);
    assert.match(methodology, /class="tier low">Low confidence \/ Estimated<\/span>/);
  });

  it('uses readable touch targets and a single-column mobile fallback', () => {
    assert.match(methodology, /\.back \{[\s\S]*min-height:44px/);
    assert.match(methodology, /a:focus-visible \{ outline:3px solid var\(--accent\)/);
    assert.match(methodology, /@media \(max-width:600px\)[\s\S]*main > h2:first-of-type \+ ol,[\s\S]*grid-template-columns:1fr/);
  });

  it('upgrades the in-app sheet with the same hierarchy and safe confidence scrolling', () => {
    assert.match(appStyles, /\.methodology-sheet h2::before/);
    assert.match(appStyles, /\.methodology-sheet h2:first-of-type \+ ol\s*\{[\s\S]*grid-template-columns: ?repeat\(5/);
    assert.match(appStyles, /\.methodology-sheet h2:nth-of-type\(6\) \+ table\s*\{[\s\S]*overflow-x: ?auto/);
    assert.match(appStyles, /@media \(max-width: 430px\)[\s\S]*\.methodology-sheet h2:first-of-type \+ ol,[\s\S]*\.methodology-sheet h2:last-of-type \+ ul[\s\S]*grid-template-columns: 1fr/);
  });

  it('preserves loading, close, fallback, and route-safe sheet behavior', () => {
    assert.match(methodologyComponent, /role="status"/);
    assert.match(methodologyComponent, /id="methodologySheetClose"/);
    assert.match(methodologyComponent, /methodology\.html/);
    assert.match(methodologyComponent, /<article class="methodology-sheet">\$\{html\}<\/article>/);
    assert.match(methodologyComponent, /window\.location\.href = '\/methodology\.html'/);
    assert.match(methodology, /class="back" id="backToApp" href="\/#\/">← Back to app<\/a>/);
  });

  it('bumps the service worker after public HTML and CSS changes', () => {
    assert.match(serviceWorker, /const VERSION = "v477"/);
  });
});
