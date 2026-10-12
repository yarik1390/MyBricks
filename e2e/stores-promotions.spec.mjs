import { test, expect, SET } from './fixtures.mjs';

test.use({ viewport: { width: 390, height: 844 } });

test('set overview compares store prices, cheapest in stock first, and links the rest', async ({ page }) => {
  await page.route(`**/api/sets/${SET.set_num}`, route => route.fulfill({ json: { set: SET, entry: null } }));
  await page.route(`**/api/stores/${SET.set_num}`, route => route.fulfill({ json: {
    set_num: SET.set_num, msrp: 100, value: 120,
    offers: [
      { store: 'walmart', label: 'Walmart', price: 84.5, in_stock: true, url: 'https://www.walmart.com/ip/1', checked_at: '2026-10-12 07:30:00' },
      { store: 'lego', label: 'LEGO.com', price: 99.99, in_stock: true, url: 'https://www.lego.com/en-us/product/1', checked_at: '2026-10-12 10:00:00' },
    ],
    links: [{ store: 'target', label: 'Target', url: 'https://www.target.com/s?searchTerm=LEGO' }],
  } }));
  await page.goto(`/#/set/${SET.set_num}`);
  const card = page.locator('.bv-stores');
  await expect(card).toBeVisible();
  await expect(card.locator('.bv-stores__row').first()).toContainText('Walmart');
  await expect(card.locator('.bv-stores__row').first()).toContainText('Best price');
  await expect(card.locator('.bv-stores__row').first()).toContainText('30% below its value');
  await expect(card.getByRole('link', { name: /Target/ })).toHaveAttribute('href', /target\.com/);
});

test('promotions page splits offers into on now and coming up', async ({ page }) => {
  await page.route('**/api/promotions', route => route.fulfill({ json: {
    now: [{ id: 1, kind: 'gwp', title: 'Free Christmas Tree', starts_on: '2026-10-01', ends_on: '2099-12-31', min_spend: 150, gift_set_num: '40573-1', gift_name: 'Christmas Tree', gift_image: null, url: 'https://www.lego.com/en-us/offers' }],
    upcoming: [{ id: 2, kind: 'double_points', title: 'Double points weekend', starts_on: '2099-11-27', ends_on: '2099-11-30' }],
  } }));
  await page.goto('/#/promos');
  const page$ = page.locator('#promosPage');
  await expect(page$.getByRole('heading', { name: 'On now' })).toBeVisible();
  await expect(page$.locator('.bv-promo').first()).toContainText('Gift with purchase');
  await expect(page$.locator('.bv-promo').first()).toContainText('Christmas Tree');
  await expect(page$.getByRole('heading', { name: 'Coming up' })).toBeVisible();
  await expect(page$.locator('.bv-promo').nth(1)).toContainText('Double Insiders points');
});
