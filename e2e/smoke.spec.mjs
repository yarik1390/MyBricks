import { test, expect } from './fixtures.mjs';

// Hermetic smoke tests: auth + all /api/* are stubbed by the `stub` fixture, so
// these exercise the real frontend bundle without any live service.

test('boots into the authed app (not the login screen) and loads the profile', async ({ page, stub }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1.brand-name')).toHaveText('BricksVault');
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

test('set detail: adding to the vault posts to the collection', async ({ page, stub }) => {
  await page.goto('/#/set/75192-1', { waitUntil: 'domcontentloaded' });
  const add = page.locator('#addBtn');
  await expect(add).toBeVisible();
  await add.click();
  await expect
    .poll(() => stub.calls.some((c) => c.method === 'POST' && c.path === '/api/collection'))
    .toBe(true);
});

test('set detail: switching to the forecast tab keeps the page mounted', async ({ page }) => {
  await page.goto('/#/set/75192-1/forecast', { waitUntil: 'domcontentloaded' });
  // The set-detail view still renders (tabbed) rather than falling back to an error.
  await expect(page.getByText('Millennium Falcon').first()).toBeVisible();
  await expect(page.locator('#addBtn')).toBeVisible();
});

test('admin console renders its sections for an admin user', async ({ page }) => {
  // Elevate this run to admin (more-specific route registered after the fixture's
  // catch-all, so it wins for /api/me); the admin section loads fall back to {}.
  await page.route('**/api/me', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ display_name: 'Admin', handle: 'admin', currency: 'USD', is_guest: false, is_admin: true, notify_price_drops: true, portfolio_stats: {} }),
  }));
  await page.goto('/#/me/admin', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.admin-dashboard-page')).toBeVisible();
  await expect(page.locator('.admin-segments')).toBeVisible();
  // The segment nav (always visible) exposes the section tabs.
  await expect(page.locator('[data-admin-section-link="adminPopulate"]')).toBeVisible();
  await expect(page.locator('[data-admin-section-link="adminUsers"]')).toBeVisible();

  // Segment tabs are wired synchronously (wireAdminShell) — clicking one
  // activates it without any network.
  const usersTab = page.locator('[data-admin-section-link="adminUsers"]');
  await usersTab.click();
  await expect(usersTab).toHaveAttribute('aria-selected', 'true');
});

test('non-admin is redirected away from the admin console', async ({ page }) => {
  // The default fixture profile has no is_admin flag → renderMeAdmin bounces to /me.
  await page.goto('/#/me/admin', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/me');
});

test('me: account deletion is gated behind typing DELETE (store requirement)', async ({ page, stub }) => {
  await page.goto('/#/me', { waitUntil: 'domcontentloaded' });

  const row = page.locator('#deleteAccountRow');
  await expect(row).toBeVisible();
  await row.click();

  // The confirm button is present but inert until the user types DELETE.
  const btn = page.locator('#deleteAccountBtn');
  await expect(btn).toBeVisible();
  await expect(btn).toBeDisabled();

  await page.locator('#deleteConfirmInput').fill('nope');
  await expect(btn).toBeDisabled();

  await page.locator('#deleteConfirmInput').fill('DELETE');
  await expect(btn).toBeEnabled();

  // Only after confirmation does the destructive DELETE /api/me fire.
  await btn.click();
  await expect
    .poll(() => stub.calls.filter((c) => c.method === 'DELETE' && c.path === '/api/me').length)
    .toBeGreaterThan(0);
});
