import { test, expect } from './fixtures.mjs';

// Pro on Android: the plan cards are the picker and Continue opens Google
// Play's purchase sheet for that plan directly. The RevenueCat-designed paywall
// used to open in between, showing the same plans a second time.
test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

function mockBilling(page, { purchaseError = null } = {}) {
  return page.addInitScript((err) => {
    window.__purchases = [];
    window.__paywalls = 0;
    window.RC_PLAY_BILLING_KEY = 'goog_test';
    const noop = () => Promise.resolve({ remove() {} });
    const plugins = {
      App: { addListener: noop, toggleBackButtonHandler: () => Promise.resolve() },
      Purchases: {
        configure: () => Promise.resolve(),
        logIn: () => Promise.resolve(),
        getCustomerInfo: () => Promise.resolve({ customerInfo: { entitlements: { active: {} } } }),
        getOfferings: () => Promise.resolve({ current: { availablePackages: [
          { identifier: '$rc_annual', packageType: 'ANNUAL', product: { priceString: '€47.99' } },
          { identifier: '$rc_monthly', packageType: 'MONTHLY', product: { priceString: '€4.79' } },
          { identifier: '$rc_lifetime', packageType: 'LIFETIME', product: { priceString: '€99.99' } },
        ] } }),
        purchasePackage: ({ aPackage }) => {
          window.__purchases.push(aPackage.identifier);
          return err ? Promise.reject(err) : Promise.resolve({ customerInfo: { entitlements: { active: { 'BricksVault Pro': {} } } } });
        },
      },
      RevenueCatUI: { presentPaywallIfNeeded: () => { window.__paywalls++; return Promise.resolve({ result: 'CANCELLED' }); } },
    };
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: plugins,
      registerPlugin: (name) => plugins[name],
    };
  }, purchaseError);
}

test('Continue buys the picked plan in Google Play without a second paywall', async ({ page }) => {
  await mockBilling(page);
  await page.goto('/#/pro');
  const monthly = page.locator('.bv-proplan[data-plan="MONTHLY"]');
  await expect(monthly).toBeVisible();
  await expect(page.locator('.bv-proplan[data-plan="ANNUAL"]')).toHaveAttribute('aria-pressed', 'true');
  await monthly.click();
  await expect(monthly).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.bv-proplan[data-plan="ANNUAL"]')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#rcUpgradeBtn').click();
  await expect.poll(() => page.evaluate(() => window.__purchases)).toEqual(['$rc_monthly']);
  expect(await page.evaluate(() => window.__paywalls)).toBe(0);
});

test('a Lifetime package shows as a one-time plan and can be bought', async ({ page }) => {
  await mockBilling(page);
  await page.goto('/#/pro');
  const lifetime = page.locator('.bv-proplan[data-plan="LIFETIME"]');
  await expect(lifetime).toContainText('Lifetime');
  await expect(lifetime).toContainText('€99.99');
  await expect(lifetime).toHaveAttribute('aria-pressed', 'false');
  await lifetime.click();
  await page.locator('#rcUpgradeBtn').click();
  await expect.poll(() => page.evaluate(() => window.__purchases)).toEqual(['$rc_lifetime']);
  await page.screenshot({ path: process.env.PRO_SHOT || 'test-results/pro-lifetime.png' });
});

test('a refused purchase says why', async ({ page }) => {
  await mockBilling(page, { purchaseError: { code: '3', message: 'not allowed', data: { userCancelled: false } } });
  await page.goto('/#/pro');
  await page.locator('#rcUpgradeBtn').click();
  await expect(page.getByText(/didn't allow this purchase/)).toBeVisible();
  await page.screenshot({ path: process.env.PRO_SHOT || 'test-results/pro.png' });
});

test('the thanks wall lists public supporters', async ({ page }) => {
  await mockBilling(page);
  await page.route('**/api/users/supporters', (route) => route.fulfill({ json: { supporters: [{ handle: 'patron', name: 'Pat' }, { handle: 'brickfan', name: 'Brick Fan' }] } }));
  await page.goto('/#/pro');
  const wall = page.locator('.bv-prowall');
  await expect(wall.getByRole('heading', { name: 'Thanks to our supporters' })).toBeVisible();
  await expect(wall.getByRole('link', { name: 'Pat' })).toHaveAttribute('href', '#/u/patron');
  await expect(page.getByText('Retirement alerts first')).toBeVisible();
  await page.screenshot({ path: process.env.PRO_SHOT || 'test-results/pro-wall.png', fullPage: true });
});
