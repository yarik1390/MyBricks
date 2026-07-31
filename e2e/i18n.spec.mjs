import { test, expect } from './fixtures.mjs';
test.use({ locale: 'de-DE' });
test('device locale drives the UI language', async ({ page }) => {
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#nav .nav-tab[data-route="/"] .nav-label')).toHaveText('Tresor');
  await expect(page.locator('#nav .nav-tab[data-route="/add"] .nav-label')).toHaveText('Katalog');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('de');
});

// Non-Latin scripts and the newly added languages — a catalogue that parses is
// not the same as one that reaches the screen.
for (const [locale, code, vault, catalog] of [
  ['uk-UA', 'uk', 'Сховище', 'Каталог'],
  ['zh-CN', 'zh', '收藏库', '目录'],
  ['ja-JP', 'ja', 'コレクション', 'カタログ'],
  ['hi-IN', 'hi', 'संग्रह', 'कैटलॉग'],
]) {
  test.describe(() => {
    test.use({ locale });
    test(`renders ${code} from the device locale`, async ({ page }) => {
      await page.goto('/#/', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#nav .nav-tab[data-route="/"] .nav-label')).toHaveText(vault);
      await expect(page.locator('#nav .nav-tab[data-route="/add"] .nav-label')).toHaveText(catalog);
      expect(await page.evaluate(() => document.documentElement.lang)).toBe(code);
    });
  });
}
