import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const onboarding = readFileSync(new URL('../../public/js/components/onboarding.js', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

describe('current first-run onboarding', () => {
  it('separates the investor display mode from the paid Pro entitlement', () => {
    assert.match(onboarding, /'Investor', 'Full investor view — market value, ROI and 2-year projections\.'/);
    assert.doesNotMatch(onboarding, /opt\('pro', '📈', 'Pro'/);
    assert.match(onboarding, /<h3 id="bv-setup-title">BricksVault Pro ⭐<\/h3>/);
  });

  it('keeps onboarding copy within the translated exact-match catalog', () => {
    assert.match(onboarding, /Swipe through to see where everything lives\./);
    assert.match(onboarding, /Search 27,000\+ sets and add them to your vault\./);
    assert.match(onboarding, /Point it at a box barcode — instant match\./);
    assert.match(onboarding, /Start privately on this device — sign in later if you want to sync\./);
  });

  it('exposes meaningful progress and labels for both dialogs', () => {
    assert.match(onboarding, /role="progressbar" aria-label="Tour progress"/);
    assert.match(onboarding, /aria-valuemax="\$\{STEPS\.length\}" aria-valuenow="\$\{idx \+ 1\}"/);
    assert.match(onboarding, /role="progressbar" aria-label="Setup progress"/);
    assert.match(onboarding, /aria-valuemax="\$\{SETUP_STEPS\.length\}" aria-valuenow="\$\{suIdx \+ 1\}"/);
    assert.match(onboarding, /setAttribute\('aria-labelledby', 'bv-tour-title'\)/);
    assert.match(onboarding, /setAttribute\('aria-labelledby', 'bv-setup-title'\)/);
    assert.equal((onboarding.match(/<h3 id="bv-setup-title">/g) || []).length, 6);
  });

  it('moves focus into each newly rendered setup step', () => {
    assert.match(onboarding, /function suRender\(\{ focusLanguage = null, focusStep = false \} = \{\}\)/);
    assert.match(onboarding, /else if \(focusStep\) \{[\s\S]*?#bv-setup-title[\s\S]*?focus\(\{ preventScroll: true \}\)/);
    assert.match(onboarding, /suRender\(\{ focusStep: true \}\)/);
  });

  it('uses resilient touch targets, visible keyboard focus, and reduced-motion fallbacks', () => {
    assert.match(onboarding, /\.bv-tour-skip\{[^}]*min-height:44px/);
    assert.match(onboarding, /\.bv-tour-btn\{[^}]*min-height:44px/);
    assert.match(onboarding, /\.bv-lang\{[^}]*min-height:44px/);
    assert.match(onboarding, /\.bv-tgl\{[^}]*height:44px/);
    assert.match(onboarding, /\.bv-setup-btn\{[^}]*min-height:44px/);
    assert.match(onboarding, /\.bv-tour button:focus-visible/);
    assert.match(onboarding, /\.bv-setup button:focus-visible/);
    assert.match(onboarding, /@media \(prefers-reduced-motion: reduce\)/);
  });

  it('keeps optional billing contextual instead of presenting a dead web action', () => {
    assert.match(onboarding, /isNativeBilling\(\) \? '<button class="bv-setup-ghost" data-act="support">See Pro options →<\/button>' : ''/);
    assert.match(onboarding, /if \(!isNativeBilling\(\)\) \{/);
  });

  it('bumps the static cache for the onboarding update', () => {
    assert.match(serviceWorker, /const VERSION = "v481"/);
  });
});
