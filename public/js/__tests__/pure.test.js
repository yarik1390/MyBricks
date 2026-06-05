import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml, fmtPct, clamp, themeHue, bricklinkBuyURL,
  computeDealScore, annualizedROI, parseMarkdown,
} from '../lib/pure.js';

describe('escapeHtml', () => {
  it('escapes < > & " characters', () => {
    assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
    assert.equal(escapeHtml('A & B'), 'A &amp; B');
    assert.equal(escapeHtml('"quoted"'), '&quot;quoted&quot;');
  });

  it('handles null / undefined gracefully', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
    assert.equal(escapeHtml(0), '0');
  });

  it('leaves clean strings untouched', () => {
    assert.equal(escapeHtml('hello world'), 'hello world');
  });
});

describe('fmtPct', () => {
  it('prefixes positive with +', () => {
    assert.equal(fmtPct(0.125), '+12.5%');
    assert.equal(fmtPct(0), '+0.0%');
  });

  it('negative has no + prefix', () => {
    assert.equal(fmtPct(-0.3), '-30.0%');
  });

  it('rounds to one decimal', () => {
    assert.equal(fmtPct(0.1234), '+12.3%');
  });
});

describe('clamp', () => {
  it('returns min when x is below range', () => assert.equal(clamp(-5, 0, 10), 0));
  it('returns max when x is above range', () => assert.equal(clamp(15, 0, 10), 10));
  it('returns x when within range', () => assert.equal(clamp(5, 0, 10), 5));
  it('handles equal bounds', () => assert.equal(clamp(3, 7, 7), 7));
});

describe('themeHue', () => {
  it('returns a number in [0, 360)', () => {
    const h = themeHue('Star Wars');
    assert.ok(h >= 0 && h < 360, `expected [0,360), got ${h}`);
  });

  it('returns same value for same input (deterministic)', () => {
    assert.equal(themeHue('City'), themeHue('City'));
    assert.equal(themeHue('Technic'), themeHue('Technic'));
  });

  it('different themes produce different hues (collision test on common themes)', () => {
    const themes = ['Star Wars', 'City', 'Technic', 'Friends', 'Harry Potter', 'Icons'];
    const hues = themes.map(themeHue);
    const unique = new Set(hues);
    assert.equal(unique.size, themes.length, `collisions among ${hues}`);
  });

  it('empty string returns 0', () => {
    assert.equal(themeHue(''), 0);
    assert.equal(themeHue(), 0);
  });
});

describe('bricklinkBuyURL', () => {
  it('appends -1 when no dash present', () => {
    assert.equal(bricklinkBuyURL('75192'), 'https://www.bricklink.com/v2/catalog/catalogitem.page?S=75192-1');
  });

  it('uses existing dash as-is', () => {
    assert.equal(bricklinkBuyURL('75192-1'), 'https://www.bricklink.com/v2/catalog/catalogitem.page?S=75192-1');
  });
});

describe('computeDealScore', () => {
  const activeSet = { current_value: 100, ebay_value: null, retired: false };
  const retiredSet = { current_value: 100, ebay_value: null, retired: true };

  it('returns null when no market value', () => {
    assert.equal(computeDealScore({ current_value: null, ebay_value: null, retired: false }, 80), null);
  });

  it('returns null when storePrice is zero', () => {
    assert.equal(computeDealScore(activeSet, 0), null);
  });

  it('great deal: active set ≥ 15% below market', () => {
    const r = computeDealScore(activeSet, 80);  // 20% below
    assert.equal(r.verdict, 'great');
    assert.ok(r.pct > 0);
    assert.ok(r.label.includes('below market'));
  });

  it('great deal threshold for retired set is 5% (lower bar)', () => {
    const r = computeDealScore(retiredSet, 94);  // 6% below market — great for retired, fair for active
    assert.equal(r.verdict, 'great');
    const rActive = computeDealScore(activeSet, 94);  // only 6% — not enough for active
    assert.equal(rActive.verdict, 'fair');
  });

  it('fair deal: within ±5% of market (active)', () => {
    const r = computeDealScore(activeSet, 97);  // 3% below — fair
    assert.equal(r.verdict, 'fair');
  });

  it('overpriced: storePrice > 5% above market', () => {
    const r = computeDealScore(activeSet, 110);  // 10% above
    assert.equal(r.verdict, 'over');
    assert.ok(r.pct < 0);
    assert.ok(r.label.includes('above market'));
  });

  it('prefers ebay_value over current_value when set', () => {
    const set = { current_value: 50, ebay_value: 100, retired: false };
    const r = computeDealScore(set, 80);  // 20% below eBay market
    assert.equal(r.verdict, 'great');
  });

  it('pct is (market - store) / market', () => {
    const r = computeDealScore(activeSet, 70);  // 30% below
    assert.ok(Math.abs(r.pct - 0.3) < 0.0001, `expected 0.3, got ${r.pct}`);
  });
});

describe('annualizedROI', () => {
  it('returns null for zero purchase price', () => {
    assert.equal(annualizedROI(0, 200, 3), null);
  });

  it('returns null for zero years owned', () => {
    assert.equal(annualizedROI(100, 200, 0), null);
  });

  it('computes 2x in 3 years correctly (~26% annualized)', () => {
    const roi = annualizedROI(100, 200, 3);
    assert.ok(roi !== null);
    assert.ok(Math.abs(roi - 26.0) < 0.1, `expected ~26.0%, got ${roi?.toFixed(2)}`);
  });

  it('1x (no gain) returns 0%', () => {
    const roi = annualizedROI(100, 100, 5);
    assert.ok(Math.abs(roi) < 0.001, `expected ~0, got ${roi}`);
  });

  it('loss scenario returns negative ROI', () => {
    const roi = annualizedROI(100, 50, 2);
    assert.ok(roi !== null && roi < 0, `expected negative, got ${roi}`);
  });
});

describe('parseMarkdown', () => {
  it('returns empty string for falsy input', () => {
    assert.equal(parseMarkdown(''), '');
    assert.equal(parseMarkdown(null), '');
  });

  it('escapes HTML before processing (XSS prevention)', () => {
    const out = parseMarkdown('<script>evil()</script>');
    assert.ok(!out.includes('<script>'), 'raw script tag must be escaped');
    assert.ok(out.includes('&lt;script&gt;'));
  });

  it('converts **bold** to <strong>', () => {
    assert.ok(parseMarkdown('**bold**').includes('<strong>bold</strong>'));
  });

  it('converts *italic* to <em>', () => {
    assert.ok(parseMarkdown('*italic*').includes('<em>italic</em>'));
  });

  it('converts ## header', () => {
    assert.ok(parseMarkdown('## Title').includes('<h2>Title</h2>'));
  });

  it('wraps bullet list items in <ul><li>', () => {
    const out = parseMarkdown('- item one\n- item two');
    assert.ok(out.includes('<ul'), 'should open ul');
    assert.ok(out.includes('<li>item one</li>'));
    assert.ok(out.includes('<li>item two</li>'));
    assert.ok(out.includes('</ul>'));
  });

  it('bold inside XSS input is double-escaped (not rendered as tag)', () => {
    // Ensure that <b> in input is escaped, not treated as Markdown bold
    const out = parseMarkdown('<b>not bold</b>');
    assert.ok(!out.includes('<b>'));
    assert.ok(out.includes('&lt;b&gt;'));
  });
});
