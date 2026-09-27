import { test, expect } from './fixtures.mjs';

// Back navigation and revisits. Reported on Android: pages looked like they
// loaded from scratch on every visit, and back sometimes landed on the wrong
// page.
test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

const onRoute = (page, re) => expect(page).toHaveURL(re);

// Stub the Capacitor shell so the app wires Android's back button.
function androidShell() {
  window.__back = null;
  const noop = () => Promise.resolve({ remove() {} });
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    Plugins: {
      App: {
        addListener: (name, fn) => { if (name === 'backButton') window.__back = fn; return noop(); },
        toggleBackButtonHandler: () => Promise.resolve(),
        minimizeApp: () => { window.__minimized = true; return Promise.resolve(); },
      },
    },
  };
}
const pressBack = (page) => page.evaluate(() => window.__back({ canGoBack: history.length > 1 }));

test('Android back from a tab returns to the Vault instead of retracing every tab', async ({ page }) => {
  await page.addInitScript(androidShell);
  await page.goto('/#/');
  await expect(page.locator('#vaultPage')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__back)).toBe('function');
  await page.locator('.vault-row').first().click();
  await onRoute(page, /#\/set\/75192-1$/);
  await expect(page.locator('.bv-setpage')).toBeVisible();
  await page.evaluate(() => { location.hash = '#/add'; }); // e.g. "See all" on the set page
  await expect(page.locator('#discoverPage')).toBeVisible();
  await page.locator('#nav [data-route="/me"]').click();
  await expect(page.locator('#profilePage')).toBeVisible();
  await page.locator('#nav [data-route="/add"]').click();
  await expect(page.locator('#discoverPage')).toBeVisible();
  await page.locator('#nav [data-route="/wishlist"]').click();
  await expect(page.locator('#wishlistPage')).toBeVisible();
  await pressBack(page);
  await onRoute(page, /#\/$/);
  await expect(page.locator('#vaultPage')).toBeVisible();
});

test('Android back from a set page returns to the list it was opened from', async ({ page }) => {
  await page.addInitScript(androidShell);
  await page.goto('/#/add');
  await expect(page.locator('#catalogCount')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__back)).toBe('function');
  await page.evaluate(() => { location.hash = '#/set/75192-1'; });
  await expect(page.locator('.bv-setpage')).toBeVisible();
  // Switching the set's tab rewrites the URL in place; back still knows the way.
  await page.locator('#detailTabs button').nth(1).click();
  await pressBack(page);
  await onRoute(page, /#\/add$/);
  await expect(page.locator('#discoverPage')).toBeVisible();
});

test('a back arrow on a page opened by a link from elsewhere stays in the app', async ({ page }) => {
  // The tab showed another page first, so history.length > 1 — the old check
  // sent this back arrow out of the app.
  await page.goto('/icon-192.png');
  await page.goto('/#/set/75192-1');
  await expect(page.locator('.bv-setpage')).toBeVisible();
  await page.locator('#detailBack').click();
  await onRoute(page, /#\/$/);
  await expect(page.locator('#vaultPage')).toBeVisible();
});

test('a legacy redirect does not trap back in a loop', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.locator('#vaultPage')).toBeVisible();
  await page.evaluate(() => { location.hash = '#/blind'; });
  await onRoute(page, /#\/minifigs$/);
  await page.goBack();
  await onRoute(page, /#\/$/);
});

test('swiping a chip row from the left edge scrolls it instead of going back', async ({ page }) => {
  await page.route('**/api/themes', (route) => route.fulfill({ json: { themes: ['Star Wars', 'Icons', 'Technic', 'Ideas', 'Harry Potter', 'City', 'Architecture', 'Creator', 'Ninjago'], theme_groups: [], categories: [] } }));
  await page.goto('/#/');
  await expect(page.locator('#vaultPage')).toBeVisible();
  await page.locator('#nav [data-route="/add"]').click();
  await expect(page.locator('.bv-discover__themes')).toBeVisible();
  const swipe = (selector) => page.evaluate((selector) => {
    const target = document.querySelector(selector);
    const y = target.getBoundingClientRect().top + 10;
    const at = (x) => new Touch({ identifier: 1, target, clientX: x, clientY: y });
    const fire = (type, x) => target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true,
      touches: type === 'touchend' ? [] : [at(x)], changedTouches: [at(x)] }));
    fire('touchstart', 10); fire('touchmove', 60); fire('touchmove', 140); fire('touchend', 140);
  }, selector);
  await swipe('.bv-discover__themes .bv-chip');
  await page.waitForTimeout(300);
  await onRoute(page, /#\/add$/);
  // The same swipe on the page itself is still the edge swipe-back.
  await swipe('#discoverPage .bv-topbar');
  await onRoute(page, /#\/$/);
});

test('revisiting a page shows it straight away, without a skeleton or dimmed content', async ({ page }) => {
  await page.goto('/#/wishlist');
  await expect(page.locator('#wishlistPage')).toBeVisible();
  await page.goto('/#/me');
  await expect(page.locator('#profilePage')).toBeVisible();
  // Slow network from here: a revisit must not wait on it.
  await page.route('**/api/**', async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.fallback(); });
  for (const [tab, id] of [['/wishlist', '#wishlistPage'], ['/me', '#profilePage'], ['/wishlist', '#wishlistPage']]) {
    await page.locator(`#nav [data-route="${tab}"]`).click();
    await expect(page.locator(id)).toBeVisible({ timeout: 400 });
    expect(await page.locator('#root .skel, #root .bv-skel').count()).toBe(0);
    expect(await page.locator('#root').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  }
});

test('a set seen before opens from the device cache at once, then refreshes quietly', async ({ page }) => {
  await page.goto('/#/set/75192-1');
  await expect(page.locator('.bv-setpage h1, #root h1').first()).toHaveText('Millennium Falcon');
  // Wait for the device cache write, then reload: memory is gone, IDB is not.
  await page.waitForTimeout(400);
  await page.route('**/api/sets/75192-1*', async (route) => { await new Promise((r) => setTimeout(r, 2000)); await route.fallback(); });
  await page.reload();
  await expect(page.locator('.bv-setpage h1, #root h1').first()).toHaveText('Millennium Falcon', { timeout: 800 });
});

test('an empty wishlist the Vault already loaded opens without a skeleton', async ({ page }) => {
  await page.route('**/api/wishlist', (route) => (route.request().method() === 'GET'
    ? route.fulfill({ json: { wishlist: [], unread_alerts: [] } })
    : route.fallback()));
  await page.goto('/#/');
  await expect(page.locator('#vaultPage')).toBeVisible();
  await page.waitForTimeout(300); // the Vault's supplementary wishlist fetch
  await page.route('**/api/**', async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.fallback(); });
  await page.locator('#nav [data-route="/wishlist"]').click();
  await expect(page.locator('#wishlistPage')).toBeVisible({ timeout: 400 });
  expect(await page.locator('#root .skel, #root .bv-skel').count()).toBe(0);
});
