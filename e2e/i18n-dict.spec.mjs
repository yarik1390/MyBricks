import { test, expect, SET } from './fixtures.mjs';

// The dictionary must reach the SCREEN, not merely parse. And it must not touch
// data: a LEGO set name is not in the dictionary and has to survive untranslated.
for (const [locale, code] of [['uk-UA','uk'],['de-DE','de'],['nl-NL','nl'],['zh-CN','zh'],['hi-IN','hi'],['ja-JP','ja'],['fr-FR','fr'],['es-ES','es']]) {
  test.describe(() => {
    test.use({ locale });
    test(`${code}: exact-match dictionary translates chrome but not data`, async ({ page }) => {
      await page.goto('/#/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);
      const applied = await page.evaluate(async () => {
        const m = await import('/js/lib/i18n.js');
        return m.hasUiDictionary();
      });
      expect(applied).toBe(true);

      // Something on the page must have changed away from English.
      const body = await page.locator('body').innerText();
      expect(body).not.toContain('Sets owned');
    });
  });
}

test.describe(() => {
  test.use({ locale: 'uk-UA' });
  test('set names and numbers are never translated', async ({ page }) => {
    // The badge only renders with a photo, and the default stub has none.
    await page.route('**/api/sets/75192-1', (r) => r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ set: { ...SET, image_url: '/icon.svg' }, entry: null }),
    }));
    await page.goto('/#/set/75192-1', { waitUntil: 'domcontentloaded' });
    await page.locator('.detail-title').waitFor();
    await page.waitForTimeout(600);
    // Product data must pass through untouched.
    await expect(page.locator('.detail-title')).toContainText('Millennium Falcon');
    await expect(page.locator('.detail-setnum')).toHaveText('75192-1');
  });
});
