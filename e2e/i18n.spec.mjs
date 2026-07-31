import { test, expect } from './fixtures.mjs';
test.use({ locale: 'de-DE' });
test('device locale drives the UI language', async ({ page }) => {
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#nav .nav-tab[data-route="/"] .nav-label')).toHaveText('Tresor');
  await expect(page.locator('#nav .nav-tab[data-route="/add"] .nav-label')).toHaveText('Katalog');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('de');
});
