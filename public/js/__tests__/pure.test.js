import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml, fmtPct, clamp, themeHue, bricklinkBuyURL,
  computeDealScore, valuationTrust, catalogFilterSummary, classifyJobRun,
  annualizedROI, parseMarkdown, jwtSub, ebaySoldSummary, marketValueForCondition,
  jobProgressSummary, computeSpreadSignals, buyWindow, pricePerPiece, isStalledJobRun,
  parseCSVTable, parseCollectionCSV, sanitizeMoneyInput, activeCatalogFilterCount, activeFigFilterCount, figFilterSummary,
  liquidityLabel, classifyProviderHealth, validateSourceTuningInput, groupAdminJobRuns,
  formatRelativeTime, processRunBadge, isEstimatedValue, estMark,
  displayValueOf, withDisplayValue, shouldUseKeyboardShell, classifyScanFailure, isCredentialAuthFailure, flipEconomics,
  cleanTagLabel, pluralize, manualScanTarget, cleanFacetList,
  computeStoreVerdict, computeSellSignal,
} from '../lib/pure.js';
import { biometricAvailable, verifyBiometricResult } from '../lib/native-biometric.js';

describe('native biometric bridge', () => {
  it('uses Capacitor native internalAuthenticate and permits device credentials', async () => {
    let received;
    const win = {
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: {
          BiometricAuthNative: {
            checkBiometry: async () => ({ isAvailable: false, deviceIsSecure: true }),
            internalAuthenticate: async (options) => { received = options; },
          },
        },
      },
    };

    assert.equal(await biometricAvailable(win), true);
    const result = await verifyBiometricResult('Enable app lock', win);
    assert.equal(result.ok, true);
    assert.equal(received.allowDeviceCredential, true);
    assert.equal(received.androidTitle, 'BricksVault');
  });

  it('surfaces actionable native enrollment errors', async () => {
    const win = {
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: {
          BiometricAuthNative: {
            internalAuthenticate: async () => { throw { code: 'biometryNotEnrolled', message: 'native failure' }; },
          },
        },
      },
    };

    const result = await verifyBiometricResult('Unlock BricksVault', win);
    assert.equal(result.ok, false);
    assert.match(result.message, /Android settings/i);
  });
});

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

describe('cleanTagLabel', () => {
  it('strips the scraper metadata suffix', () => {
    assert.equal(cleanTagLabel('Harry Potter|n'), 'Harry Potter');
    assert.equal(cleanTagLabel('Albus Dumbledore|n '), 'Albus Dumbledore');
  });
  it('leaves plain tags untouched', () => {
    assert.equal(cleanTagLabel('Castle'), 'Castle');
  });
  it('handles empties and non-strings without throwing', () => {
    assert.equal(cleanTagLabel(''), '');
    assert.equal(cleanTagLabel(null), '');
    assert.equal(cleanTagLabel(undefined), '');
    assert.equal(cleanTagLabel(42), '42');
  });
});

describe('pluralize', () => {
  it('uses the singular for exactly one', () => {
    assert.equal(pluralize(1, 'set'), '1 set');
  });
  it('adds s otherwise', () => {
    assert.equal(pluralize(0, 'set'), '0 sets');
    assert.equal(pluralize(2, 'alert'), '2 alerts');
  });
  it('accepts an irregular plural', () => {
    assert.equal(pluralize(3, 'entry', 'entries'), '3 entries');
  });
});

