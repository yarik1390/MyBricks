import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const adminView = read('public/js/views/me-admin.js');
const adminConfig = read('public/js/views/me-admin-config.js');

describe('admin usability controls', () => {
  it('makes PriceCharting and BrickPicker process actions reachable', () => {
    assert.match(adminView, /'pricecharting-verify': 'pricechartingVerify'/);
    assert.match(adminView, /'pricecharting-enrich': 'pricecharting'/);
    assert.match(adminView, /'brickpicker-enrich': 'brickpicker'/);
    assert.match(adminView, /data-process-run=/);

    assert.match(adminConfig, /pricechartingVerify:\s*\{[\s\S]*?url: '\/api\/admin\/run-pricecharting-verify'/);
    assert.match(adminConfig, /pricecharting:\s*\{[\s\S]*?url: '\/api\/admin\/jobs\/pricecharting-enrich\?limit=10'/);
    assert.match(adminConfig, /brickpicker:\s*\{[\s\S]*?url: '\/api\/admin\/jobs\/brickpicker-enrich\?limit=10'/);
  });

  it('links rendered guidance to real sections and subtabs', () => {
    assert.doesNotMatch(adminView, /(?:the |from |through |→ )Activity tab/i);
    assert.doesNotMatch(adminView, /(?:the |from |through |→ )Populate tab/i);
    assert.match(adminView, /data-admin-section-jump="adminOverview" data-scroll-target="adminActivityHeading"/);
    assert.match(adminView, /data-admin-section-jump="adminPricing" data-open-subtab="pricingPopulatePanel"/);
    assert.match(adminView, /function jumpToAdminSection\(btn\)/);
    assert.match(adminView, /function activateAdminSubtab\(btn\)/);
    assert.match(adminView, /localized === key \? \(ADMIN_JOB_TOOLS\[type\]\?\.label \|\| type\)/);
  });

  it('does not present stale observations as current readiness', () => {
    assert.match(adminView, /function displayedProviderHealth\(row, intended\)/);
    assert.match(adminView, /label: 'Evidence stale'/);
    assert.match(adminView, /last observation is too old to certify current health/);
    assert.match(adminView, /health: displayedProviderHealth\(row, intended\)/);
  });
});
