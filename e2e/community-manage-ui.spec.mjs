import { test, expect, SET } from './fixtures.mjs';

test.describe('set detail Community and Manage tabs', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((set) => {
      localStorage.removeItem('bv_session');
      localStorage.setItem('bv_onboarded_v1', '1');
      localStorage.setItem('bv_setup_v1', '1');
      localStorage.setItem('bv_guest_collection', JSON.stringify([{
        id: `guest:${set.set_num}`,
        set_num: set.set_num,
        name: set.name,
        theme: set.theme,
        quantity: 1,
        condition: 'new',
        purchase_price: 700,
        current_value: 850,
        blended_value: 850,
        added_at: new Date().toISOString(),
        image_url: null,
      }]));
    }, SET);
    await page.goto(`/#/set/${SET.set_num}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.detail-tabs')).toBeVisible();
  });

  test('Community has clear contribution hierarchy and one intentional empty state', async ({ page }) => {
    await page.locator('[role="tab"][data-tab="community"]').click();
    await expect(page).toHaveURL(new RegExp(`/set/${SET.set_num}/community$`));

    const tab = page.locator('.community-tab');
    await expect(tab.locator('h2')).toHaveText('Community record');
    await expect(tab.locator('.community-actions .contrib-act')).toHaveCount(3);
    await expect(tab.locator('.community-mode-note')).toContainText('reviewed');
    await expect(tab.locator('.community-empty')).toHaveCount(1);

    const geometry = await tab.evaluate((node) => ({
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      buttons: [...node.querySelectorAll('.contrib-act')].map((el) => el.getBoundingClientRect().height),
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
    expect(geometry.buttons.every((height) => height >= 44)).toBe(true);
  });

  test('Manage groups existing fields and keeps destructive action separate', async ({ page }) => {
    await page.locator('[role="tab"][data-tab="manage"]').evaluate((el) => el.click());
    await expect(page.locator('.manage-tab')).toBeVisible();
    await expect(page.locator('.detail-page-container')).toHaveAttribute('data-detail-tab', 'manage');
    await expect(page.locator('.detail-action-bar')).toBeHidden();

    const tab = page.locator('.manage-tab');
    await expect(tab.locator('fieldset.manage-group')).toHaveCount(3);
    await expect(tab.locator('#mPrice')).toBeVisible();
    await expect(tab.locator('#mCondition')).toBeVisible();
    await expect(tab.locator('#mNotes')).toBeVisible();
    await expect(tab.locator('.manage-danger-zone #mRemove')).toBeVisible();

    const geometry = await tab.evaluate((node) => ({
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      controls: [...node.querySelectorAll('.field input, .field select, .field textarea')]
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => el.getBoundingClientRect().height),
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
    expect(
      geometry.controls.every((height) => height >= 43.9),
      `control heights: ${geometry.controls.join(', ')}`,
    ).toBe(true);
  });
});