describe('cleanFacetList', () => {
  it('drops junk placeholder values from real catalog facets', () => {
    const input = ['Star Wars', ':null', 'null', 'N/A', 'Unknown', 'Random', '{t.b.a.}', 'Technic', 'undefined', 'none', '-', '???'];
    assert.deepEqual(cleanFacetList(input), ['Star Wars', 'Technic']);
  });
  it('sorts A→Z when asked, keeping real values', () => {
    assert.deepEqual(
      cleanFacetList(['Technic', 'Star Wars', 'Icons', 'null'], { sort: true }),
      ['Icons', 'Star Wars', 'Technic'],
    );
  });
  it('preserves the given order by default (popularity)', () => {
    assert.deepEqual(cleanFacetList(['Technic', 'Star Wars', 'Icons']), ['Technic', 'Star Wars', 'Icons']);
  });
  it('de-dupes case-insensitively, keeping the first spelling', () => {
    assert.deepEqual(cleanFacetList(['City', 'city', 'CITY', 'Castle']), ['City', 'Castle']);
  });
  it('trims whitespace and tolerates non-arrays / non-strings', () => {
    assert.deepEqual(cleanFacetList(['  Space  ', 42, null, 'Space']), ['Space']);
    assert.deepEqual(cleanFacetList(null), []);
    assert.deepEqual(cleanFacetList(undefined), []);
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

describe('displayValueOf', () => {
  it('prefers market_value, then blended_value, then current_value', () => {
    assert.equal(displayValueOf({ market_value: 900, blended_value: 850, current_value: 800 }), 900);
    assert.equal(displayValueOf({ blended_value: 850, current_value: 800 }), 850);
    assert.equal(displayValueOf({ current_value: 800 }), 800);
    assert.equal(displayValueOf({}), 0);
  });
  it('ignores zero/negative values in the chain', () => {
    assert.equal(displayValueOf({ market_value: 0, blended_value: 850 }), 850);
    assert.equal(displayValueOf({ market_value: -5, blended_value: 0, current_value: 42 }), 42);
  });
});

describe('canonical pricing surfaces', () => {
  it('normalizes legacy wishlist math to the same fair value as set detail', () => {
    const item = withDisplayValue({ market_value: 357.47, blended_value: 360.2, current_value: 410, target_price: 350 });
    assert.equal(item.current_value, 357.47);
    assert.equal(item.target_price, 350);
  });
});

describe('mobile keyboard shell', () => {
  it('collapses fixed chrome for focused mobile inputs', () => {
    assert.equal(shouldUseKeyboardShell({ editable: true, compact: true, innerHeight: 800, viewportHeight: 800 }), true);
    assert.equal(shouldUseKeyboardShell({ editable: false, compact: true, innerHeight: 800, viewportHeight: 500 }), false);
    assert.equal(shouldUseKeyboardShell({ editable: true, compact: false, innerHeight: 800, viewportHeight: 500 }), true);
  });
});

describe('scanner failure states', () => {
  it('does not label provider setup failures as photo no-matches', () => {
    assert.deepEqual(classifyScanFailure('Sign in or add your own Gemini API key'), { kind: 'setup', label: 'Setup needed', retryable: false });
    assert.equal(classifyScanFailure('Quota exceeded (HTTP 429)').kind, 'limit');
    assert.equal(classifyScanFailure("Couldn't identify the set").kind, 'nomatch');
  });
});

describe('authentication failure classification', () => {
  it('clears sessions only for credential failures', () => {
    assert.equal(isCredentialAuthFailure('Unauthorized: expired token'), true);
    assert.equal(isCredentialAuthFailure('Unauthorized: malformed token'), true);
    assert.equal(isCredentialAuthFailure('Could not verify the request'), false);
    assert.equal(isCredentialAuthFailure('Sign in or add your own Gemini API key'), false);
  });
});

describe('manual scanner input', () => {
  it('normalizes complete and bare LEGO set numbers', () => {
    assert.deepEqual(manualScanTarget('71043-1'), { kind: 'set', value: '71043-1' });
    assert.deepEqual(manualScanTarget(' 71043 '), { kind: 'set', value: '71043-1' });
  });

  it('keeps retail barcodes separate and rejects short noise', () => {
    assert.deepEqual(manualScanTarget('5 709 123 456 789'), { kind: 'barcode', value: '5709123456789' });
    assert.deepEqual(manualScanTarget('12-AB'), { kind: 'invalid', value: '' });
  });
});

describe('flipEconomics', () => {
  it('computes fees on the converted price and converts the fixed fee', () => {
    // 100 USD at rate 2 → gross 200; 10% marketplace = 20; 5% + $0.30×2 payment
    // = 10.60; shipping 5 + tax 1 → net = 200 − 36.60 = 163.40.
    const r = flipEconomics({ marketUsd: 100, rate: 2, feePct: 10, paymentPct: 5, shipping: 5, tax: 1 });
    assert.equal(r.gross, 200);
    assert.equal(r.marketplaceFee, 20);
    assert.equal(Math.round(r.paymentFee * 100) / 100, 10.6);
    assert.equal(Math.round(r.net * 100) / 100, 163.4);
  });
  it('returns null with no usable market value and never goes negative', () => {
    assert.equal(flipEconomics({ marketUsd: 0 }), null);
    assert.equal(flipEconomics({}), null);
    const r = flipEconomics({ marketUsd: 1, feePct: 500 });
    assert.equal(r.net, 0);
  });
  it('defaults rate to 1 (USD passthrough)', () => {
    const r = flipEconomics({ marketUsd: 100, feePct: 13.25, paymentPct: 2.9 });
    assert.equal(r.gross, 100);
    assert.equal(Math.round(r.paymentFee * 100) / 100, 3.2);
  });
});

describe('isEstimatedValue / estMark', () => {
  it('flags formula, local, AI and unknown methods as estimates', () => {
    assert.equal(isEstimatedValue({ valuation_method: 'formula_bulk', current_value: 120 }), true);
    assert.equal(isEstimatedValue({ valuation_method: 'local', current_value: 50 }), true);
    assert.equal(isEstimatedValue({ valuation_method: 'ai', current_value: 80 }), true);
    assert.equal(isEstimatedValue({ current_value: 10 }), true);
    assert.equal(estMark({ valuation_method: 'formula_bulk' }), '~');
  });
  it('never flags market-derived values', () => {
    assert.equal(isEstimatedValue({ valuation_method: 'market', current_value: 120 }), false);
    assert.equal(isEstimatedValue({ valuation_method: 'formula_bulk', market_value: 900 }), false);
    assert.equal(isEstimatedValue({ valuation_method: 'formula_bulk', blended_value: 900 }), false);
    assert.equal(estMark({ valuation_method: 'market' }), '');
  });
  it('treats coming-soon retail as a fact, not an estimate', () => {
    assert.equal(isEstimatedValue({ coming_soon: true, valuation_method: 'formula_bulk' }), false);
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

  it('defaults an uncorroborated BrickEconomy row to low confidence, never "Market price"', () => {
    // No explicit confidence from the API (offline/legacy row): a lone scrape
    // must not wear the ok-tone "Market price" badge.
    const trust = valuationTrust({ valuation_method: 'brickeconomy', freshness: 'fresh' });
    assert.equal(trust.tone, 'warn');
    assert.equal(trust.label, 'Low confidence');
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

  it('counts active catalog filters for badges', () => {
    assert.equal(activeCatalogFilterCount({
      catalogQ: 'falcon',
      catalogTheme: 'Star Wars',
      catalogRetired: 'retired',
      catalogDeal: true,
      catalogRanges: { min_year: 2010, max_year: '' },
    }), 5);
  });
});

describe('figFilterSummary', () => {
  it('returns a quiet empty state when no minifig filters are active', () => {
    assert.equal(figFilterSummary({ figRarity: 'all', figOwned: 'all', figSeries: 'all' }), 'No filters active');
  });

  it('summarizes minifig search, rarity, ownership, and series', () => {
    assert.equal(figFilterSummary({
      figQ: 'wolf',
      figRarity: 'rare',
      figOwned: 'unowned',
      figSeries: 'Collectible Minifigures',
    }), '4 active: Search "wolf" · Rare rarity · Unowned only · Collectible Minifigures');
  });
  it('counts active minifig filters for badges', () => {
    assert.equal(activeFigFilterCount({
      figQ: 'wolf',
      figRarity: 'rare',
      figOwned: 'owned',
      figSeries: 'Collectible Minifigures',
    }), 4);
    assert.equal(activeFigFilterCount({ figRarity: 'all', figOwned: 'all', figSeries: 'all' }), 0);
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

  it('separates quota limits from hard job errors', () => {
    const job = classifyJobRun({ status: 'error', error: 'UPCitemdb EXCEED_LIMIT HTTP 429' });
    assert.equal(job.label, 'Quota limited');
    assert.equal(job.needsAttention, false);
    assert.equal(job.retryable, true);
  });

  it('separates provider access blocks from retryable notes', () => {
    const job = classifyJobRun({ status: 'error', error: 'eBay Marketplace Insights HTTP 401 insufficient permissions' });
    assert.equal(job.label, 'Provider blocked');
    assert.equal(job.needsAttention, true);
    assert.equal(job.retryable, false);
  });
});

describe('admin helper classification', () => {
  it('classifies provider quota states as expected limits', () => {
    const provider = classifyProviderHealth({
      service: 'upcitemdb',
      configured: true,
      status: 'down',
      last_fail_at: '2026-06-10 10:00:00',
      last_error: 'EXCEED_LIMIT HTTP 429',
    });
    assert.equal(provider.label, 'Quota limited');
    assert.equal(provider.quotaLimited, true);
    assert.equal(provider.blocked, false);
  });

  it('clears the quota badge once the provider has succeeded since the failure', () => {
    // BrickEconomy: last OK 30 minutes ago, last fail 47 days ago, 0/80 of its
    // daily quota used — yet it was badged "Quota limited" because last_error
    // still held an old HTTP 429 and nothing checked whether it was current.
    const provider = classifyProviderHealth({
      service: 'brickeconomy',
      configured: true,
      status: 'ok',
      last_ok_at: '2026-07-29 09:45:00',
      last_fail_at: '2026-06-12 13:58:00',
      last_error: 'HTTP 429',
    });
    assert.equal(provider.quotaLimited, false);
    assert.notEqual(provider.label, 'Quota limited');
  });

  it('reports a switched-off source as Off rather than demanding action', () => {
    // BrickOwl: switch off, 403 recorded 46 days ago — it was sitting in
    // "Needs action" as "Needs access" for a source nothing calls.
    const provider = classifyProviderHealth({
      service: 'brickowl',
      configured: true,
      disabled: true,
      status: 'down',
      last_ok_at: null,
      last_fail_at: '2026-06-13 09:11:00',
      last_error: 'HTTP 403',
    });
    assert.equal(provider.label, 'Off');
    assert.equal(provider.actionable, false);
    assert.equal(provider.blocked, false);
    assert.equal(provider.tone, 'neutral');
  });

  it('still flags a source that is switched ON but failing', () => {
    const provider = classifyProviderHealth({
      service: 'brickowl',
      configured: true,
      disabled: false,
      status: 'down',
      last_fail_at: '2026-06-13 09:11:00',
      last_error: 'HTTP 403',
    });
    assert.equal(provider.blocked, true);
    assert.equal(provider.label, 'Needs access');
  });

  it('treats Amazon as optional so an unqualified account is not triaged', () => {
    const provider = classifyProviderHealth({ service: 'amazon', configured: false, status: 'unknown' });
    assert.equal(provider.optional, true);
    assert.equal(provider.actionable, false);
    assert.equal(provider.label, 'Optional setup');
  });

  it('classifies eBay 401 as sold-comps blocked', () => {
    const provider = classifyProviderHealth({
      service: 'ebay',
      configured: true,
      status: 'down',
      last_fail_at: '2026-06-10 10:00:00',
      last_error: 'Marketplace Insights HTTP 401 insufficient permissions',
    });
    assert.equal(provider.label, 'Sold comps blocked');
    assert.equal(provider.blocked, true);
  });

  it('validates and normalizes source tuning inputs', () => {
    const result = validateSourceTuningInput({
      bricklink: { enabled: true, weight: '1,25', dailyCap: '4000', refreshDays: '14' },
      ebay: { enabled: false, weight: '-1', dailyCap: '0', refreshDays: '' },
    });
    assert.equal(result.ok, false);
    assert.equal(result.config.bricklink.weight, 1.25);
    assert.equal(result.config.bricklink.dailyCap, 4000);
    assert.equal(result.config.bricklink.refreshDays, 14);
    assert.ok(result.errors.ebay.length >= 2);
  });

  it('groups repeated completed jobs for admin history', () => {
    const groups = groupAdminJobRuns([
      { id: 3, job_type: 'populate_everything', status: 'completed' },
      { id: 2, job_type: 'populate_everything', status: 'completed' },
      { id: 1, job_type: 'valuation', status: 'error', error: 'D1_ERROR: database disk image is malformed: SQLITE_CORRUPT' },
    ]);
    assert.equal(groups[0].count, 2);
    assert.equal(groups[1].state.label, 'Hard error');
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

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-06-27T12:00:00Z');
  it('returns — for missing/bad values', () => {
    assert.equal(formatRelativeTime(null, now), '—');
    assert.equal(formatRelativeTime('not-a-date', now), '—');
  });
  it('parses SQLite UTC strings and ISO', () => {
    assert.equal(formatRelativeTime('2026-06-27 11:59:55', now), 'just now');
    assert.equal(formatRelativeTime('2026-06-27 11:58:00', now), '2m ago');
    assert.equal(formatRelativeTime('2026-06-27T09:00:00Z', now), '3h ago');
    assert.equal(formatRelativeTime('2026-06-25 12:00:00', now), '2d ago');
  });
});

describe('processRunBadge', () => {
  it('maps status to tone + label', () => {
    assert.deepEqual(processRunBadge({ status: 'running' }), { tone: 'running', label: 'Running' });
    assert.deepEqual(processRunBadge({ status: 'failed' }), { tone: 'danger', label: 'Failed' });
    assert.deepEqual(processRunBadge({ status: 'ok' }), { tone: 'ok', label: 'OK' });
    assert.deepEqual(processRunBadge({}), { tone: 'idle', label: 'Not run yet' });
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
  it('imports a Brickset-style export (Number/QtyOwned/PricePaid/DateAcquired)', () => {
    const csv = 'Number,Theme,Year,SetName,Pieces,QtyOwned,DateAcquired,PricePaid,Notes\n' +
      '75192-1,Star Wars,2017,Millennium Falcon,7541,2,2020-10-15,649.99,UCS grail';
    const rows = parseCollectionCSV(csv);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].set_num, '75192-1');
    assert.equal(rows[0].quantity, 2);
    assert.equal(rows[0].purchase_price, 649.99);
    assert.equal(rows[0].purchased_at, '2020-10-15');
    assert.equal(rows[0].notes, 'UCS grail');
  });

  it('imports a BrickEconomy-style export and normalizes bare set numbers', () => {
    const csv = 'Number,Name,Condition,Qty,Paid,Purchase Date\n' +
      '75257,Millennium Falcon,Used,1,89.5,2023-01-02';
    const rows = parseCollectionCSV(csv);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].set_num, '75257-1'); // bare number gets the canonical -1
    assert.equal(rows[0].condition, 'used_good');
    assert.equal(rows[0].purchase_price, 89.5);
    assert.equal(rows[0].purchased_at, '2023-01-02');
  });

  it('does not treat a market Value column as the price paid', () => {
    const csv = 'Number,Value\n10307,1200';
    const rows = parseCollectionCSV(csv);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].set_num, '10307-1');
    assert.equal(rows[0].purchase_price, null);
  });

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
    const { routeMetaFor } = await import('../route-meta.js');
    assert.equal(routeMetaFor('/build').nav, '/');
    assert.equal(routeMetaFor('/wishlist').nav, '/');
    // Set detail is reachable from Vault, Catalog and Minifigs alike, so no
    // bottom-nav tab should light up there.
    assert.equal(routeMetaFor('/set/10300-1').nav, null);
    assert.equal(routeMetaFor('/leaderboard').nav, '/me');
    assert.equal(routeMetaFor('/u/demo').nav, '/me');
    assert.equal(routeMetaFor('/add').nav, '/add');
    assert.equal(routeMetaFor('/pile').nav, '/pile');
  });

  it('hides the AI FAB on operational and full-screen routes', async () => {
    const { routeMetaFor } = await import('../route-meta.js');
    assert.equal(routeMetaFor('/pile').fab, false);
    assert.equal(routeMetaFor('/login').fab, false);
    assert.equal(routeMetaFor('/me/admin').fab, false);
    assert.equal(routeMetaFor('/me/data').fab, false);
    assert.equal(routeMetaFor('/me/integrations').fab, false);
    assert.equal(routeMetaFor('/').fab, true);
    assert.equal(routeMetaFor('/build').fab, true);
  });
});

describe('native auth helpers', () => {
  it('uses the verified Pages App Link callback on native platforms', async () => {
    const { authRedirectUrlForPlatform } = await import('../lib/native-auth.js');
    const nativeWin = {
      Capacitor: { isNativePlatform: () => true },
      location: { origin: 'https://localhost', pathname: '/' },
    };
    const webWin = {
      Capacitor: { isNativePlatform: () => false },
      location: { origin: 'https://localhost', pathname: '/app/' },
    };
    assert.equal(authRedirectUrlForPlatform(nativeWin), 'https://brickvault-5ub.pages.dev/?native_oauth=1');
    assert.equal(authRedirectUrlForPlatform(webWin), 'https://localhost/app/');
  });

  it('builds a Supabase Google authorize URL with the selected redirect target', async () => {
    const { buildSupabaseProviderAuthUrl } = await import('../lib/native-auth.js');
    const url = new URL(buildSupabaseProviderAuthUrl(
      'https://example.supabase.co',
      'google',
      'app.bricksvault://auth/callback',
    ));
    assert.equal(url.origin, 'https://example.supabase.co');
    assert.equal(url.pathname, '/auth/v1/authorize');
    assert.equal(url.searchParams.get('provider'), 'google');
    assert.equal(url.searchParams.get('redirect_to'), 'app.bricksvault://auth/callback');
    assert.equal(url.searchParams.get('prompt'), 'select_account');
  });

  it('extracts only trusted BricksVault OAuth callback hashes', async () => {
    const { nativeOAuthCallbackFromWebBridge, oauthHashFromCallbackUrl } = await import('../lib/native-auth.js');
    assert.equal(
      oauthHashFromCallbackUrl('app.bricksvault://auth/callback#access_token=tok&refresh_token=ref'),
      '#access_token=tok&refresh_token=ref',
    );
    assert.equal(
      oauthHashFromCallbackUrl('app.bricksvault://auth/callback#error=access_denied'),
      '#error=access_denied',
    );
    assert.equal(oauthHashFromCallbackUrl('app.bricksvault://wrong/callback#access_token=tok'), '');
    assert.equal(
      oauthHashFromCallbackUrl('https://brickvault-5ub.pages.dev/#access_token=tok&refresh_token=ref'),
      '#access_token=tok&refresh_token=ref',
    );
    assert.equal(oauthHashFromCallbackUrl('https://example.com/#access_token=tok'), '');
    assert.equal(
      nativeOAuthCallbackFromWebBridge('https://brickvault-5ub.pages.dev/?native_oauth=1#access_token=tok&refresh_token=ref'),
      'app.bricksvault://auth/callback#access_token=tok&refresh_token=ref',
    );
    assert.equal(nativeOAuthCallbackFromWebBridge('https://brickvault-5ub.pages.dev/#access_token=tok'), '');
  });
});

describe('Amazon affiliate isolation', () => {
  it('expires API prices after 23 hours and keeps the link-only fallback', async () => {
    const { AMAZON_OFFER_TTL_MS, amazonOfferIsFresh, amazonOfferHTML } = await import('../lib/amazon-affiliate.js');
    const now = Date.now();
    const base = {
      available: true,
      mode: 'creators_api',
      url: 'https://www.amazon.fr/s?k=LEGO&tag=brickvault-test',
      price: 99.99,
      currency: 'EUR',
      checked_at: new Date(now - AMAZON_OFFER_TTL_MS + 1000).toISOString(),
      disclosure: 'As an Amazon Associate, Brickvault earns from qualifying purchases.',
    };
    assert.equal(amazonOfferIsFresh(base, now), true);
    assert.equal(amazonOfferIsFresh({ ...base, checked_at: new Date(now - AMAZON_OFFER_TTL_MS).toISOString() }, now), false);
    const staleHTML = amazonOfferHTML({ ...base, checked_at: new Date(now - AMAZON_OFFER_TTL_MS - 1000).toISOString() });
    assert.match(staleHTML, /Check current price/);
    assert.doesNotMatch(staleHTML, /99[.,]99/);
    assert.match(staleHTML, /rel="sponsored nofollow noopener"/);
  });

  it('reports Android only for a native Capacitor runtime and opens Browser externally', async () => {
    const { brickvaultPlatform, openExternalCommerce } = await import('../lib/amazon-affiliate.js');
    const calls = [];
    const nativeWin = {
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: { Browser: { open: async (payload) => calls.push(payload) } },
      },
    };
    assert.equal(brickvaultPlatform(nativeWin), 'android');
    assert.equal(brickvaultPlatform({ Capacitor: { isNativePlatform: () => false } }), 'web');
    assert.equal(await openExternalCommerce('https://www.amazon.fr/test', nativeWin), true);
    assert.deepEqual(calls, [{ url: 'https://www.amazon.fr/test' }]);
  });

  it('exposes Pricing as a first-class admin section', async () => {
    const { ADMIN_SECTIONS, ADMIN_JOB_TOOLS } = await import('../views/me-admin-config.js');
    assert.ok(ADMIN_SECTIONS.some(([id, label]) => id === 'adminPricing' && label === 'Pricing'));
    // PriceCharting jobs are enabled now that signals flow only from verified
    // mappings (unique UPC / price agreement); the on-demand verify runs the
    // same promotion path as the hourly drain.
    assert.ok(!ADMIN_JOB_TOOLS.pricechartingBulk.disabled);
    assert.equal(ADMIN_JOB_TOOLS.pricechartingVerify.url, '/api/admin/run-pricecharting-verify');
  });
});

describe('native sharing', () => {
  it('uses the Capacitor share sheet before the browser API', async () => {
    const { shareContent } = await import('../lib/native-share.js');
    const calls = [];
    const win = {
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: { Share: { share: async payload => { calls.push(payload); } } },
      },
      navigator: { share: async () => { throw new Error('browser share should not run'); } },
    };
    const payload = { title: 'Set', text: 'A LEGO set', url: 'https://example.test/#/set/1' };
    assert.equal(await shareContent(payload, win), 'shared');
    assert.deepEqual(calls, [payload]);
  });

  it('falls back to Web Share and distinguishes unsupported devices', async () => {
    const { shareContent } = await import('../lib/native-share.js');
    let browserCalls = 0;
    const web = {
      Capacitor: { isNativePlatform: () => false },
      navigator: { share: async () => { browserCalls++; } },
    };
    assert.equal(await shareContent({ title: 'Set' }, web), 'shared');
    assert.equal(browserCalls, 1);
    assert.equal(await shareContent({ title: 'Set' }, { navigator: {} }), 'unsupported');
  });
});

describe('native CSV export', () => {
  it('writes to the native cache and opens the system share sheet', async () => {
    const { exportBlob } = await import('../lib/native-file-export.js');
    const calls = [];
    const win = {
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: {
          Filesystem: {
            writeFile: async payload => { calls.push(['write', payload]); },
            getUri: async payload => { calls.push(['uri', payload]); return { uri: 'content://cache/brickvault.csv' }; },
          },
          Share: { share: async payload => { calls.push(['share', payload]); } },
        },
      },
    };
    assert.equal(await exportBlob(new Blob(['set_num\n71043-1']), 'brickvault.csv', {}, win), 'shared');
    assert.equal(calls[0][0], 'write');
    assert.equal(calls[0][1].directory, 'CACHE');
    assert.deepEqual(calls[2][1].files, ['content://cache/brickvault.csv']);
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

import { allowedInKidsMode } from '../route-meta.js';

describe('allowedInKidsMode', () => {
  it('allows the kids sandbox routes', () => {
    for (const h of ['/kids', '/kids/badges', '/add', '/pile', '/login']) {
      assert.equal(allowedInKidsMode(h), true, `${h} should be allowed`);
    }
  });

  it('blocks every other route (redirects to kids home)', () => {
    for (const h of ['/', '', '/set/75192-1', '/me', '/me/integrations', '/me/data',
                     '/wishlist', '/leaderboard', '/minifigs', '/build', '/u/bob']) {
      assert.equal(allowedInKidsMode(h), false, `${h} should be blocked`);
    }
  });

  it('ignores a leading # and query string', () => {
    assert.equal(allowedInKidsMode('#/add?theme=Star+Wars'), true);
    assert.equal(allowedInKidsMode('#/me?x=1'), false);
  });
});

import { seedFilterSort } from '../lib/pure.js';

describe('seedFilterSort (offline catalog)', () => {
  const rows = [
    { set_num: '1', name: 'Millennium Falcon', theme: 'Star Wars', year: 2017, pieces: 7541, market_value: 850, retail_price: 800, retired: 1, retirement_risk_score: 90 },
    { set_num: '2', name: 'City Police Station', theme: 'City', year: 2022, pieces: 668, market_value: 90, retail_price: 100, lego_retiring_soon: 1, retirement_risk_score: 40 },
    { set_num: '3', name: 'Hogwarts Castle', theme: 'Harry Potter', year: 2018, pieces: 6020, market_value: 430, retail_price: 400, retirement_risk_score: 70 },
  ];

  it('sorts by value descending by default and honors value_asc', () => {
    assert.deepEqual(seedFilterSort(rows, { sort: 'value_desc' }).map(r => r.set_num), ['1', '3', '2']);
    assert.deepEqual(seedFilterSort(rows, { sort: 'value_asc' }).map(r => r.set_num), ['2', '3', '1']);
  });

  it('text search matches name, theme and set number across tokens', () => {
    assert.deepEqual(seedFilterSort(rows, { q: 'hogwarts' }).map(r => r.set_num), ['3']);
    assert.deepEqual(seedFilterSort(rows, { q: 'star wars' }).map(r => r.set_num), ['1']);
    assert.equal(seedFilterSort(rows, { q: 'nonexistent' }).length, 0);
  });

  it('filters by theme, retired, retiring and value range', () => {
    assert.deepEqual(seedFilterSort(rows, { theme: 'City' }).map(r => r.set_num), ['2']);
    assert.deepEqual(seedFilterSort(rows, { retired: '1' }).map(r => r.set_num), ['1']);
    assert.deepEqual(seedFilterSort(rows, { retiring: '1' }).map(r => r.set_num), ['2']);
    assert.deepEqual(seedFilterSort(rows, { min_value: '100' }).map(r => r.set_num).sort(), ['1', '3']);
  });

  it('sorts by year, name and roi', () => {
    assert.deepEqual(seedFilterSort(rows, { sort: 'year_desc' }).map(r => r.set_num), ['2', '3', '1']);
    assert.deepEqual(seedFilterSort(rows, { sort: 'az' }).map(r => r.name)[0], 'City Police Station');
    // ROI: #1 = 50/800=.06, #3 = 30/400=.075, #2 = -10/100=-.1 → 3,1,2
    assert.deepEqual(seedFilterSort(rows, { sort: 'roi_desc' }).map(r => r.set_num), ['3', '1', '2']);
  });

  it('does not mutate the input array', () => {
    const copy = rows.slice();
    seedFilterSort(rows, { sort: 'value_asc' });
    assert.deepEqual(rows, copy);
  });
});

describe('computeStoreVerdict', () => {
  const set = { current_value: 100, valuation_method: 'market', market_value: 100 };

  it('returns null without a market value', () => {
    assert.equal(computeStoreVerdict({}, 50), null);
  });

  it('guides without a store price: grab under market minus the threshold', () => {
    const v = computeStoreVerdict(set);
    assert.equal(v.verdict, 'guide');
    assert.equal(v.market, 100);
    assert.equal(v.grabUnder, 85);
    assert.equal(v.estimated, false);
  });

  it('says grab at 15%+ under market (active sets)', () => {
    const v = computeStoreVerdict(set, 80);
    assert.equal(v.verdict, 'grab');
    assert.equal(v.deltaUsd, 20);
  });

  it('retired sets grab at just 5% under', () => {
    const v = computeStoreVerdict({ ...set, retired: true }, 94);
    assert.equal(v.verdict, 'grab');
  });

  it('says walk away when 5%+ over market', () => {
    assert.equal(computeStoreVerdict(set, 106).verdict, 'walk');
  });

  it('fair in the middle band', () => {
    assert.equal(computeStoreVerdict(set, 95).verdict, 'fair');
  });

  it('flags formula-only values as estimated', () => {
    const v = computeStoreVerdict({ current_value: 50, valuation_method: 'formula_bulk' }, 40);
    assert.equal(v.estimated, true);
  });
});

describe('computeSellSignal', () => {
  it('returns null without a current value', () => {
    assert.equal(computeSellSignal({ purchasePrice: 50 }), null);
  });

  it('sell: big gain + falling trend', () => {
    const s = computeSellSignal({ purchasePrice: 100, currentValue: 150, trend: 'falling', retired: true });
    assert.equal(s.signal, 'sell');
    assert.ok(Math.abs(s.roiPct - 50) < 1e-9);
    assert.ok(s.reasons.some(r => /turned down/.test(r)));
  });

  it('sell: big gain + flat trend + thin remaining upside', () => {
    const s = computeSellSignal({ purchasePrice: 100, currentValue: 140, trend: 'stable', forecast2y: 145, retired: true });
    assert.equal(s.signal, 'sell');
    assert.ok(s.reasons.some(r => /upside/.test(r)));
  });

  it('hold: still rising with real forecast upside', () => {
    const s = computeSellSignal({ purchasePrice: 100, currentValue: 140, trend: 'rising', forecast2y: 200, retired: true });
    assert.equal(s.signal, 'hold');
    assert.ok(s.reasons.some(r => /climbing/.test(r)));
  });

  it('hold: not retired yet, modest gain', () => {
    const s = computeSellSignal({ purchasePrice: 100, currentValue: 110, trend: 'stable', retired: false });
    assert.equal(s.signal, 'hold');
    assert.ok(s.reasons.some(r => /retired/.test(r)));
  });

  it('watch: falling without a healthy gain', () => {
    const s = computeSellSignal({ purchasePrice: 100, currentValue: 105, trend: 'falling' });
    assert.equal(s.signal, 'watch');
  });

  it('works without a purchase price (no ROI, trend-only)', () => {
    const s = computeSellSignal({ currentValue: 100, trend: 'falling' });
    assert.equal(s.signal, 'watch');
    assert.equal(s.roiPct, null);
  });

  it('slope stands in for the trend label', () => {
    const s = computeSellSignal({ purchasePrice: 100, currentValue: 150, slopePctPerWeek: -1.2 });
    assert.equal(s.signal, 'sell');
  });
});

import { themeColor, THEME_COLORS } from '../lib/pure.js';

describe('themeColor', () => {
  // Assert against the map rather than hardcoded hex: the exact shades are
  // tuned for contrast (see the ratio test below), so pinning literals here just
  // makes a legitimate accessibility fix look like a regression.
  it('returns the curated pair for a mapped theme', () => {
    assert.deepEqual(themeColor('Star Wars'), THEME_COLORS['Star Wars']);
    assert.deepEqual(themeColor('Technic'), THEME_COLORS['Technic']);
    assert.match(THEME_COLORS['Star Wars'].c, /^#[0-9A-F]{6}$/);
  });

  it('trims and still matches', () => {
    assert.equal(themeColor('  Ninjago  ').c, THEME_COLORS['Ninjago'].c);
  });

  // The whole point of the fallback: themeHue() alone can land on a hue that
  // cannot carry white text (Modular Buildings hashes to 57 = yellow), so the
  // fallback pins lightness rather than passing the raw hue through.
  it('falls back to a dark-enough hue for an unmapped theme', () => {
    const c = themeColor('Modular Buildings');
    assert.match(c.c, /^hsl\(\d+ 42% 38%\)$/);
    assert.match(c.d, /^hsl\(\d+ 44% 28%\)$/);
  });

  it('is stable for the same unmapped theme and differs across themes', () => {
    assert.equal(themeColor('Pirates').c, themeColor('Pirates').c);
    assert.notEqual(themeColor('Pirates').c, themeColor('Vikings').c);
  });

  it('never throws on missing or junk input', () => {
    for (const bad of [undefined, null, '', 0, {}]) {
      const r = themeColor(bad);
      assert.ok(r && typeof r.c === 'string' && typeof r.d === 'string');
    }
  });

  // Deliberate exclusions — bulk non-set rows. If someone "helpfully" adds them
  // later, that is a decision worth making on purpose, not by accident.
  it('leaves the bulk non-set themes unmapped', () => {
    for (const t of ['Gear', 'Books', 'Educational and Dacta']) {
      assert.equal(THEME_COLORS[t], undefined);
    }
  });

  it('every curated colour is dark enough to carry white text', () => {
    const lum = (hex) => {
      const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    };
    for (const [name, { c, d }] of Object.entries(THEME_COLORS)) {
      const ratio = 1.05 / (lum(c) + 0.05);
      assert.ok(ratio >= 4.5, `${name} ${c} contrast ${ratio.toFixed(2)} < 4.5`);
      assert.ok(lum(d) < lum(c), `${name}: d should be deeper than c`);
    }
  });
});

import { normalizeLocale, pickDeviceLocale, lookup, interpolate, SUPPORTED } from '../lib/i18n.js';
import { en } from '../locales/en.js';
import { de } from '../locales/de.js';
import { fr } from '../locales/fr.js';
import { es } from '../locales/es.js';
import { nl } from '../locales/nl.js';

describe('i18n', () => {
  it('narrows a region tag to a supported language', () => {
    assert.equal(normalizeLocale('de-AT'), 'de');   // Austrian German -> German
    assert.equal(normalizeLocale('en_GB'), 'en');   // underscore form
    assert.equal(normalizeLocale('FR'), 'fr');      // uppercase
    assert.equal(normalizeLocale('pl'), null);      // unsupported
    assert.equal(normalizeLocale(''), null);
    assert.equal(normalizeLocale(undefined), null);
  });

  // A device set to [pl, de, en] should get German, not English — walking the
  // list in order is the whole point of reading navigator.languages.
  it('picks the first supported device language, in order', () => {
    assert.equal(pickDeviceLocale(['pl', 'de-DE', 'en-US']), 'de');
    assert.equal(pickDeviceLocale(['pl', 'cs']), 'en');   // none supported -> fallback
    assert.equal(pickDeviceLocale([]), 'en');
    assert.equal(pickDeviceLocale(undefined), 'en');
  });

  it('resolves dotted keys and reports misses as undefined', () => {
    assert.equal(lookup(en, 'nav.vault'), 'Vault');
    assert.equal(lookup(en, 'nav.nope'), undefined);
    assert.equal(lookup(en, 'nav'), undefined);        // a group is not a string
    assert.equal(lookup(en, 'a.b.c.d'), undefined);
    assert.equal(lookup({}, 'nav.vault'), undefined);
  });

  // An absent variable leaves {count} visible. "undefined sets" looks like a
  // broken product; a visible placeholder looks like a bug worth reporting.
  it('interpolates and leaves unknown placeholders intact', () => {
    assert.equal(interpolate('{count} sets', { count: 3 }), '3 sets');
    assert.equal(interpolate('{count} sets', {}), '{count} sets');
    assert.equal(interpolate('{a} and {b}', { a: 1, b: 2 }), '1 and 2');
    assert.equal(interpolate('no vars', { a: 1 }), 'no vars');
  });

  it('offers every supported language a catalogue, named in its own language', () => {
    const codes = SUPPORTED.map((l) => l.code);
    assert.deepEqual(codes, ['en', 'de', 'fr', 'es', 'nl']);
    for (const l of SUPPORTED) assert.ok(l.native && l.english, `${l.code} needs both names`);
    assert.equal(SUPPORTED.find((l) => l.code === 'de').native, 'Deutsch');
  });

  // Every translated key must exist in English, because t() falls back to
  // English before falling back to the raw key. A key that exists ONLY in
  // German means English users see "detail.value" on screen.
  it('has no translation key missing from the English source', () => {
    const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
      typeof v === 'string' ? [`${p}${k}`] : flat(v, `${p}${k}.`));
    const source = new Set(flat(en));
    for (const [code, cat] of Object.entries({ de, fr, es, nl })) {
      for (const key of flat(cat)) {
        assert.ok(source.has(key), `${code}: "${key}" is not in the English source`);
      }
    }
  });

  it('keeps placeholders identical across translations', () => {
    const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
      typeof v === 'string' ? [[`${p}${k}`, v]] : flat(v, `${p}${k}.`));
    const vars = (s) => (s.match(/\{(\w+)\}/g) || []).sort().join(',');
    const source = new Map(flat(en));
    for (const [code, cat] of Object.entries({ de, fr, es, nl })) {
      for (const [key, str] of flat(cat)) {
        assert.equal(vars(str), vars(source.get(key)),
          `${code}: "${key}" placeholders drifted from English`);
      }
    }
  });
});
