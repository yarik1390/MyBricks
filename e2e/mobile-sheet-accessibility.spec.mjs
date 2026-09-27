import { test, expect } from './fixtures.mjs';

test.use({ viewport: { width: 390, height: 844 } });

test('sheets name and focus each step and return focus to their trigger', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.locator('#setList')).toBeVisible();
  const trigger = page.locator('#nav [data-route="/wishlist"]');
  await trigger.focus();
  await page.evaluate(async () => {
    const { showSheet } = await import('/js/components/sheet.js');
    showSheet('<h2>Add to your vault</h2><button id="stepNext">Enter set number</button>');
  });
  const sheet = page.locator('#sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAccessibleName('Add to your vault');
  await expect.poll(() => sheet.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.evaluate(async () => {
    const { showSheet } = await import('/js/components/sheet.js');
    showSheet('<h2>Set number</h2><input id="stepInput" aria-label="Set number">');
  });
  await expect(page.locator('#stepInput')).toBeVisible();
  await expect(sheet).toHaveAccessibleName('Set number');
  await expect.poll(() => sheet.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('replacing a sheet preserves scroll and loading content retains focus', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.locator('#bvFab')).toBeVisible();
  await page.evaluate(async () => {
    document.body.style.minHeight = '2400px';
    window.scrollTo(0, 300);
    const { showSheet } = await import('/js/components/sheet.js');
    document.querySelector('#bvFab').focus({ preventScroll: true });
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
