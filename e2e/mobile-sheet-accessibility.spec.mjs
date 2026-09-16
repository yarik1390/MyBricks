import { test, expect } from './fixtures.mjs';

test.use({ viewport: { width: 390, height: 844 } });

test('Add sheet names and focuses each step and returns to its original trigger', async ({ page }) => {
  await page.goto('/#/');
  const add = page.locator('#collectorAdd');
  await add.focus();
  await add.press('Enter');
  const sheet = page.locator('#sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAccessibleName(/.+/);
  await expect.poll(() => sheet.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.locator('#collectorManual').focus();
  await page.locator('#collectorManual').press('Enter');
  await expect(page.locator('#collectorSetNumber')).toBeVisible();
  await expect(sheet).toHaveAccessibleName(/.+/);
  await expect.poll(() => sheet.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(add).toBeFocused();
});

test('replacing a sheet preserves scroll and loading content retains focus', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.locator('#collectorAdd')).toBeVisible();
  await page.evaluate(async () => {
    document.body.style.minHeight = '2400px';
    window.scrollTo(0, 300);
    const { showSheet } = await import('/js/components/sheet.js');
    document.querySelector('#collectorAdd').focus({ preventScroll: true });
    showSheet('<h2>First step</h2><button>Next</button>');
    showSheet('<h2>Second step</h2><button>Save</button>');
  });
  await page.evaluate(async () => (await import('/js/components/sheet.js')).sheetLoading('Saving'));
  await expect(page.locator('#sheet')).toHaveAccessibleName('Saving');
  await expect.poll(() => page.locator('#sheet').evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');
  await expect.poll(() => page.locator('#sheet').evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(300);
});
