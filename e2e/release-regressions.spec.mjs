import { test, expect } from './fixtures.mjs';

const setGuestSession = async (page) => {
  await page.addInitScript(() => {
    localStorage.removeItem('bv_session');
    localStorage.setItem('bv_onboarded_v1', '1');
    localStorage.setItem('bv_setup_v1', '1');
  });
};

test('fresh guest add renders the saved set in the vault immediately', async ({ page }) => {
  await setGuestSession(page);
  await page.addInitScript(() => {
    localStorage.setItem('bv_guest_collection', JSON.stringify([{
      id: 'guest:10497-1', set_num: '10497-1', name: 'Galaxy Explorer', theme: 'Space',
      quantity: 1, purchase_price: 102.98, current_value: 102.98, blended_value: 102.98,
      added_at: new Date().toISOString(), image_url: null,
    }]));
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#setList .set-list-card')).toHaveCount(1);
  await expect(page.locator('#setList')).toContainText('Galaxy Explorer');
});

test('unknown hash renders an explicit recovery page without masquerading as Vault', async ({ page }) => {
  await setGuestSession(page);
  await page.goto('/#/no-such-route', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/#\/no-such-route$/);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to Vault' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Browse Catalog' })).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-route', 'unknown');
});

test('guest Build gate does not call account-scoped build APIs', async ({ page }) => {
  await setGuestSession(page);
  const protectedBuildRequests = [];
  page.on('request', request => {
    if (/\/api\/build(?:\/sets)?(?:\?|$)/.test(request.url())) protectedBuildRequests.push(request.url());
  });
  await page.goto('/#/build', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Sign in to build from your vault')).toBeVisible();
  await page.waitForTimeout(250);
  expect(protectedBuildRequests).toEqual([]);
});

test('replayed app tour paints controls synchronously and remains dismissible', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('bv_onboarded_v1', '1');
    localStorage.setItem('bv_setup_v1', '1');
  });
  await page.goto('/#/me', { waitUntil: 'domcontentloaded' });
  await page.locator('#replayTourRow').click();

  const tour = page.locator('.bv-tour');
  await expect(tour).toBeVisible();
  await expect(tour.locator('.bv-tour-card h4')).toContainText('Welcome');
  await expect(tour.getByRole('button', { name: 'Next' })).toBeVisible();
  await expect(tour.getByRole('button', { name: 'Skip' })).toBeVisible();
  await tour.getByRole('button', { name: 'Skip' }).click();
  await expect(tour).toHaveCount(0);
});

test('guest remove undo waits for restore and synchronizes the visible detail state', async ({ page }) => {
  await setGuestSession(page);
  await page.addInitScript(() => {
    localStorage.setItem('bv_guest_collection', JSON.stringify([{
      id: 'guest:75192-1', set_num: '75192-1', name: 'Millennium Falcon', theme: 'Star Wars',
      quantity: 1, purchase_price: 700, current_value: 850, blended_value: 850,
      added_at: new Date().toISOString(), image_url: null,
    }]));
  });
  await page.goto('/#/set/75192-1', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#qtyDown')).toBeVisible();
  await page.locator('#qtyDown').click();
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove' }).click();
  await page.locator('.toast-undo-btn').click();

  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('bv_guest_collection') || '[]').length)).toBe(1);
  await expect(page.locator('#qtyDown')).toBeVisible();
  await expect(page.locator('#addBtn')).toHaveCount(0);
});

test('guest EUR detail price remains EUR after adding to the vault', async ({ page }) => {
  await setGuestSession(page);
  await page.addInitScript(() => {
    localStorage.setItem('bv_guest_prefs', JSON.stringify({ currency: 'EUR' }));
    localStorage.setItem('bv_guest_collection', '[]');
  });
  await page.goto('/#/set/75192-1', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#addBtn')).toContainText('€');
  await page.locator('#addBtn').click();
  await expect(page.locator('#qtyDown')).toBeVisible();
  await expect(page.locator('.detail-summary-val')).toContainText('€');
});

test('web Pro options provides a visible fallback instead of a no-op', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('bv_onboarded_v1', '1');
    localStorage.setItem('bv_setup_v1', '1');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('.portfolio-tab[data-tab="insights"]').click();
  await expect(page.locator('#insightsUpgradeBtn')).toBeVisible();
  await page.locator('#insightsUpgradeBtn').click();
  await expect(page.locator('#sheet')).toHaveClass(/show/);
  await expect(page.locator('#sheet').getByText('BricksVault Pro', { exact: true })).toBeVisible();
  await expect(page.locator('#proSignInBtn')).toBeVisible();
  await expect(page.locator('#proOptionsClose')).toBeVisible();
});
