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

test('Trophy Shelf edits the stored shelf even while the profile is private', async ({ page }) => {
  await stubMe(page);
  const posts = [];
  await page.route('**/api/users/tester/profile', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Profile not found"}' }));
  await page.route('**/api/users/tester/showcase', (route) => {
    if (route.request().method() === 'POST') {
      posts.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ showcase: [
      { set_num: '10497-1', name: 'Galaxy Explorer', theme: 'Icons', market_value: 110 },
      { set_num: '21318-1', name: 'Tree House', theme: 'Ideas', market_value: 290 },
    ] }) });
  });
  await page.goto('/#/me', { waitUntil: 'domcontentloaded' });
  await page.locator('#publicProfileRow').click();
  const sheet = page.locator('#publicProfileSheet');
  await expect(sheet).toBeVisible();
  // The real shelf, not an empty stand-in: removing one keeps the other.
  await expect(sheet.locator('.remove-trophy-btn')).toHaveCount(2);
  await sheet.locator('.remove-trophy-btn[data-set="10497-1"]').click();
  await expect.poll(() => posts.at(-1)).toEqual({ set_nums: ['21318-1'] });
});

test('Trophy Shelf stays closed when the shelf could not load', async ({ page }) => {
  await stubMe(page);
  const posts = [];
  await page.route('**/api/users/tester/showcase', (route) => {
    if (route.request().method() === 'POST') posts.push(route.request().postData());
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });
  });
  await page.goto('/#/me', { waitUntil: 'domcontentloaded' });
  await page.locator('#publicProfileRow').click();
  await expect(page.locator('#publicProfileSheet')).toBeVisible();
  // Adding a trophy would have replaced the stored shelf with just that set.
  await expect(page.locator('#addTrophyBtn')).toHaveCount(0);
  expect(posts).toEqual([]);
});

// Owned loose minifigures, paged like GET /api/minifigs (100 per page).
async function stubOwnedFigs(page, count) {
  const requested = [];
  await page.route('**/api/minifigs?*', (route) => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get('offset') || 0);
    requested.push(offset);
    const rows = Array.from({ length: Math.max(0, Math.min(100, count - offset)) }, (_, i) => ({
      fig_num: `fig-${offset + i}`, name: `Fig ${offset + i}`, owned_qty: 1, current_value: 2, purchase_price: 1,
    }));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ minifigs: rows, total: count, hasMore: offset + rows.length < count }) });
  });
  return requested;
}

test('insurance report builds a real PDF on the device for Pro members', async ({ page }) => {
  await stubMe(page, { is_supporter: true });
  await stubOwnedFigs(page, 0);
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
  await stubOwnedFigs(page, 0);
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

test('insurance report counts every owned minifigure and what was paid for it', async ({ page }) => {
  await stubMe(page, { is_supporter: true });
  const requested = await stubOwnedFigs(page, 601);
  await page.goto('/#/me/insurance', { waitUntil: 'domcontentloaded' });
  const preview = page.locator('.bv-insprev');
  // All seven pages, not a silent stop at 500.
  await expect(preview).toContainText('601 minifigures');
  expect(requested).toEqual([0, 100, 200, 300, 400, 500, 600]);
  await page.getByRole('switch', { name: 'Include prices paid' }).click();
  // $700 for the set + $1 for each of the 601 figures.
  await expect(page.locator('.bv-insprev__paid')).toContainText('$1,301');
});

test('insurance report refuses to export a partial collection', async ({ page }) => {
  await stubMe(page, { is_supporter: true });
  let figsFail = true;
  await page.route('**/api/minifigs?*', (route) => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset') || 0);
    if (figsFail && offset === 100) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' });
    const rows = Array.from({ length: offset === 0 ? 100 : 5 }, (_, i) => ({ fig_num: `fig-${offset + i}`, name: `Fig ${offset + i}`, owned_qty: 1, current_value: 2 }));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ minifigs: rows, total: 105, hasMore: offset === 0 }) });
  });
  await page.goto('/#/me/insurance', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.bv-insurance__empty[role=alert]')).toContainText('Couldn\'t load all your holdings');
  await expect(page.locator('.bv-insprev')).toHaveCount(0);
  await expect(page.locator('#insSave, #insShare')).toHaveCount(0);

  figsFail = false;
  await page.locator('#insRetry').click();
  await expect(page.locator('.bv-insprev')).toContainText('105 minifigures');
  await expect(page.locator('#insSave')).toBeEnabled();
});

test('insurance report does not mistake a Vault that failed to load for an empty one', async ({ page }) => {
  await stubMe(page, { is_supporter: true });
  await stubOwnedFigs(page, 0);
  await page.route('**/api/collection', (route) => (route.request().method() === 'GET'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
    : route.fallback()));
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(async () => (await import('/js/state.js')).state.portfolio?._loadFailed)).toBe(true);
  await page.goto('/#/me/insurance', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.bv-insurance__empty[role=alert]')).toContainText('Couldn\'t load all your holdings');
  await expect(page.locator('#insSave')).toHaveCount(0);
});
