import { test, expect } from './fixtures.mjs';

// Regressions reported on the Android app after the 2026 redesign shipped.
// The Capacitor shell injects the system-bar insets as --safe-area-inset-*,
// which the hermetic suite otherwise never sets.
test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

const INSETS = ':root{--safe-area-inset-top:40px !important;--safe-area-inset-bottom:24px !important}';

test('the status-bar inset is applied once, not by both <body> and the page', async ({ page }) => {
  await page.goto('/#/');
  await page.addStyleTag({ content: INSETS });
  const title = page.locator('#vaultPage .bv-topbar h1');
  await expect(title).toBeVisible();
  const top = await title.evaluate((el) => el.getBoundingClientRect().top);
  // 40px inset + the top bar's own padding; the doubled inset put it at ~98px.
  expect(top).toBeGreaterThanOrEqual(40);
  expect(top).toBeLessThan(80);

  await page.goto('/#/set/75192-1');
  await page.addStyleTag({ content: INSETS });
  const back = page.locator('.bv-sethero__bar button, .bv-sethero__bar a').first();
  await expect(back).toBeVisible();
  const backTop = await back.evaluate((el) => el.getBoundingClientRect().top);
  expect(backTop).toBeGreaterThanOrEqual(40);
  expect(backTop).toBeLessThan(64);
});

test('tapping a set opens it even when View Transitions never run their callback', async ({ page }) => {
  // Android WebView could leave a transition's snapshot stuck over the live
  // page. Model the worst case: a transition that never starts.
  await page.addInitScript(() => {
    window.__vtCalls = 0;
    document.startViewTransition = () => {
      window.__vtCalls++;
      const never = new Promise(() => {});
      return { finished: never, ready: never, updateCallbackDone: never, skipTransition() {} };
    };
  });
  await page.goto('/#/');
  const row = page.locator('.vault-row').first();
  await expect(row).toBeVisible();
  const box = await row.boundingBox();
  await page.touchscreen.tap(box.x + 30, box.y + box.height / 2);
  await expect(page).toHaveURL(/#\/set\/75192-1$/);
  await expect(page.locator('.bv-setpage h1, #root h1').first()).toHaveText('Millennium Falcon');
  expect(await page.evaluate(() => window.__vtCalls)).toBe(0);
});

test('Coming soon renders full-width rows with names under a translated title', async ({ page }) => {
  await page.route('**/api/upcoming', (route) => route.fulfill({ json: { upcoming: [
    { set_num: '10355-1', name: 'Barad-dûr Tower', price_usd: 459.99, availability: 'Nov 2026' },
    { set_num: '75419-1', name: 'Death Star', price_usd: 999.99 },
  ] } }));
  await page.goto('/#/add');
  const section = page.locator('section[aria-labelledby="comingSoonTitle"]');
  await expect(section).toBeVisible();
  await expect(page.locator('#comingSoonTitle')).toHaveText('Coming soon');
  const rows = section.locator('[data-cs-open]');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Barad-dûr Tower');
  const list = await section.locator('#comingSoonList').boundingBox();
  const first = await rows.first().boundingBox();
  const second = await rows.nth(1).boundingBox();
  // Stacked rows spanning the card, not a squeezed horizontal rail.
  expect(first.width).toBeGreaterThan(list.width - 4);
  expect(second.y).toBeGreaterThanOrEqual(first.y + first.height - 1);
  await rows.nth(1).click();
  await expect(page).toHaveURL(/#\/set\/75419-1$/);
});

test('on the Android app the Scan button offers every method before the barcode scanner', async ({ page }) => {
  await page.addInitScript(() => {
    window.__scans = 0;
    const noop = () => Promise.resolve({ remove() {} });
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        App: { addListener: noop, toggleBackButtonHandler: () => Promise.resolve() },
        BarcodeScanner: {
          isSupported: () => Promise.resolve({ supported: true }),
          // Closing ML Kit's Activity without a code resolves with no barcodes.
          scan: () => { window.__scans++; return Promise.resolve({ barcodes: [] }); },
        },
      },
    };
  });
  await page.goto('/#/');
  await page.locator('#bvFab').click();
  const overlay = page.locator('#scanOverlay.open');
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('.bv-scan__seg [data-mode="image"]')).toBeVisible();
  await expect(overlay.locator('.bv-scan__seg [data-mode="shelf"]')).toBeVisible();
  await expect(overlay.locator('#scanTypeBtn')).toBeVisible();
  const scanBarcode = overlay.locator('#nativeRescanBtn');
  await expect(scanBarcode).toBeVisible();
  expect(await page.evaluate(() => window.__scans)).toBe(0);

  await scanBarcode.click();
  await expect.poll(() => page.evaluate(() => window.__scans)).toBe(1);
  // Backing out of the barcode scanner returns to the method switcher.
  await expect(overlay.locator('#nativeRescanBtn')).toBeVisible();
  await expect(overlay.locator('.bv-scan__seg [data-mode="image"]')).toBeVisible();
});

