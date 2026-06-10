import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml, fmtPct, clamp, themeHue, bricklinkBuyURL,
  computeDealScore, valuationTrust, catalogFilterSummary, classifyJobRun,
  annualizedROI, parseMarkdown, jwtSub, ebaySoldSummary, marketValueForCondition,
  jobProgressSummary, computeSpreadSignals,
} from '../lib/pure.js';

// Build a fake JWT (header.payload.signature) with base64url, no padding —
// matching how Supabase access tokens are encoded.
function fakeJwt(payloadObj) {
  const b64url = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payloadObj)}.sig`;
}

describe('jwtSub', () => {
  it('extracts the sub claim from a base64url token (no padding)', () => {
    // 'a'.repeat(...) shifts payload length so the base64 needs padding —
    // verifies the decode tolerates missing '=' padding.
    const sub = 'abc-123-user';
    assert.equal(jwtSub(fakeJwt({ sub, role: 'authenticated' })), sub);
  });

  it('distinguishes two different accounts (the account-switch case)', () => {
    const a = jwtSub(fakeJwt({ sub: 'user-A', name: 'aaaa' }));
    const b = jwtSub(fakeJwt({ sub: 'user-B', name: 'bb' }));
    assert.equal(a, 'user-A');
    assert.equal(b, 'user-B');
    assert.notEqual(a, b);
  });

  it('returns null for missing or malformed tokens', () => {
    assert.equal(jwtSub(null), null);
    assert.equal(jwtSub(undefined), null);
    assert.equal(jwtSub(''), null);
    assert.equal(jwtSub('not-a-jwt'), null);
    assert.equal(jwtSub('only.two'), null);
    assert.equal(jwtSub(fakeJwt({ role: 'authenticated' })), null);
  });
});

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

  it('prefers condition-aware eBay sold comps over legacy values', () => {
    const set = { current_value: 50, ebay_value: 70, ebay_new_value: 100, ebay_used_value: 60, retired: false };
    assert.equal(marketValueForCondition(set, 'new'), 100);
    assert.equal(marketValueForCondition(set, 'sealed'), 100);
    assert.equal(marketValueForCondition(set, 'used_good'), 60);
    const r = computeDealScore(set, 80);
    assert.equal(r.verdict, 'great');
  });

  it('pct is (market - store) / market', () => {
    const r = computeDealScore(activeSet, 70);  // 30% below
    assert.ok(Math.abs(r.pct - 0.3) < 0.0001, `expected 0.3, got ${r.pct}`);
  });
});

describe('eBay sold helpers', () => {
  it('summarizes new, used, counts, and timestamps', () => {
    const summary = ebaySoldSummary({
      ebay_new_value: 120,
      ebay_used_value: 75,
      ebay_new_qty: 8,
      ebay_used_qty: 4,
      ebay_new_cached_at: '2026-06-09 10:00:00',
      ebay_used_cached_at: '2026-06-09 11:00:00',
    });
    assert.equal(summary.newValue, 120);
    assert.equal(summary.usedValue, 75);
    assert.equal(summary.newSampleCount, 8);
    assert.equal(summary.usedSampleCount, 4);
    assert.equal(summary.legacy, false);
  });

  it('keeps legacy ebay_value readable until sold comps arrive', () => {
    const summary = ebaySoldSummary({ ebay_value: 99, ebay_cached_at: '2026-06-01 00:00:00' });
    assert.equal(summary.newValue, 99);
    assert.equal(summary.newUpdatedAt, '2026-06-01 00:00:00');
    assert.equal(summary.legacy, true);
  });
});

describe('valuationTrust', () => {
  it('marks expired market values as refresh due', () => {
    const trust = valuationTrust({ freshness: 'expired', confidence: 'medium', valuation_method: 'market' });
    assert.equal(trust.tone, 'danger');
    assert.equal(trust.label, 'Refresh due');
  });

  it('marks formula bulk values as estimates', () => {
    const trust = valuationTrust({ valuation_method: 'formula_bulk', cached_at: new Date().toISOString() });
    assert.equal(trust.tone, 'warn');
    assert.equal(trust.label, 'Estimate');
  });

  it('marks fresh high-confidence values as high confidence', () => {
    const trust = valuationTrust({ freshness: 'fresh', confidence: 'high', primary_value_source: 'brickeconomy' });
    assert.equal(trust.tone, 'ok');
    assert.equal(trust.label, 'High confidence');
  });
});

describe('catalogFilterSummary', () => {
  it('returns a quiet empty state when no filters are active', () => {
    assert.equal(catalogFilterSummary({}), 'No filters active');
  });

  it('summarizes search, theme, retired state, and ranges', () => {
    const summary = catalogFilterSummary({
      catalogQ: 'falcon',
      catalogTheme: 'Star Wars',
      catalogRetired: true,
      catalogRanges: { min_year: 2010, max_year: 2020, min_value: 100, max_value: 250 }
    });
    assert.equal(summary, '5 active: Search "falcon" · Star Wars · Retired only · Year 2010-2020 · Value $100-$250');
  });
});

describe('classifyJobRun', () => {
  it('classifies completed provider no-data notes as retryable no-ops', () => {
    const job = classifyJobRun({ status: 'completed', error: 'Brickset barcode backfill returned no data; retry later' });
    assert.equal(job.label, 'Retryable no-op');
    assert.equal(job.retryable, true);
    assert.equal(job.needsAttention, false);
  });

  it('classifies D1 corruption as a hard error', () => {
    const job = classifyJobRun({ status: 'error', error: 'D1_ERROR: database disk image is malformed: SQLITE_CORRUPT' });
    assert.equal(job.label, 'Hard error');
    assert.equal(job.needsAttention, true);
  });

  it('keeps expired worker slices retryable', () => {
    const job = classifyJobRun({ status: 'expired', error: 'Worker run stopped before completion' });
    assert.equal(job.label, 'Stopped');
    assert.equal(job.retryable, true);
  });
});

describe('jobProgressSummary', () => {
  it('formats determinate running progress', () => {
    const progress = jobProgressSummary({
      status: 'running',
      progress_current: 25,
      progress_total: 100,
      progress_label: 'Importing sets',
    });
    assert.equal(progress.pct, 25);
    assert.equal(progress.countText, '25 / 100');
    assert.equal(progress.active, true);
    assert.equal(progress.label, 'Importing sets');
  });

  it('shows completed jobs as full progress', () => {
    const progress = jobProgressSummary({
      status: 'completed',
      progress_current: 3,
      progress_total: 4,
    });
    assert.equal(progress.pct, 100);
    assert.equal(progress.active, false);
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

describe('computeSpreadSignals', () => {
  const item = (over = {}) => ({
    set_num: '75192-1', name: 'Falcon', quantity: 1,
    bl_new_value: 100, ebay_new_value: null, current_value: 100, ...over,
  });

  it('returns empty signals for no items', () => {
    const out = computeSpreadSignals([]);
    assert.equal(out.hot.length, 0);
    assert.equal(out.cold.length, 0);
    assert.equal(out.totalUpside, 0);
  });

  it('classifies eBay >= 15% above BrickLink as hot', () => {
    const out = computeSpreadSignals([item({ ebay_new_value: 120 })]);
    assert.equal(out.hot.length, 1);
    assert.equal(out.cold.length, 0);
    assert.ok(Math.abs(out.hot[0].spread - 0.2) < 1e-9);
    assert.equal(out.totalUpside, 20);
  });

  it('classifies eBay >= 15% below BrickLink as cold', () => {
    const out = computeSpreadSignals([item({ ebay_new_value: 80 })]);
    assert.equal(out.cold.length, 1);
    assert.equal(out.hot.length, 0);
    assert.equal(out.totalUpside, 0);
  });

  it('ignores spreads inside the threshold', () => {
    const out = computeSpreadSignals([item({ ebay_new_value: 110 })]);
    assert.equal(out.hot.length, 0);
    assert.equal(out.cold.length, 0);
  });

  it('skips items missing eBay or reference value', () => {
    const out = computeSpreadSignals([
      item({ ebay_new_value: null }),
      item({ ebay_new_value: 150, bl_new_value: null, current_value: null }),
    ]);
    assert.equal(out.hot.length + out.cold.length, 0);
  });

  it('multiplies the gap by quantity and sorts by gap', () => {
    const out = computeSpreadSignals([
      item({ set_num: 'a', ebay_new_value: 120, quantity: 1 }),
      item({ set_num: 'b', ebay_new_value: 120, quantity: 3 }),
    ]);
    assert.equal(out.hot[0].item.set_num, 'b');
    assert.equal(out.hot[0].gap, 60);
    assert.equal(out.totalUpside, 80);
  });

  it('falls back to legacy ebay_value and current_value reference', () => {
    const out = computeSpreadSignals([
      item({ ebay_new_value: null, ebay_value: 130, bl_new_value: null, current_value: 100 }),
    ]);
    assert.equal(out.hot.length, 1);
  });

  it('honors a custom threshold', () => {
    const out = computeSpreadSignals([item({ ebay_new_value: 110 })], { threshold: 0.05 });
    assert.equal(out.hot.length, 1);
  });
});
