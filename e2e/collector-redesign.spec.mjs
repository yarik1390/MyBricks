import { test, expect } from './fixtures.mjs';

test.use({ viewport: { width: 390, height: 844 } });
test('collector navigation, permanent search, manual add, and room entry', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.locator('#collectorAdd')).toBeVisible();
  await expect(page.locator('#nav .nav-tab:visible')).toHaveCount(4);
  await expect(page.locator('#nav [aria-current="page"]')).toHaveAttribute('data-route', '/');
  await expect(page.locator('#advisorFab')).toBeHidden();
  await expect(page.locator('#portfolioSearch')).toBeVisible();
  await expect(page.locator('.collector-market')).not.toHaveAttribute('open');
  await page.locator('#portfolioSearch').fill('no-such-set');
  await expect(page.locator('#clearVaultSearch')).toBeVisible();
  await expect(page.getByText('Your collection starts here')).toHaveCount(0);
  await page.locator('#clearVaultSearch').click();
  await expect(page.locator('#setList .set-list-card')).toHaveCount(1);
  await page.locator('#portfolioSearch').blur();
  await page.locator('#collectorAdd').click();
  await page.locator('#collectorManual').click();
  await page.locator('#collectorSetNumber').fill('75192');
  await page.locator('#collectorLookup button').click();
  await expect(page).toHaveURL(/#\/set\/75192-1$/);
  await expect(page.locator('#collectorAdd')).toBeHidden();
  await page.locator('#nav [data-route="/add"]').click();
  await expect(page.locator('#catalogSearch')).toBeVisible();
  await expect(page.locator('#nav [aria-current="page"]')).toHaveAttribute('data-route', '/add');
  await expect(page.locator('.set-card')).toBeVisible();
  await page.screenshot({ path: 'audit/collector-discover-mobile.png' });
  await page.locator('#nav [data-route="/"]').click();
  await expect(page.locator('#setList .set-list-card')).toBeVisible();
  await page.screenshot({ path: 'audit/collector-vault-mobile.png' });
  await page.locator('[data-vault-view="room"]').click();
  await expect(page.locator('#roomStage')).toBeAttached();
  await expect(page.locator('#collectorAdd')).toBeHidden();
  await page.locator('[data-vault-view="grid"]').click();
  await expect(page.locator('#roomStage')).toHaveCount(0);
});

test('pinned collection returns from Vault and filters retain their context', async ({ page }) => {
  const id = 'a41165ca-f594-4cf5-ad3c-49dd1b75ce5c';
  await page.route('**/api/subcollections', route => route.fulfill({ json: { subcollections: [{ id, name: 'Space shelf', set_nums: ['75192-1', '10497-1'], revision: 1 }] } }));
  await page.goto('/#/collections');
  await page.locator('[data-pin]').click();
  await expect(page.locator('[data-pin]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#nav [data-route="/"]').click();
  await expect(page.locator('.collector-pins')).toContainText('Space shelf');
  await page.locator('#portfolioSearch').fill('Falcon');
  await expect(page.locator('#setList .set-list-card')).toHaveCount(1);
  await page.locator('#portfolioSearch').blur();
  await page.locator('#nav [data-route="/wishlist"]').click();
  await expect(page.locator('#nav [aria-current="page"]')).toHaveAttribute('data-route', '/wishlist');
  await page.locator('#nav [data-route="/"]').click();
  await expect(page.locator('#portfolioSearch')).toHaveValue('Falcon');
});

test('dark theme and large text retain usable navigation', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('bv_theme', 'dark'));
  await page.goto('/#/');
  await expect(page.locator('#collectorAdd')).toBeVisible();
  await expect(page.locator('#setList .set-list-card')).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
  await expect(page.locator('#nav .nav-tab:visible')).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'audit/collector-dark-mobile.png' });
});