test('switching to Photo while the native scanner check runs never launches ML Kit', async ({ page }) => {
  await page.addInitScript(() => {
    window.__scans = 0;
    const noop = () => Promise.resolve({ remove() {} });
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        App: { addListener: noop, toggleBackButtonHandler: () => Promise.resolve() },
        BarcodeScanner: {
          // A slow support check: the user picks Photo before it answers.
          isSupported: () => new Promise((resolve) => setTimeout(() => resolve({ supported: true }), 400)),
          scan: () => { window.__scans++; return Promise.resolve({ barcodes: [] }); },
        },
      },
    };
  });
  await page.goto('/#/');
  await page.locator('#bvFab').click();
  const overlay = page.locator('#scanOverlay.open');
  await overlay.locator('.bv-scan__seg [data-mode="image"]').click();
  await expect(overlay.locator('.bv-scan')).toHaveAttribute('data-mode', 'image');
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => window.__scans)).toBe(0);
  await expect(overlay.locator('.bv-scan')).toHaveAttribute('data-mode', 'image');
  await expect(overlay.locator('.bv-scan')).not.toHaveClass(/is-native/);
});

test('tapping a set photo opens the set in grids and on the Wishlist', async ({ page }) => {
  const withPhoto = { set_num: '75192-1', name: 'Millennium Falcon', theme: 'Star Wars', current_value: 850, image_url: '/icon-512.png' };
  await page.route('**/api/sets/search*', (route) => route.fulfill({ json: { sets: [withPhoto], total: 1, hasMore: false } }));
  await page.route('**/api/wishlist', (route) => (route.request().method() === 'GET'
    ? route.fulfill({ json: { wishlist: [{ id: 'w1', ...withPhoto }], unread_alerts: 0 } })
    : route.fallback()));
  const tapPhoto = async (selector) => {
    const img = page.locator(selector).first();
    await expect(img).toBeVisible();
    const box = await img.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page).toHaveURL(/#\/set\/75192-1$/);
  };
  await page.goto('/#/add');
  await expect(page.locator('#catalogCount')).toBeVisible();
  if (await page.locator('#catalogLayoutToggle').getAttribute('aria-pressed') === 'true') await page.locator('#catalogLayoutToggle').click();
  await tapPhoto('#catalogResults .bv-tile img.set-photo');
  await page.goto('/#/wishlist');
  await tapPhoto('.bv-wlrow img.set-photo');
});

test('the set page photo gets most of the hero, below the status bar', async ({ page }) => {
  await page.route('**/api/sets/75192-1*', (route) => route.fulfill({ json: { set: { set_num: '75192-1', name: 'Millennium Falcon', theme: 'Star Wars', year: 2017, current_value: 850, image_url: '/icon-512.png' }, entry: null } }));
  await page.goto('/#/set/75192-1');
  await page.addStyleTag({ content: INSETS });
  const media = page.locator('.bv-sethero__media');
  await expect(media).toBeVisible();
  const box = await media.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(40 + 48); // below the status bar and the back/share row
  expect(box.height).toBeGreaterThanOrEqual(200); // was ~130px on Android
  expect(box.width).toBeGreaterThanOrEqual(360);
});

test('Coming soon rows show the catalog photo', async ({ page }) => {
  await page.route('**/api/upcoming', (route) => route.fulfill({ json: { upcoming: [
    { set_num: '21065-1', name: 'Sagrada Família', price_usd: 799.99, availability: 'Coming Soon', image_url: '/icon-512.png' },
  ] } }));
  await page.goto('/#/add');
  await expect(page.locator('#comingSoonList [data-cs-open] img.set-photo')).toHaveCount(1);
});

test('the native scan picker keeps its hint clear of the button and lights the status-bar icons', async ({ page }) => {
  await page.addInitScript(() => {
    window.__bars = [];
    const noop = () => Promise.resolve({ remove() {} });
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        App: { addListener: noop, toggleBackButtonHandler: () => Promise.resolve() },
        SystemBars: { setStyle: (o) => { window.__bars.push(o); return Promise.resolve(); } },
        BarcodeScanner: { isSupported: () => Promise.resolve({ supported: true }), scan: () => Promise.resolve({ barcodes: [] }) },
      },
    };
  });
  await page.goto('/#/');
  await page.locator('#bvFab').click();
  const cta = page.locator('#scanOverlay.open #nativeRescanBtn');
  await expect(cta).toBeVisible();
  const hint = await page.locator('#scanHint').boundingBox();
  const button = await cta.boundingBox();
  expect(hint.y + hint.height).toBeLessThanOrEqual(button.y); // was drawn underneath the button
  expect(await page.evaluate(() => window.__bars.at(-1))).toMatchObject({ lightIcons: true });

  await page.locator('#scanCloseBtn').click();
  await expect(page.locator('#scanOverlay.open')).toHaveCount(0);
  expect(await page.evaluate(() => window.__bars.at(-1))).toMatchObject({ lightIcons: false });
});
