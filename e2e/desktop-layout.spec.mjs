import { test, expect } from './fixtures.mjs';

// Computer-sized windows get a labelled sidebar, a Vault table, centred
// dialogs and keyboard shortcuts; phones keep the bottom bar and none of it.

test.describe('desktop (1440 wide)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('sidebar shows labels, search and Explore links', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const nav = page.locator('#nav');
    await expect(nav.locator('.bv-side__search')).toBeVisible();
    await expect(nav.locator('.nav-tab[data-route="/add"] .nav-label')).toBeVisible();
    await expect(nav.locator('a.bv-side__link[href="#/insights"]')).toBeVisible();
    const box = await nav.boundingBox();
    expect(box.width).toBeGreaterThan(200);
  });

  test('Vault list is a table with year, pieces and paid columns', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.vault-list-head')).toBeVisible();
    const row = page.locator('.vault-row').first();
    await expect(row.locator('.bv-setrow__col--year')).toHaveText('2017');
    await expect(row.locator('.bv-setrow__col--pcs')).toBeVisible();
    await expect(row.locator('.bv-setrow__col--paid')).toHaveText('$700');
  });

  test('table headings sort the Vault', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('.vault-row').first().waitFor();
    const year = page.locator('.vault-list-head [data-vault-sort="year_desc"]');
    await year.click();
    await expect(year).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#vaultSortBtn')).toContainText('Year');
  });

  test('Insights lays out as a dashboard', async ({ page }) => {
    await page.goto('/#/insights', { waitUntil: 'domcontentloaded' });
    const stats = page.locator('.insights-cell--stats');
    await stats.waitFor();
    const chart = await page.locator('.insights-cell--chart').boundingBox();
    const side = await stats.boundingBox();
    expect(side.x).toBeGreaterThan(chart.x + chart.width - 1);
  });

  test('the sidebar stays on the set page', async ({ page }) => {
    await page.goto('/#/set/75192-1', { waitUntil: 'domcontentloaded' });
    await page.getByText('Millennium Falcon').first().waitFor();
    await expect(page.locator('#nav .nav-tab[data-route="/"]')).toBeVisible();
  });

  test('/ opens search and ? lists the shortcuts', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('.vault-row').first().waitFor();
    await page.keyboard.press('/');
    await expect(page.locator('#catalogSearch')).toBeFocused();
    await page.locator('#catalogSearch').blur();
    await page.keyboard.press('?');
    await expect(page.locator('#sheet .bv-keys')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#sheet .bv-keys')).toBeHidden();
    await page.keyboard.press('g');
    await page.keyboard.press('w');
    await expect(page).toHaveURL(/#\/wishlist$/);
  });
});

test.describe('PC pass 2 (1440 wide)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('Wishlist cards sit side by side', async ({ page }) => {
    const sets = Array.from({ length: 4 }, (_, i) => ({ id: `w${i}`, set_num: `${1000 + i}-1`, name: `Set ${i}`, current_value: 100 + i, target_price: 90 }));
    await page.route('**/api/wishlist', (r) => r.request().method() === 'GET' ? r.fulfill({ json: { wishlist: sets, unread_alerts: 0 } }) : r.fallback());
    await page.goto('/#/wishlist', { waitUntil: 'domcontentloaded' });
    const rows = page.locator('.bv-wlrow');
    await expect(rows).toHaveCount(4);
    const a = await rows.nth(0).boundingBox();
    const b = await rows.nth(1).boundingBox();
    expect(Math.abs(a.y - b.y)).toBeLessThan(2);
    expect(b.x).toBeGreaterThan(a.x + a.width - 1);
  });

  test('Ctrl+K searches, j moves through rows, icon buttons show a tooltip', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('.vault-row').first().waitFor();
    await page.keyboard.press('j');
    await expect(page.locator('.vault-row').first()).toHaveClass(/is-kbd/);
    await page.keyboard.press('Control+k');
    await expect(page.locator('#catalogSearch')).toBeFocused();
    await page.locator('#catalogSearch').blur();
    await page.locator('#root .bv-iconbtn[aria-label]').first().hover();
    await expect(page.locator('.bv-tip.show')).toBeVisible();
  });
});

test.describe('big monitor (1920 wide)', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('Vault value card sits beside the table', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('.vault-row').first().waitFor();
    const table = await page.locator('.vault-main').boundingBox();
    const card = await page.locator('.vault-aside').boundingBox();
    expect(card.x).toBeGreaterThan(table.x + table.width - 1);
    expect(table.width).toBeGreaterThan(1000);
  });

  test('Coming soon lists sets in columns', async ({ page }) => {
    const upcoming = Array.from({ length: 6 }, (_, i) => ({ set_num: `${2000 + i}-1`, name: `New ${i}`, theme: 'City', price_usd: 50 }));
    await page.route('**/api/upcoming', (r) => r.fulfill({ json: { upcoming } }));
    await page.goto('/#/upcoming', { waitUntil: 'domcontentloaded' });
    const rows = page.locator('.bv-comingsoon__row');
    await expect(rows).toHaveCount(6);
    const a = await rows.nth(0).boundingBox();
    const b = await rows.nth(1).boundingBox();
    expect(Math.abs(a.y - b.y)).toBeLessThan(2);
  });
});

test.describe('phone (393 wide)', () => {
  test.use({ viewport: { width: 393, height: 852 } });

  test('keeps the bottom bar without desktop extras', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('.vault-row').first().waitFor();
    await expect(page.locator('#nav .bv-side__search')).toBeHidden();
    await expect(page.locator('.vault-list-head')).toBeHidden();
    await expect(page.locator('.vault-row .bv-setrow__col--year').first()).toBeHidden();
    const box = await page.locator('#nav').boundingBox();
    expect(box.y).toBeGreaterThan(700);
  });
});
