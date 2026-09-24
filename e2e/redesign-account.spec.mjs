import { test, expect } from './fixtures.mjs';

// Profile & account area of the 2026 redesign: the grouped Profile hub and its
// sheets, the on-device insurance PDF (Pro), and the Pro screen.

const ME = {
  display_name: 'Test Collector', handle: 'tester', currency: 'USD', retail_market: 'FR', is_guest: false,
  notify_price_drops: true, is_public: false, portfolio_stats: { set_count: 1, total_value: 850, total_paid: 700 },
};

async function stubMe(page, extra = {}) {
  const patches = [];
  await page.route('**/api/me', (route) => {
    if (route.request().method() === 'PATCH') {
      patches.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...ME, ...extra }) });
  });
  return patches;
}

test('Profile hub groups every setting and keeps the long tail one tap away', async ({ page }) => {
  const patches = await stubMe(page);
  await page.goto('/#/me', { waitUntil: 'domcontentloaded' });
  const nav = page.locator('.profile-settings-nav');
  for (const heading of ['Collection', 'Preferences', 'Data', 'Play', 'Membership', 'Account']) {
    await expect(nav.getByRole('heading', { name: heading })).toBeVisible();
  }
  await expect(page.locator('.bv-ident__name')).toHaveText('Test Collector');
  await expect(page.locator('[data-testid="portfolio-change"]')).toContainText('+21.4%');
  // Owner group only for admins.
  await expect(nav.getByRole('heading', { name: 'Owner' })).toHaveCount(0);

  // Appearance: theme, style, view mode, language, sounds and assistant.
  await page.locator('#appearanceRow').click();
  const sheet = page.locator('#appearanceSheet');
  await sheet.locator('#themeSeg [data-value="dark"]').click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('bv_theme'))).toBe('dark');
  await expect(sheet.locator('#modeSeg [data-value="simple"]')).toBeVisible();
  await expect(sheet.locator('#languageSelect')).toBeVisible();
  await expect(sheet.getByRole('switch', { name: 'Celebration sounds' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Currency & region saves through /api/me.
  await page.locator('#currencyRow').click();
  await page.locator('#currencySelect').selectOption('EUR');
  await expect.poll(() => patches.at(-1)).toEqual({ currency: 'EUR' });
});

test('insurance report builds a real PDF on the device for Pro members', async ({ page }) => {
  await stubMe(page, { is_supporter: true });
  await page.goto('/#/me/insurance', { waitUntil: 'domcontentloaded' });
  const preview = page.locator('.bv-insprev');
  await expect(preview).toContainText('COLLECTION VALUATION');
  await expect(preview).toContainText('Millennium Falcon');
  await expect(preview).toContainText('$850');
  // Prices paid are opt-in.
  await expect(preview).not.toContainText('Total paid');
  await page.getByRole('switch', { name: 'Include prices paid' }).click();
  await expect(page.locator('.bv-insprev')).toContainText('Total paid');
  await page.getByRole('switch', { name: 'Include set photos' }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#insSave').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^bricksvault-insurance-\d{4}-\d{2}-\d{2}\.pdf$/);
  const path = await download.path();
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
  expect(bytes.toString('latin1')).toContain('(Millennium Falcon) Tj');
  expect(bytes.toString('latin1')).toMatch(/%%EOF\n$/);
});

test('insurance report preview is open to everyone; export points to Pro', async ({ page }) => {
  await stubMe(page, { is_supporter: false });
  await page.goto('/#/me/insurance', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.bv-insprev')).toBeVisible();
  await expect(page.locator('#insSave')).toHaveCount(0);
  await expect(page.locator('#insUnlock')).toHaveAttribute('href', '#/pro');
});

test('Pro on the web shows the benefits and the Patreon route; members see their status', async ({ page }) => {
  await stubMe(page);
  await page.goto('/#/pro', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.bv-probenefits li')).toHaveCount(5);
  await expect(page.getByRole('link', { name: 'Support on Patreon' })).toHaveAttribute('href', /patreon\.com/);

  await page.evaluate(async () => {
    const { state } = await import('/js/state.js');
    state.me = { ...state.me, is_supporter: true };
    const { renderPro } = await import('/js/views/pro.js');
    await renderPro();
  });
  await expect(page.locator('.bv-proactive')).toContainText('You have Pro');
});
