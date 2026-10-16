import { test, expect } from './fixtures.mjs';

// Defects found in the October 2026 design pass (phone, desktop, German).

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

test.describe('phone', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('login fine print keeps Terms and Privacy inline, not on 48px buttons', async ({ page }) => {
    await page.goto('/#/login', { waitUntil: 'domcontentloaded' });
    const terms = page.locator('.bv-login__legal[data-legal-sheet="terms"]');
    await expect(terms).toBeVisible();
    const box = await terms.boundingBox();
    expect(box.height).toBeLessThan(24);
  });

  test('set page bottom bar drops Sell/Edit to icons before squeezing the copy summary', async ({ page, stub }) => {
    await page.route('**/api/sets/75192-1*', route => json(route, { set: stub.SET, entry: { id: 1, quantity: 1, purchase_price: 700 } }));
    await page.goto('/#/set/75192-1', { waitUntil: 'domcontentloaded' });
    const bar = page.locator('#setBar .bv-setbar');
    await expect(bar.locator('.bv-setbar__copy')).toBeVisible();
    await expect(bar).toHaveClass(/bv-setbar--compact/);
    const copy = await bar.locator('.bv-setbar__copy').boundingBox();
    expect(copy.width).toBeGreaterThanOrEqual(120);
    // Labels stay as accessible names.
    await expect(page.locator('#sellBtn')).toHaveAccessibleName('Sell');
    await expect(page.locator('#manageBtn')).toHaveAccessibleName('Edit');
  });

  test('what changed subtitle does not repeat its date', async ({ page }) => {
    await page.goto('/#/changes', { waitUntil: 'domcontentloaded' });
    const sub = page.locator('#changesPage .bv-topbar').first();
    await expect(sub).toContainText('Since');
    const text = await sub.innerText();
    expect(text).not.toMatch(/·/);
  });
});

test.describe('wide', () => {
  test.use({ viewport: { width: 393, height: 852 } });

  test('set page keeps text labels on Sell and Edit when there is room', async ({ page, stub }) => {
    await page.route('**/api/sets/75192-1*', route => json(route, { set: stub.SET, entry: { id: 1, quantity: 1, purchase_price: 700 } }));
    await page.goto('/#/set/75192-1', { waitUntil: 'domcontentloaded' });
    const bar = page.locator('#setBar .bv-setbar');
    await expect(bar.locator('.bv-setbar__copy')).toBeVisible();
    await expect(bar).not.toHaveClass(/bv-setbar--compact/);
  });
});

test.describe('follow-ups', () => {
  test('empty Vault Minifigs tab has no floating Scan button or duplicate browse link', async ({ page }) => {
    await page.route('**/api/minifigs*', route => json(route, { items: [], minifigs: [], total: 0, hasMore: false }));
    await page.goto('/#/minifigs', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.vault-fig-empty')).toBeVisible();
    await expect(page.locator('#bvFab')).toBeHidden();
    await expect(page.locator('.vault-fig-hero .vault-fig-progress')).toHaveCount(0);
  });

  test('empty Lists tab offers New list in place of the floating button', async ({ page }) => {
    await page.route('**/api/subcollections**', route => json(route, { subcollections: [] }));
    await page.goto('/#/collections', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#collectionNewEmpty')).toBeVisible();
    await expect(page.locator('#bvFab')).toBeHidden();
  });
});

test.describe('desktop filter panel', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('filters stay open beside Discover results and apply on tap', async ({ page, stub }) => {
    await page.goto('/#/add', { waitUntil: 'domcontentloaded' });
    const panel = page.locator('#catalogFilterPanel');
    await expect(panel).toBeVisible();
    await expect(page.locator('#filterChip')).toBeHidden();
    const before = stub.calls.filter(c => c.path === '/api/sets/search').length;
    await panel.locator('[data-facet="retired"] [data-fval="retired"]').click();
    await expect.poll(() => stub.calls.filter(c => c.path === '/api/sets/search').length).toBeGreaterThan(before);
    await expect(panel.locator('[data-facet="retired"] [data-fval="retired"]')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('phone filter sheet', () => {
  test.use({ viewport: { width: 393, height: 852 } });
  test('panel stays hidden and the Filters chip opens the sheet', async ({ page }) => {
    await page.goto('/#/add', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#catalogFilterPanel')).toBeHidden();
    await page.locator('#filterChip').click();
    await expect(page.locator('#filterSheet #f_min_year')).toBeVisible();
  });
});
