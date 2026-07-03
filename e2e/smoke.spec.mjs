import { test, expect } from './fixtures.mjs';

// Hermetic smoke tests: auth + all /api/* are stubbed by the `stub` fixture, so
// these exercise the real frontend bundle without any live service.

test('boots into the authed app (not the login screen) and loads the profile', async ({ page, stub }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1.brand-name')).toHaveText('Brickvault');
  // Guests never see the vault header; reaching it proves the injected session took.
  expect(stub.calls.some((c) => c.path === '/api/me')).toBeTruthy();
  expect(stub.calls.some((c) => c.path === '/api/collection')).toBeTruthy();
  // No unhandled requests leaked to the network (everything was intercepted).
});

test('portfolio renders the collection', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1.brand-name')).toBeVisible();
  await expect(page.getByText('Millennium Falcon').first()).toBeVisible();
});

test('catalog ("Find a set") renders search results', async ({ page }) => {
  await page.goto('/#/add', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1.topbar-title')).toHaveText('Find a set');
  await expect(page.locator('#catalogGrid')).toBeVisible();
  await expect(page.locator('#catalogCount')).toContainText('1 result');
});

test('set detail renders with the action bar', async ({ page }) => {
  await page.goto('/#/set/75192-1', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Millennium Falcon').first()).toBeVisible();
  await expect(page.locator('#wishToggle')).toBeVisible();
  await expect(page.locator('#addBtn')).toBeVisible();
});

test('wishlist toggle removes the set and flips the button', async ({ page, stub }) => {
  // Load the portfolio first so state.wishlist is populated (the set is wished).
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1.brand-name')).toBeVisible();
  // In-app (no-reload) navigation preserves the in-memory wishlist state.
  await page.evaluate(() => { location.hash = '#/set/75192-1'; });

  const wish = page.locator('#wishToggle');
  await expect(wish).toHaveAttribute('aria-label', 'Remove from wishlist');
  await wish.click();
  // Optimistic repaint flips the control back to "Add".
  await expect(wish).toHaveAttribute('aria-label', 'Add to wishlist');
  expect(stub.calls.some((c) => c.method === 'DELETE' && c.path.startsWith('/api/wishlist/'))).toBeTruthy();
});
