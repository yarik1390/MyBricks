import { test, expect } from './fixtures.mjs';

// Add area of the 2026 redesign: Discover tiles add in place (snackbar with
// Undo, never a new screen), the filter sheet previews its result count, and
// the scanner keeps a running session — "Done · N" — whose summary sheet can
// undo each add. The collection stub owns 75192-1 (id 1), so scanning it again
// must bump the quantity instead of creating a duplicate row.

const OTHER = {
  set_num: '10497-1', name: 'Galaxy Explorer', year: 2022, pieces: 1254, theme: 'Icons',
  image_url: null, retail_price: 99.99, current_value: 120, retired: 0,
};

async function trackCalls(page) {
  const calls = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith('/api/collection')) {
      calls.push({ method: req.method(), path: url.pathname, body: req.postData() ? JSON.parse(req.postData()) : null });
    }
  });
  return calls;
}

test('Discover tile adds in place and Undo removes it', async ({ page }) => {
  await page.route('**/api/sets/search*', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ sets: [OTHER], total: 1, hasMore: false }),
  }));
  await page.route('**/api/collection/77', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await page.route('**/api/collection', (route) => (route.request().method() === 'POST'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ item: { id: 77, set_num: OTHER.set_num } }) })
    : route.fallback()));
  const calls = await trackCalls(page);
  await page.goto('/#/add?q=galaxy', { waitUntil: 'domcontentloaded' });

  const add = page.locator('[data-add-set="10497-1"]');
  await expect(add).toBeVisible();
  await add.click();
  await expect(page.locator('#toast')).toContainText('Galaxy Explorer');
  // Stays on Discover; the tile now reads as owned.
  expect(await page.evaluate(() => location.hash)).toContain('#/add');
  await expect(page.locator('.bv-tile[data-set="10497-1"]')).toHaveClass(/is-owned/);
  const post = calls.find((c) => c.method === 'POST' && c.path === '/api/collection');
  expect(post?.body).toEqual({ set_num: '10497-1', quantity: 1 });

  await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => calls.some((c) => c.method === 'DELETE' && c.path === '/api/collection/77')).toBe(true);
  await expect(page.locator('[data-add-set="10497-1"]')).toBeVisible();
});

test('filter sheet previews the result count before applying', async ({ page }) => {
  await page.route('**/api/sets/search*', (route) => {
    const url = new URL(route.request().url());
    const retired = url.searchParams.get('retired') === '1';
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ sets: [OTHER], total: retired ? 12 : 340, hasMore: false }),
    });
  });
  await page.goto('/#/add', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^Filters/ }).click();
  const apply = page.locator('#filterApply');
  await expect(apply).toBeVisible();
  await expect(apply).toContainText(/Show [\d,]+ sets/);
});

test('scanner session: add, add again, then Done lists both with working Undo', async ({ page }) => {
  await page.route('**/api/collection/*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await page.route('**/api/collection', (route) => (route.request().method() === 'POST'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ item: { id: 91, set_num: OTHER.set_num } }) })
    : route.fallback()));
  // The set page API reports the holding the scanner bumps instead of duplicating.
  await page.route('**/api/sets/75192-1', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ set: { set_num: '75192-1', name: 'Millennium Falcon' }, entry: { id: 1, set_num: '75192-1', quantity: 1, purchase_price: 700 } }),
  }));
  const calls = await trackCalls(page);
  await page.goto('/#/add', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }], getVideoTracks: () => [] }) },
    });
    const scanner = await import('/js/components/scanner.js');
    scanner.openScan('barcode', { deferStart: true });
  });
  await expect(page.locator('#scanCloseBtn')).toHaveText(/Close/);

  const showSet = (set) => page.evaluate(async (s) => {
    const scanner = await import('/js/components/scanner.js');
    scanner.showScanResult({ identified: true, set: s });
  }, set);

  // 1) A set you don't own: no price chosen → no purchase_price is sent.
  await showSet(OTHER);
  await expect(page.locator('#scanResult')).toContainText('Galaxy Explorer');
  await page.locator('#scanAdd').click();
  await expect(page.locator('#scanCloseBtn')).toHaveText(/Done · 1/);
  const post = calls.find((c) => c.method === 'POST' && c.path === '/api/collection');
  expect(post?.body).toEqual({ set_num: '10497-1', quantity: 1, condition: 'new' });

  // 2) A set you already own → one more copy on the same row.
  await expect(page.locator('#scanAdd')).toHaveCount(0);
  await showSet({ set_num: '75192-1', name: 'Millennium Falcon', theme: 'Star Wars', year: 2017, current_value: 850 });
  await expect(page.locator('#scanOwned')).toContainText('You own 1');
  await page.locator('#scanAdd').click();
  await expect(page.locator('#scanCloseBtn')).toHaveText(/Done · 2/);
  const patch = calls.find((c) => c.method === 'PATCH' && c.path === '/api/collection/1');
  expect(patch?.body).toEqual({ quantity: 2 });

  // 3) Done → summary sheet with an Undo per add.
  await page.locator('#scanCloseBtn').click();
  const sheet = page.locator('#sheet');
  await expect(sheet).toContainText('Galaxy Explorer');
  await expect(sheet).toContainText('Millennium Falcon');
  const undos = sheet.locator('[data-undo]');
  await expect(undos).toHaveCount(2);
  await undos.nth(1).click();
  await expect.poll(() => calls.filter((c) => c.method === 'PATCH' && c.path === '/api/collection/1').at(-1)?.body).toEqual({ quantity: 1 });
  await sheet.locator('[data-undo="0"]').click();
  await expect.poll(() => calls.some((c) => c.method === 'DELETE' && c.path === '/api/collection/91')).toBe(true);
  await expect(sheet.locator('[data-undo]')).toHaveCount(0);
});

