import { test, expect, SET } from './fixtures.mjs';

test.use({ viewport: { width: 390, height: 844 } });

test('Ukrainian onboarding respects the selected language', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem('bv_session');
    localStorage.removeItem('bv_setup_v1');
    localStorage.setItem('bv.lang', 'uk');
  });
  await page.goto('/#/');
  const setup = page.locator('.bv-setup');
  await expect(setup).toBeVisible();
  await expect(setup.locator('.bv-note')).toContainText(/пристро/);
  await expect(setup.locator('.bv-setup-foot .primary')).not.toHaveText("Let's go");
  await page.screenshot({ path: 'artifacts/ui-ux-audit-2026-09-14/29-onboarding-after.png', animations: 'disabled' });
  await setup.locator('.bv-setup-foot .primary').click();
  await expect(setup.locator('[data-mode="pro"] b')).toHaveText('Інвестор');
  await expect(setup.locator('[data-mode="pro"] span')).toContainText('Повний інвесторський');
  await expect(setup.locator('[data-mode="simple"] b')).toHaveText('Простий');
  await expect(setup.locator('[data-mode="simple"] span')).not.toContainText('Just your sets');
  await page.screenshot({ path: 'artifacts/ui-ux-audit-2026-09-14/30-onboarding-mode-after.png', animations: 'disabled' });
});

for (const theme of ['light', 'dark']) {
  for (const width of [390, 1440]) {
    test(`minifigure header remains readable: ${theme}, ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript(theme => {
        localStorage.setItem('bv_theme', theme);
        localStorage.setItem('bv.lang', 'uk');
      }, theme);
      await page.route('**/api/minifigs?*', route => route.fulfill({ json: { minifigs: [], total: 0 } }));
      await page.goto('/#/minifigs?owned=0');
      // Discover · minifigs: the Discover title with the Sets | Minifigs scope.
      const title = page.locator('.bv-topbar h1');
      await expect(title).toHaveText('Каталог');
      await expect(page.locator('.bv-discover-scope [aria-current="true"]')).toHaveText('Мініфігурки');
      const box = await title.boundingBox();
      expect(box.width).toBeGreaterThan(60);
      expect(box.height).toBeLessThan(90);
      await expect(page.locator('#figMoreBtn')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
  test(`selected vault tab has readable contrast: ${theme}`, async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem('bv_theme', theme), theme);
    await page.goto('/#/');
    // #vaultPage is the painted Vault — the loading skeleton has the same tabs
    // and is replaced a moment later, which would detach a tab picked from it.
    const selected = page.locator('#vaultPage .collector-tabs [aria-current="page"]');
    await expect(selected).toBeAttached();
    const contrast = await selected.evaluate(element => {
      const style = getComputedStyle(element);
      // Underlined tabs are transparent: measure against the surface behind them.
      let host = element, bgColor = style.backgroundColor;
      while (host && /rgba\(0, 0, 0, 0\)|transparent/.test(bgColor)) { host = host.parentElement; bgColor = host ? getComputedStyle(host).backgroundColor : 'rgb(255, 255, 255)'; }
      const luminance = color => color.match(/[\d.]+/g).slice(0, 3)
        .map(Number).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      const fg = luminance(style.color), bg = luminance(bgColor);
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    await selected.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/ui-ux-audit-2026-09-14/31-vault-tab-${theme}-after.png`, animations: 'disabled' });
    console.info(`Selected tab contrast (${theme}): ${contrast.toFixed(2)}:1`);
  });
}

test('catalog bounds have accessible names and preserve invalid input for correction', async ({ page }) => {
  await page.goto('/#/add');
  await page.locator('#filterChip').click();
  for (const id of ['min_year', 'max_year', 'min_pieces', 'max_pieces', 'min_value', 'max_value']) {
    await expect(page.locator(`#f_${id}`)).toHaveAccessibleName(/.+/);
  }
  await page.locator('#f_min_year').fill('2026');
  await page.locator('#f_max_year').fill('2000');
  await page.locator('#filterApply').click();
  await expect(page.locator('#filterApply')).toBeVisible();
  await expect(page.locator('#f_min_year')).toHaveValue('2026');
  await expect(page.locator('#f_max_year')).toHaveValue('2000');
  await expect(page.locator('#f_min_year')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#f_min_year')).toBeFocused();
  await expect(page.locator('#f_min_year_error')).toHaveText('Minimum must be less than or equal to maximum.');
  await page.locator('#f_max_year').fill('2026');
  await page.locator('#filterApply').click();
  await expect(page.locator('#filterApply')).toBeHidden();
  await page.locator('#filterChip').click();
  await expect(page.locator('#f_min_year')).toHaveValue('2026');
  await expect(page.locator('#f_max_year')).toHaveValue('2026');
});

for (const cost of [null, 0, 123.45]) {
  test(`editing a note preserves purchase cost ${cost === null ? 'unknown' : cost}`, async ({ page }) => {
    const entry = { id: 1, quantity: 1, condition: 'new', purchase_price: cost };
    await page.route(`**/api/sets/${SET.set_num}`, route => route.fulfill({ json: { set: SET, entry } }));
    const patches = [];
    await page.route('**/api/collection/1', async route => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      patches.push(route.request().postDataJSON());
      await route.fulfill({ json: { ok: true } });
    });
    await page.goto(`/#/set/${SET.set_num}/manage`);
    await expect(page.locator('#mPrice')).toHaveValue(cost === null ? '' : cost.toFixed(2));
    await page.locator('#mNotes').fill('Audit note');
    await page.locator('#mNotes').press('Tab');
    await expect.poll(() => patches.length).toBeGreaterThan(0);
    expect(patches.at(-1).purchase_price).toBe(cost);
  });
}

test('quick add does not invent a purchase cost in the online request', async ({ page }) => {
  const posts = [];
  await page.route('**/api/collection', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    posts.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto(`/#/set/${SET.set_num}`);
  await page.locator('#addBtn').click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ set_num: SET.set_num, quantity: 1 });
  expect(posts[0]).not.toHaveProperty('purchase_price');
});

test('quick add preserves unknown purchase cost in the offline queue', async ({ page, context }) => {
  await page.goto(`/#/set/${SET.set_num}`);
  await expect(page.locator('#addBtn')).toBeVisible();
  await context.setOffline(true);
  await page.route('**/api/collection', route => route.abort('internetdisconnected'));
  await page.locator('#addBtn').click();
  const queuedAdds = () => page.evaluate(() => JSON.parse(localStorage.getItem('bv_outbox') || '[]')
    .filter(item => item.path === '/api/collection' && item.method === 'POST'));
  await expect.poll(async () => (await queuedAdds()).length).toBeGreaterThan(0);
  for (const item of await queuedAdds()) {
    expect(item.body).toMatchObject({ set_num: SET.set_num, quantity: 1 });
    expect(item.body).not.toHaveProperty('purchase_price');
  }
});
