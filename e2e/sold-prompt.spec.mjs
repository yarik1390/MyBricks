import { test, expect, SET } from './fixtures.mjs';

// Removing a set asks "Did you sell it?" first, so a sale price reaches the
// anonymized community sold prices instead of being thrown away.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('bv_onboarded_v1', '1');
    localStorage.setItem('bv_setup_v1', '1');
  });
  await page.route('**/api/sets/75192-1*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ set: SET, entry: { id: 1, set_num: SET.set_num, quantity: 1, purchase_price: 700, condition: 'new' } }),
  }));
});

test('remove offers to record the sale first', async ({ page }) => {
  await page.goto('/#/set/75192-1/edit', { waitUntil: 'domcontentloaded' });
  await page.locator('#qeRemove').click();
  await expect(page.locator('#sheet')).toContainText('Did you sell it?');
  await page.locator('#rmSold').click();
  await expect(page.locator('#saleForm')).toBeVisible();
  await expect(page.locator('#exitSoldPrice')).toBeVisible();
});

test('"just remove" still removes, and cancel keeps the set', async ({ page }) => {
  const deletes = [];
  page.on('request', (req) => { if (req.method() === 'DELETE' && req.url().includes('/api/collection/')) deletes.push(req.url()); });
  await page.goto('/#/set/75192-1/edit', { waitUntil: 'domcontentloaded' });
  await page.locator('#qeRemove').click();
  await page.locator('#rmCancel').click();
  expect(deletes).toHaveLength(0);
  await page.goto('/#/set/75192-1/edit', { waitUntil: 'domcontentloaded' });
  await page.locator('#qeRemove').click();
  await page.locator('#rmJust').click();
  await expect.poll(() => deletes.length).toBe(1);
});
