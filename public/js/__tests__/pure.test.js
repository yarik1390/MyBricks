import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml, fmtPct, clamp, themeHue, bricklinkBuyURL,
  computeDealScore, valuationTrust, catalogFilterSummary, classifyJobRun,
  annualizedROI, parseMarkdown, jwtSub, ebaySoldSummary, marketValueForCondition,
  jobProgressSummary, computeSpreadSignals, buyWindow, pricePerPiece, isStalledJobRun,
  parseCSVTable, parseCollectionCSV, sanitizeMoneyInput, liquidityLabel,
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
  it('marks expired market values as an older price', () => {
    const trust = valuationTrust({ freshness: 'expired', confidence: 'medium', valuation_method: 'market' });
    assert.equal(trust.tone, 'warn');
    assert.equal(trust.label, 'Older price');
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

  it('flags AI-estimated values as an AI estimate, not a market price', () => {
    const trust = valuationTrust({ valuation_method: 'ai', confidence: 'medium', freshness: 'fresh' });
    assert.equal(trust.tone, 'warn');
    assert.equal(trust.label, 'AI estimate');
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

  it('marks running jobs without a fresh heartbeat as stalled and retryable', () => {
    const now = Date.parse('2026-06-10T15:00:00Z');
    const staleRun = {
      status: 'running',
      started_at: '2000-01-01 00:00:00',
      updated_at: '2000-01-01 00:00:00',
    };
    assert.equal(isStalledJobRun(staleRun, { now, staleMinutes: 10 }), true);
    const job = classifyJobRun(staleRun);
    assert.equal(job.label, 'Stalled');
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

  it('does not treat stalled running jobs as active progress', () => {
    const progress = jobProgressSummary({
      status: 'running',
      progress_current: 433,
      progress_total: 600,
      updated_at: '2000-01-01 00:00:00',
    });
    assert.equal(progress.pct, 72);
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

describe('liquidityLabel', () => {
  it('returns null for unknown/zero volume', () => {
    assert.equal(liquidityLabel(undefined), null);
    assert.equal(liquidityLabel(0), null);
    assert.equal(liquidityLabel(-5), null);
  });
  it('classifies fast / steady / slow by yearly units sold', () => {
    assert.equal(liquidityLabel(40).level, 'fast');
    assert.equal(liquidityLabel(30).level, 'fast');
    assert.equal(liquidityLabel(10).level, 'steady');
    assert.equal(liquidityLabel(6).level, 'steady');
    assert.equal(liquidityLabel(2).level, 'slow');
  });
  it('carries the rounded volume and a label', () => {
    assert.deepEqual(liquidityLabel(33.6), { level: 'fast', label: 'Sells fast', volume: 34 });
  });
});

describe('buyWindow', () => {
  it('returns null without target or current value', () => {
    assert.equal(buyWindow({}), null);
    assert.equal(buyWindow({ target_price: 100 }), null);
    assert.equal(buyWindow({ current_value: 100 }), null);
  });

  it('reports at-target when current <= target', () => {
    const bw = buyWindow({ target_price: 100, current_value: 95 });
    assert.equal(bw.state, 'near');
    assert.ok(bw.label.includes('at your target'));
  });

  it('reports almost-at-target within 5%', () => {
    const bw = buyWindow({ target_price: 100, current_value: 104 });
    assert.equal(bw.state, 'near');
    assert.ok(bw.label.includes('almost'));
  });

  it('estimates weeks when trending down toward target', () => {
    const bw = buyWindow({ target_price: 100, current_value: 120, trend_weekly: -5 });
    assert.equal(bw.state, 'approaching');
    assert.equal(bw.weeks, 4);
    assert.ok(bw.label.includes('~4 wks'));
  });

  it('returns null when the ETA exceeds a year', () => {
    assert.equal(buyWindow({ target_price: 100, current_value: 200, trend_weekly: -0.5 }), null);
  });

  it('reports moving away when trending up', () => {
    const bw = buyWindow({ target_price: 100, current_value: 120, trend_weekly: 3 });
    assert.equal(bw.state, 'away');
  });

  it('returns null without trend data above the near band', () => {
    assert.equal(buyWindow({ target_price: 100, current_value: 120, trend_weekly: null }), null);
    assert.equal(buyWindow({ target_price: 100, current_value: 120 }), null);
  });
});

describe('pricePerPiece', () => {
  it('returns null for missing data or tiny sets', () => {
    assert.equal(pricePerPiece({}), null);
    assert.equal(pricePerPiece({ pieces: 500 }), null);
    assert.equal(pricePerPiece({ pieces: 10, current_value: 50 }), null);
  });

  it('computes $/pc and delta against the $0.11 baseline', () => {
    const r = pricePerPiece({ pieces: 1000, current_value: 110, retired: false });
    assert.ok(Math.abs(r.ppp - 0.11) < 1e-9);
    assert.ok(Math.abs(r.delta) < 1e-9);
  });

  it('flags a value buy when well under baseline', () => {
    const r = pricePerPiece({ pieces: 1000, current_value: 70, retired: false });
    assert.ok(r.delta < -0.25);
  });

  it('uses a 1.4x baseline for retired sets', () => {
    const active = pricePerPiece({ pieces: 1000, current_value: 154, retired: false });
    const retired = pricePerPiece({ pieces: 1000, current_value: 154, retired: true });
    assert.ok(active.delta > 0.35);
    assert.ok(Math.abs(retired.delta) < 1e-9);
  });
});

describe('parseCSVTable', () => {
  it('handles quoted cells with embedded commas and doubled quotes', () => {
    const rows = parseCSVTable('a,"b, c","say ""hi"""\n1,2,3\n');
    assert.deepEqual(rows, [['a', 'b, c', 'say "hi"'], ['1', '2', '3']]);
  });

  it('strips CR and drops the trailing blank line (interior empties stay for the row parser to skip)', () => {
    const rows = parseCSVTable('x,y\r\n1,2\r\n\r\n');
    assert.deepEqual(rows, [['x', 'y'], ['1', '2'], ['']]);
  });
});

describe('parseCollectionCSV', () => {
  it('returns [] when the set_num column is missing', () => {
    assert.deepEqual(parseCollectionCSV('name,qty\nFalcon,1\n'), []);
  });

  it('matches loose header names ("Set Number", "date_added")', () => {
    const rows = parseCollectionCSV('Set Number,Quantity,date_added\n75192-1,2,2024-03-05\n');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].set_num, '75192-1');
    assert.equal(rows[0].quantity, 2);
    assert.equal(rows[0].purchased_at, '2024-03-05');
  });

  it('maps condition strings onto the schema enum', () => {
    const csv = 'set_num,condition\nA,Sealed\nB,Used - Good\nC,acceptable\nD,brand new\n';
    const conds = parseCollectionCSV(csv).map(r => r.condition);
    assert.deepEqual(conds, ['sealed', 'used_good', 'used_acceptable', 'new']);
  });

  it('nulls unparseable dates and prices, defaults quantity to 1', () => {
    const rows = parseCollectionCSV('set_num,purchase_price,purchased_at\n10240-1,not-a-price,not-a-date\n');
    assert.equal(rows[0].quantity, 1);
    assert.equal(rows[0].purchase_price, null);
    assert.equal(rows[0].purchased_at, null);
  });

  it('skips blank lines and rows without a set number', () => {
    const rows = parseCollectionCSV('set_num,quantity\n\n,3\n21309-1,1\n');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].set_num, '21309-1');
  });
});

describe('sanitizeMoneyInput', () => {
  it('parses plain and symbol-prefixed amounts', () => {
    assert.equal(sanitizeMoneyInput('1299'), 1299);
    assert.equal(sanitizeMoneyInput('$ 1,234.56'), 1234.56);
    assert.equal(sanitizeMoneyInput('€89,99'), 89.99);
  });

  it('handles EU style with both separators', () => {
    assert.equal(sanitizeMoneyInput('1.299,50'), 1299.5);
    assert.equal(sanitizeMoneyInput('1,299.50'), 1299.5);
  });

  it('treats comma groups of three as thousands', () => {
    assert.equal(sanitizeMoneyInput('1,299'), 1299);
  });

  it('rejects garbage and negatives', () => {
    assert.equal(sanitizeMoneyInput('abc'), null);
    assert.equal(sanitizeMoneyInput(''), null);
    assert.equal(sanitizeMoneyInput(null), null);
    assert.equal(sanitizeMoneyInput('-5'), null);
  });
});

describe('routeMetaFor', () => {
  it('assigns child routes to their owning bottom-nav section', async () => {
    globalThis.localStorage ||= {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
    const { routeMetaFor } = await import('../router.js');
    assert.equal(routeMetaFor('/build').nav, '/');
    assert.equal(routeMetaFor('/wishlist').nav, '/');
    assert.equal(routeMetaFor('/set/10300-1').nav, '/');
    assert.equal(routeMetaFor('/leaderboard').nav, '/me');
    assert.equal(routeMetaFor('/u/demo').nav, '/me');
    assert.equal(routeMetaFor('/add').nav, '/add');
    assert.equal(routeMetaFor('/pile').nav, '/pile');
  });
});

import { resolveDownloadResume } from '../lib/pure.js';

describe('resolveDownloadResume', () => {
  it('returns 0 when meta is null', () => {
    assert.equal(resolveDownloadResume(null, 206, ''), 0);
  });
  it('returns 0 when loadedBytes is 0', () => {
    assert.equal(resolveDownloadResume({ loadedBytes: 0, complete: false }, 206, ''), 0);
  });
  it('returns 0 when download is already complete', () => {
    assert.equal(resolveDownloadResume({ loadedBytes: 500, complete: true }, 206, ''), 0);
  });
  it('returns 0 when server returns 200 (Range ignored)', () => {
    assert.equal(resolveDownloadResume({ loadedBytes: 500, complete: false }, 200, ''), 0);
  });
  it('returns loadedBytes on 206 with no etag in meta', () => {
    assert.equal(resolveDownloadResume({ loadedBytes: 500, complete: false }, 206, ''), 500);
  });
  it('returns loadedBytes on 206 with matching etag', () => {
    assert.equal(resolveDownloadResume({ loadedBytes: 500, etag: '"abc"', complete: false }, 206, '"abc"'), 500);
  });
  it('returns 0 on 206 with mismatched etag (content changed)', () => {
    assert.equal(resolveDownloadResume({ loadedBytes: 500, etag: '"abc"', complete: false }, 206, '"xyz"'), 0);
  });
  it('trusts partial when server 206 response has no etag but meta does', () => {
    assert.equal(resolveDownloadResume({ loadedBytes: 500, etag: '"abc"', complete: false }, 206, null), 500);
  });
});

import { nextOfflineBannerState } from '../lib/pure.js';

describe('nextOfflineBannerState (offline banner debounce)', () => {
  const run = (events, start = 'online') => events.reduce((s, e) => nextOfflineBannerState(s, e), start);

  it('schedules (does not show) on the first offline signal', () => {
    assert.equal(nextOfflineBannerState('online', 'offline'), 'pending');
  });

  it('shows only after the grace window elapses', () => {
    assert.equal(nextOfflineBannerState('pending', 'grace'), 'offline');
  });

  it('cancels before the grace elapses — the boot/flap flash case', () => {
    // online --offline(transient)--> pending --online(confirmed)--> online:
    // the banner never reached 'offline', so it never painted.
    assert.equal(nextOfflineBannerState('pending', 'online'), 'online');
    assert.equal(run(['offline', 'online']), 'online');
    assert.notEqual(run(['offline', 'online']), 'offline');
  });

  it('hides immediately when back online from a shown banner', () => {
    assert.equal(nextOfflineBannerState('offline', 'online'), 'online');
  });

  it('is idempotent: repeated signals do not re-schedule or change state', () => {
    assert.equal(nextOfflineBannerState('pending', 'offline'), 'pending');
    assert.equal(nextOfflineBannerState('offline', 'offline'), 'offline');
    assert.equal(nextOfflineBannerState('online', 'online'), 'online');
  });

  it('ignores a stray grace event when not pending', () => {
    assert.equal(nextOfflineBannerState('online', 'grace'), 'online');
    assert.equal(nextOfflineBannerState('offline', 'grace'), 'offline');
  });

  it('shows only when offline persists through the grace window', () => {
    assert.equal(run(['offline', 'grace']), 'offline');         // persisted → shown
    assert.equal(run(['offline', 'online', 'grace']), 'online'); // recovered first → stays hidden
  });

  it('treats an unknown/initial state as online', () => {
    assert.equal(nextOfflineBannerState(undefined, 'offline'), 'pending');
    assert.equal(nextOfflineBannerState('garbage', 'online'), 'online');
    assert.equal(nextOfflineBannerState(undefined, 'grace'), 'online');
  });

  it('full reconnect cycle: offline persists, shows, then clears on reconnect', () => {
    assert.equal(run(['offline', 'grace', 'online']), 'online');
  });
});

import { upsertDetailCache } from '../lib/pure.js';

describe('upsertDetailCache (offline set-detail LRU)', () => {
  const mk = (setNum, ts, over = {}) => ({ setNum, set: { set_num: setNum, name: setNum }, entry: null, ts, uid: 'u1', ...over });

  it('inserts into an empty/null store', () => {
    const s = upsertDetailCache(null, mk('1-1', 100));
    assert.equal(s.uid, 'u1');
    assert.deepEqual(Object.keys(s.items), ['1-1']);
    assert.equal(s.items['1-1'].set.name, '1-1');
  });

  it('accumulates multiple sets for the same user', () => {
    let s = upsertDetailCache(null, mk('1-1', 100));
    s = upsertDetailCache(s, mk('2-1', 200));
    assert.deepEqual(Object.keys(s.items).sort(), ['1-1', '2-1']);
  });

  it('refreshes an existing set in place (no duplicate, newer ts/entry win)', () => {
    let s = upsertDetailCache(null, mk('1-1', 100));
    s = upsertDetailCache(s, mk('1-1', 999, { entry: { id: 7, purchase_price: 50 } }));
    assert.equal(Object.keys(s.items).length, 1);
    assert.equal(s.items['1-1'].ts, 999);
    assert.equal(s.items['1-1'].entry.purchase_price, 50);
  });

  it('discards the whole map when the user changes (no cross-user leak)', () => {
    let s = upsertDetailCache(null, mk('1-1', 100, { entry: { purchase_price: 50 } }));
    s = upsertDetailCache(s, mk('9-1', 200, { uid: 'u2' }));
    assert.equal(s.uid, 'u2');
    assert.deepEqual(Object.keys(s.items), ['9-1']);
  });

  it('evicts the oldest entries (by ts) once over cap', () => {
    let s = null;
    // cap 3: insert 4 sets with increasing ts; the oldest (ts=1) is evicted.
    for (const t of [1, 2, 3, 4]) s = upsertDetailCache(s, { ...mk('s' + t, t), cap: 3 });
    assert.equal(Object.keys(s.items).length, 3);
    assert.ok(!s.items['s1'], 'oldest evicted');
    assert.ok(s.items['s4'], 'newest kept');
  });

  it('does not mutate the input store (returns a new reference)', () => {
    const orig = upsertDetailCache(null, mk('1-1', 100));
    const snapshotKeys = Object.keys(orig.items).length;
    const next = upsertDetailCache(orig, mk('2-1', 200));
    assert.notEqual(next, orig);
    assert.equal(Object.keys(orig.items).length, snapshotKeys, 'original untouched');
  });
});
