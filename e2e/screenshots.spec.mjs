import { test } from './fixtures.mjs';

const { describe } = test;

// Captures the PWA manifest / store-listing screenshots against the stubbed
// e2e server (same fixtures as the smoke suite, so no live services and
// deterministic data). Output sizes must match manifest.json's `sizes`:
// narrow = 393×852 css @2x → 786×1704 px, wide = 1280×800 @1x.
// Run via e2e/screenshots.config.mjs (NOT part of the smoke suite).

test.use({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });

test('vault (narrow)', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('h1.brand-name').waitFor();
  await page.waitForTimeout(600); // hero value animation settles
  await page.screenshot({ path: 'public/screenshots/vault-narrow.png' });
});

test('set detail (narrow)', async ({ page }) => {
  await page.goto('/#/set/75192-1', { waitUntil: 'domcontentloaded' });
  await page.getByText('Millennium Falcon').first().waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'public/screenshots/detail-narrow.png' });
});

describe('wide', () => {
  test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  test('catalog (wide)', async ({ page }) => {
    await page.goto('/#/add', { waitUntil: 'domcontentloaded' });
    await page.locator('#catalogGrid').waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'public/screenshots/catalog-wide.png' });
  });
});
