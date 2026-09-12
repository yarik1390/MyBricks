import { test, expect } from './fixtures.mjs';
import { readFile } from 'node:fs/promises';

const FIG = {
  fig_num: 'sw0001', name: 'Hero Pilot', series: 'Space', rarity: 'rare',
  image_url: null, year: 2020, num_parts: 4, pricing_available: false,
};

async function stubMinifigCatalog(page) {
  await page.route('**/api/minifigs?*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ minifigs: [{ ...FIG, owned_qty: 0 }], total: 1, hasMore: false, aggregates: { owned_count: 0, owned_value: 0 } }),
  }));
  await page.route('**/api/minifigs/series', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"series":[]}' }));
  await page.route('**/api/minifigs/rare-finds', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"figs":[]}' }));
  await page.route('**/api/minifigs/sw0001/history?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"history":[]}' }));
  await page.route('**/api/minifigs/sw0001/sets', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"sets":[]}' }));
}

test('signed-in holding saves explicit fields, reopens, preserves precise unchanged cost, exports, and keeps form after failed remove', async ({ page }) => {
  let holding = null;
  const puts = [];
  let failRemove = true;
  let releaseFirstSave;
  await stubMinifigCatalog(page);
  await page.route('**/api/minifigs/export', route => route.fulfill({
    status: 200, contentType: 'text/csv',
    body: 'fig_num,name,series,quantity,condition,purchase_price_usd,purchased_at,notes\nsw0001,Hero Pilot,Space,2,used_good,10.123456,2024-02-29,Display copy',
  }));
  await page.route('**/api/minifigs/sw0001', async route => {
    const method = route.request().method();
    if (method === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ minifig: { ...FIG, owned_qty: holding?.quantity || 0 }, holding }) });
    if (method === 'PUT') {
      const body = route.request().postDataJSON();
      puts.push(body);
      if (puts.length === 1) await new Promise(resolve => { releaseFirstSave = resolve; });
      holding = { quantity: 1, condition: 'unknown', purchase_price: null, purchased_at: null, notes: null, ...holding, ...body };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, fig_num: FIG.fig_num, quantity: holding.quantity, holding }) });
    }
    if (method === 'DELETE' && failRemove) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"temporary failure"}' });
    return route.fulfill({ status: 204, body: '' });
  });

  await page.goto('/#/minifigs', { waitUntil: 'domcontentloaded' });
  await page.locator('.mini-card').click();
  await expect(page.locator('#figQuantity')).toHaveValue('1');
  await page.locator('#figQuantity').fill('2');
  await page.locator('#figCondition').selectOption('used_good');
  await page.locator('#figPurchasePrice').fill('10.123456');
  await page.locator('#figPurchasedAt').fill('2024-02-29');
  await page.locator('#figNotes').fill('Display copy');
  await page.locator('#figSaveHolding').click();
  await expect.poll(() => puts.length).toBe(1);
  await expect(page.locator('#figNotes')).toBeDisabled();
  await expect(page.locator('#figRemoveHolding')).toHaveCount(0);
  releaseFirstSave();
  await expect(page.locator('#figNotes')).toBeEnabled();
  expect(puts[0]).toEqual({ quantity: 2, condition: 'used_good', purchase_price: 10.123456, purchased_at: '2024-02-29', notes: 'Display copy' });

  await page.keyboard.press('Escape');
  await page.locator('.mini-card').click();
  await expect(page.locator('#figQuantity')).toHaveValue('2');
  await page.locator('#figNotes').fill('Updated note');
  await page.locator('#figSaveHolding').click();
  await expect.poll(() => puts.length).toBe(2);
  expect(puts[1]).toEqual({ quantity: 2, condition: 'used_good', purchased_at: '2024-02-29', notes: 'Updated note' });

  await page.locator('#figRemoveHolding').click();
  await page.locator('#figConfirmRemove').click();
  await expect(page.locator('#figHoldingError')).toContainText('temporary failure');
  await expect(page.locator('#figNotes')).toHaveValue('Updated note');
  failRemove = false;
  await page.locator('#figConfirmRemove').click();
  await expect(page.locator('#figQuantity')).toHaveValue('1');

  await page.keyboard.press('Escape');
  const download = page.waitForEvent('download');
  await page.locator('#figExportBtn').click();
  expect(await readFile(await (await download).path(), 'utf8')).toContain('10.123456');
});

