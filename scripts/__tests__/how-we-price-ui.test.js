import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const methodology = read('public/methodology.html');
const appStyles = read('public/app.css');
const methodologyComponent = read('public/js/components/methodology.js');
const serviceWorker = read('public/sw.js');
const infoStyles = read('public/info-page.css');

describe('How we price UI upgrade', () => {
  it('preserves the methodology promises and evidence rules', () => {
    assert.match(methodology, /<h2>Independent sources, counted honestly<\/h2>/);
    assert.match(methodology, /Sold prices are facts; asking prices are wishes/);
    assert.match(methodology, /No invented numbers: a set without enough verified evidence/);
  });

  it('drops index numbers, hard shadows and boxed grids (taste-skill house rules)', () => {
    assert.doesNotMatch(methodology, /::before \{ content:'0\d'/);
    assert.doesNotMatch(methodology, /box-shadow/);
    assert.match(methodology, /<link rel="stylesheet" href="\/info-page\.css">/);
    assert.match(methodology, /<p class="lead">The rules behind every number in the app/);
  });

  it('keeps the confidence table semantic and overflow-safe', () => {
    assert.match(infoStyles, /@media \(max-width: 600px\)[\s\S]*table \{ display: block; overflow-x: auto; \}/);
    assert.match(methodology, /<th>Badge<\/th>/);
    assert.match(methodology, /class="tier high">Reliable price<\/span>/);
    assert.match(methodology, /class="tier med">Good estimate<\/span>/);
    assert.match(methodology, /class="tier low">Low confidence \/ Estimated<\/span>/);
  });

  it('uses readable touch targets and visible focus', () => {
    assert.match(infoStyles, /\.back \{[^}]*min-height: 44px/);
    assert.match(infoStyles, /a:focus-visible \{ outline: 3px solid/);
    assert.match(infoStyles, /body \{[^}]*font-size: 17px/);
  });

  it('keeps the in-app sheet plain and its tables scrollable', () => {
    assert.doesNotMatch(appStyles, /\.methodology-sheet h2::before/);
    assert.match(appStyles, /\.methodology-sheet table \{[^}]*overflow-x: auto/);
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
    assert.match(serviceWorker, /const VERSION = "v\d+"/);
  });
});