test('filter sheet keeps unapplied choices when a theme comes from More themes', async ({ page }) => {
  const queries = [];
  await page.route('**/api/themes', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ themes: ['Star Wars', 'Icons', 'Technic', 'Ideas', 'City', 'Harry Potter'], theme_groups: [], categories: [] }),
  }));
  await page.route('**/api/sets/search*', (route) => {
    queries.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sets: [OTHER], total: 3, hasMore: false }) });
  });
  await page.goto('/#/add', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^Filters/ }).click();
  const sheet = page.locator('#filterSheet');
  await sheet.locator('[data-facet="retired"] [data-fval="retired"]').click();
  await sheet.locator('#f_min_value').fill('100');
  await page.locator('#filterMoreThemes').click();
  await page.locator('[data-pick-theme="Harry Potter"]').click();
  // Back on the filter sheet: the earlier choices survive and the theme is picked.
  await expect(sheet.locator('[data-facet="retired"] [data-fval="retired"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.locator('#f_min_value')).toHaveValue('100');
  await expect(sheet.locator('[data-facet="theme"] [data-fval="Harry Potter"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#filterApply').click();
  await expect.poll(() => {
    const q = queries.at(-1);
    return q && q.get('limit') !== '1' ? `${q.get('theme')}|${q.get('retired')}|${q.get('min_value')}` : null;
  }).toBe('Harry Potter|1|100');
});

test('scanner session: undoing one of two scans of the same set takes back only that copy', async ({ page }) => {
  let quantity = 1;
  await page.route('**/api/collection/*', (route) => {
    const body = route.request().postData() ? JSON.parse(route.request().postData()) : {};
    if (route.request().method() === 'PATCH' && body.quantity != null) quantity = body.quantity;
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.route('**/api/sets/75192-1', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ set: { set_num: '75192-1', name: 'Millennium Falcon' }, entry: { id: 1, set_num: '75192-1', quantity, purchase_price: 700 } }),
  }));
  const calls = await trackCalls(page);
  await page.goto('/#/add', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }], getVideoTracks: () => [] }) },
    });
    const scanner = await import('/js/components/scanner.js');
    scanner.openScan('barcode', { deferStart: true });
  });
  const falcon = { set_num: '75192-1', name: 'Millennium Falcon', theme: 'Star Wars', year: 2017, current_value: 850 };
  for (const n of [1, 2]) {
    await page.evaluate(async (s) => {
      const scanner = await import('/js/components/scanner.js');
      scanner.showScanResult({ identified: true, set: s });
    }, falcon);
    await page.locator('#scanAdd').click();
    await expect(page.locator('#scanCloseBtn')).toHaveText(new RegExp(`Done · ${n}`));
    await expect(page.locator('#scanAdd')).toHaveCount(0);
  }
  const quantities = () => calls.filter((c) => c.method === 'PATCH' && c.path === '/api/collection/1').map((c) => c.body.quantity);
  expect(quantities()).toEqual([2, 3]);

  // Undo the FIRST scan: one copy comes off (3 → 2), not both.
  await page.locator('#scanCloseBtn').click();
  const sheet = page.locator('#sheet');
  await sheet.locator('[data-undo="0"]').click();
  await expect.poll(() => quantities().at(-1)).toBe(2);
  await sheet.locator('[data-undo="1"]').click();
  await expect.poll(() => quantities().at(-1)).toBe(1);
  expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
});

test('unknown barcode offers photo, typing the number and teaching the code', async ({ page }) => {
  await page.route('**/api/scan/identify', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ identified: false, reasoning: 'Barcode not in catalog. Try a photo scan instead.' }),
  }));
  await page.goto('/#/add', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }], getVideoTracks: () => [] }) },
    });
    const scanner = await import('/js/components/scanner.js');
    await scanner.lookupScanInput('5702017421384');
  });
  const card = page.locator('#scanResult');
  await expect(card).toContainText('5 702017 42138 4');
  await expect(card.locator('#scanTryPhoto')).toBeVisible();
  await expect(card.locator('#scanTypeSet')).toBeVisible();
  await expect(card.locator('#scanTeach')).toBeVisible();
  // Frame and hint step aside while a result is up.
  await expect(page.locator('.bv-scan')).toHaveClass(/has-result/);
});

test('Retiring soon switches between yours, wishlist and all', async ({ page }) => {
  await page.route('**/api/sets/search*', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ sets: [{ ...OTHER, lego_retiring_soon: 1 }], total: 1, hasMore: false }),
  }));
  await page.goto('/#/retiring', { waitUntil: 'domcontentloaded' });
  const tabs = page.locator('#retiringTabs');
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  await tabs.getByRole('tab', { name: 'All' }).click();
  await expect(tabs.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#retiringPanel')).toContainText('Galaxy Explorer');
});