test('guest holding survives refresh, exports zero distinctly from blank, and nested sets route stays public', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem('bv_session');
    if (!sessionStorage.getItem('minifig-guest-seeded')) {
      localStorage.setItem('bv_figs', '[]');
      localStorage.setItem('bv_guest_fig_details', '{}');
      sessionStorage.setItem('minifig-guest-seeded', '1');
    }
  });
  await stubMinifigCatalog(page);
  let setsRequests = 0;
  await page.route('**/api/minifigs/sw0001/sets', route => {
    setsRequests++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"sets":[]}' });
  });
  await page.goto('/#/minifigs', { waitUntil: 'domcontentloaded' });
  await page.locator('.mini-card').click();
  await page.locator('#figQuantity').fill('3');
  await page.locator('#figPurchasePrice').fill('0');
  await page.locator('#figNotes').fill('Guest note');
  await page.locator('#figSaveHolding').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('bv_guest_fig_details')).sw0001.holding)).toMatchObject({ quantity: 3, purchase_price: 0, notes: 'Guest note' });
  expect(setsRequests).toBeGreaterThan(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.mini-card').click();
  await expect(page.locator('#figQuantity')).toHaveValue('3');
  await expect(page.locator('#figPurchasePrice')).toHaveValue('0.00');
  await page.locator('#figPurchasePrice').fill('');
  await page.locator('#figSaveHolding').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('bv_guest_fig_details')).sw0001.holding.purchase_price)).toBeNull();

  await page.keyboard.press('Escape');
  const download = page.waitForEvent('download');
  await page.locator('#figExportBtn').click();
  const csv = await readFile(await (await download).path(), 'utf8');
  expect(csv).toContain('sw0001,Hero Pilot,Space,3,unknown,,');
});

test('guest storage failure rejects save without changing prior holding', async ({ page }) => {
  await page.addInitScript((fig) => {
    localStorage.removeItem('bv_session');
    localStorage.setItem('bv_figs', '["sw0001"]');
    localStorage.setItem('bv_guest_fig_details', JSON.stringify({ sw0001: { ...fig, holding: { quantity: 2, condition: 'unknown', purchase_price: null, purchased_at: null, notes: 'Before' } } }));
  }, FIG);
  await stubMinifigCatalog(page);
  await page.goto('/#/minifigs', { waitUntil: 'domcontentloaded' });
  await page.locator('.mini-card').click();
  await expect(page.locator('#figNotes')).toHaveValue('Before');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'bv_guest_fig_details') throw new DOMException('Storage full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.locator('#figNotes').fill('After');
  await page.locator('#figSaveHolding').click();
  await expect(page.locator('#figHoldingError')).toContainText('Storage full');
  await expect(page.locator('#figNotes')).toHaveValue('After');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bv_guest_fig_details')).sw0001.holding.notes)).toBe('Before');
});

test('mobile populated holding form screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubMinifigCatalog(page);
  await page.route('**/api/minifigs/sw0001', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      minifig: { ...FIG, current_value: undefined, pricing_available: false, owned_qty: 2 },
      holding: { quantity: 2, condition: 'used_good', purchase_price: 10.5, purchased_at: '2024-02-29', notes: 'Found at the spring toy fair.' },
    }),
  }));
  await page.goto('/#/minifigs', { waitUntil: 'domcontentloaded' });
  await page.locator('.mini-card').click();
  await expect(page.locator('#figNotes')).toHaveValue('Found at the spring toy fair.');
  await page.locator('#sheet').screenshot({ path: 'audit/minifigure-holdings-mobile.png' });
  await page.locator('#figNotes').scrollIntoViewIfNeeded();
  await page.locator('#sheet').screenshot({ path: 'audit/minifigure-holdings-mobile-actions.png' });
});
