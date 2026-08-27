import { test, expect } from './fixtures.mjs';

test.use({ viewport: { width: 390, height: 844 } });

const adminProfile = {
  display_name: 'Admin', handle: 'admin', currency: 'USD', is_guest: false,
  is_admin: true, notify_price_drops: true, portfolio_stats: {},
};

test('admin audit: section navigation is progressive and service rows meet the touch floor', async ({ page }) => {
  await page.route('**/api/me', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(adminProfile),
  }));
  await page.route('**/api/admin/integrations', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ services: [{ id: 'rebrickable', status: 'healthy', enabled: true }] }),
  }));

  await page.goto('/#/me/admin', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.admin-section.is-active')).toHaveCount(1);
  await expect(page.locator('#adminServices')).toBeVisible();
  await page.locator('[data-admin-section-link="adminUsers"]').click();
  await expect(page.locator('#adminUsers')).toBeVisible();
  await expect(page.locator('#adminServices')).toBeHidden();

  const navTargets = await page.locator('[data-admin-section-link]').evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().height));
  expect(Math.min(...navTargets)).toBeGreaterThanOrEqual(44);

  await page.locator('[data-admin-section-link="adminServices"]').click();
  const serviceSummary = page.locator('.admin-service-summary').first();
  if (await serviceSummary.count()) {
    expect((await serviceSummary.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
});

test('integrations audit: webhook actions stack and all audited controls meet the touch floor', async ({ page }) => {
  await page.route('**/api/me', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ...adminProfile, is_admin: false, discord_webhook_url: 'https://discord.com/api/webhooks/test' }),
  }));

  await page.goto('/#/me/integrations', { waitUntil: 'domcontentloaded' });

  const selectors = [
    '#discordWebhook', '#discordWebhookSave', '#discordWebhookClear',
    '#bricksetUsername', '#bricksetPassword', '#bricksetConnectBtn',
  ];
  for (const selector of selectors) {
    const control = page.locator(selector);
    await expect(control).toBeVisible();
    expect((await control.boundingBox()).height, selector).toBeGreaterThanOrEqual(44);
  }

  const webhook = await page.locator('#discordWebhook').boundingBox();
  const save = await page.locator('#discordWebhookSave').boundingBox();
  expect(save.y).toBeGreaterThanOrEqual(webhook.y + webhook.height - 1);
});

test('data audit: restore and file-picker actions meet the touch floor', async ({ page }) => {
  await page.route('**/api/me/backups', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ backups: ['2026-08-23'] }),
  }));

  await page.goto('/#/me/data', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.backup-restore')).toBeVisible();
  for (const selector of ['.backup-restore', '.csv-file-label']) {
    const controls = page.locator(selector);
    const count = await controls.count();
    expect(count, selector).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      expect((await controls.nth(i).boundingBox()).height, `${selector}[${i}]`).toBeGreaterThanOrEqual(44);
    }
  }
});