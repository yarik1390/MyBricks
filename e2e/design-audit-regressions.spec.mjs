import { test, expect } from './fixtures.mjs';

const mobile = { width: 390, height: 844 };

test.describe('design audit regressions', () => {
  test.use({ viewport: mobile });

  test('catalog exposes one compact action row and moves detailed controls into sheets', async ({ page }) => {
    await page.goto('/#/add', { waitUntil: 'domcontentloaded' });

    const toolbar = page.locator('.catalog-primary-toolbar');
    await expect(toolbar).toBeVisible();
    await expect(toolbar.getByRole('button', { name: /^Filters/ })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: /^Sort/ })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: /^View/ })).toBeVisible();
    await expect(page.locator('[data-csort-base]')).toHaveCount(0);
    await expect(page.locator('[data-retired]')).toHaveCount(0);

    await toolbar.getByRole('button', { name: /^Sort/ }).click();
    await expect(page.getByRole('heading', { name: 'Sort catalog' })).toBeVisible();
  });

  test('search and manual-entry controls have stable accessible names and form metadata', async ({ page }) => {
    await page.goto('/#/minifigs', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('searchbox', { name: 'Search minifigures' })).toHaveAttribute('name', 'minifig_search');

    await page.goto('/#/build', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('searchbox', { name: 'Search buildable sets' })).toHaveAttribute('name', 'build_search');

    await page.goto('/#/pile', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('textbox', { name: 'Set number or barcode' })).toHaveAttribute('name', 'set_identifier');
  });

  test('profile gain and loss labels, signs, colors, and arrows agree', async ({ page }) => {
    await page.route('**/api/me', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        display_name: 'Collector', handle: 'collector', currency: 'USD', notify_price_drops: true,
        portfolio_stats: { set_count: 2, total_value: 900, total_paid: 1000 },
      }),
    }));
    await page.goto('/#/me', { waitUntil: 'domcontentloaded' });

    const change = page.locator('[data-testid="portfolio-change"]');
    await expect(change).toContainText('Loss');
    await expect(change).toContainText('-$100');
    await expect(change).toContainText('-10.0%');
    await expect(change.locator('.arrow')).toHaveText('▼');
    await expect(change).toHaveClass(/is-loss/);
  });

  test('admin defaults to Needs action and service controls have descriptive names', async ({ page }) => {
    await page.route('**/api/me', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ display_name: 'Admin', handle: 'admin', currency: 'USD', is_admin: true, notify_price_drops: true, portfolio_stats: {} }),
    }));
    await page.goto('/#/me/admin', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('[data-service-tab="attention"]')).toHaveAttribute('aria-selected', 'true');
    const unnamed = await page.locator('.admin-dashboard-page button').evaluateAll(buttons => buttons.filter(button => {
      const text = button.textContent?.trim();
      return !text && !button.getAttribute('aria-label') && !button.getAttribute('title');
    }).length);
    expect(unnamed).toBe(0);
  });

  test('data restore uses a full-size action and an explicit confirmation sheet', async ({ page }) => {
    await page.route('**/api/me/backups*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ backups: ['2026-08-24'] }),
      });
    });
    await page.goto('/#/me/data', { waitUntil: 'domcontentloaded' });

    const restore = page.getByRole('button', { name: 'Restore snapshot from 2026-08-24' });
    await expect(restore).toBeVisible();
    expect((await restore.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await restore.click();
    await expect(page.getByRole('heading', { name: 'Restore 2026-08-24?' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restore snapshot', exact: true })).toBeVisible();
  });

  test('mobile interactive controls meet the 44px target floor on priority routes', async ({ page }) => {
    for (const route of ['/', '/#/add', '/#/pile', '/#/me', '/#/me/integrations']) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      const undersized = await page.locator('button:visible, input:visible, select:visible, a.setting-row:visible').evaluateAll(elements => elements
        .map(element => ({
          label: element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 40) || element.id,
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
        }))
        .filter(item => item.width > 0 && item.height > 0 && (item.width < 44 || item.height < 44)));
      expect(undersized, `${route}: ${JSON.stringify(undersized)}`).toEqual([]);
    }
  });
});