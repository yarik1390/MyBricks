import { test, expect } from './fixtures.mjs';

const adminProfile = {
  display_name: 'Admin', handle: 'admin', currency: 'USD', is_guest: false,
  is_admin: true, notify_price_drops: true, portfolio_stats: {},
};

async function openAdmin(page, hash = '#/me/admin') {
  await page.route('**/api/me', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(adminProfile),
  }));
  await page.goto(`/${hash}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.admin-page')).toBeVisible();
}

test('returning to a hub resets its panel to match the default URL', async ({ page }) => {
  await openAdmin(page, '#/me/admin?hub=pricing&view=populate');
  await page.locator('[data-admin-section-link="adminGovernance"]').click();
  await page.locator('[data-admin-section-link="adminPricing"]').click();
  await expect(page).toHaveURL(/hub=pricing$/);
  await expect(page.locator('#pricingCenterPanel')).toBeVisible();
  await expect(page.locator('#pricingPopulatePanel')).toBeHidden();
  await page.goBack();
  await expect(page.locator('#adminGovernance')).toBeVisible();
  await page.goForward();
  await expect(page.locator('#pricingCenterPanel')).toBeVisible();
  await page.reload();
  await expect(page.locator('#pricingCenterPanel')).toBeVisible();
});

test('admin hub and subview URL state survives reload', async ({ page }) => {
  await openAdmin(page, '#/me/admin?hub=governance&view=users');

  await expect(page).toHaveURL(/#\/me\/admin\?hub=governance&view=users$/);
  await expect(page.locator('#adminGovernance')).toBeVisible();
  await expect(page.locator('#govUsersPanel')).toBeVisible();
  await expect(page.locator('[data-admin-section-link="adminGovernance"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-target="govUsersPanel"]')).toHaveAttribute('aria-selected', 'true');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminGovernance')).toBeVisible();
  await expect(page.locator('#govUsersPanel')).toBeVisible();
});

test('admin navigation pushes history for back and forward', async ({ page }) => {
  await openAdmin(page);

  await page.locator('[data-admin-section-link="adminPricing"]').click();
  await expect(page).toHaveURL(/#\/me\/admin\?hub=pricing$/);
  await page.locator('[data-target="pricingPopulatePanel"]').click();
  await expect(page).toHaveURL(/#\/me\/admin\?hub=pricing&view=populate$/);
  await expect(page.locator('#pricingPopulatePanel')).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/#\/me\/admin\?hub=pricing$/);
  await expect(page.locator('#pricingCenterPanel')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/me\/admin$/);
  await expect(page.locator('#adminOverview')).toBeVisible();

  await page.goForward();
  await expect(page.locator('#adminPricing')).toBeVisible();
  await expect(page.locator('#pricingCenterPanel')).toBeVisible();
  await page.goForward();
  await expect(page.locator('#pricingPopulatePanel')).toBeVisible();
});

test('invalid admin hub and subview fall back to safe canonical state', async ({ page }) => {
  await openAdmin(page, '#/me/admin?hub=unknown&view=anything');
  await expect(page).toHaveURL(/#\/me\/admin$/);
  await expect(page.locator('#adminOverview')).toBeVisible();

  await page.goto('/#/me/admin?hub=pricing&view=unknown', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/#\/me\/admin\?hub=pricing$/);
  await expect(page.locator('#adminPricing')).toBeVisible();
  await expect(page.locator('#pricingCenterPanel')).toBeVisible();
});
