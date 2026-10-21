import { test, expect } from './fixtures.mjs';

// Shelf Snap is a Pro perk: free accounts see how many of their monthly shelf
// scans are left, and an upsell (Pro, or scan one set) once they run out.
// Single photo and barcode scans are untouched.

const SHOTS = process.env.SHELF_SHOTS_DIR || '';
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

const quota = (remaining, { pro = false } = {}) => ({
  pro,
  photo: { used: 0, limit: pro ? 100 : 20, remaining: pro ? 100 : 20, period: 'day' },
  shelf: pro
    ? { used: 20 - remaining, limit: 20, remaining, period: 'day' }
    : { used: 3 - remaining, limit: 3, remaining, period: 'month' },
});

async function openShelf(page) {
  await page.evaluate(async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }], getVideoTracks: () => [] }) },
    });
    const scanner = await import('/js/components/scanner.js');
    scanner.openScan('image', { deferStart: true, shelf: true });
  });
}

async function captureStill(page) {
  await page.evaluate(async () => {
    const scanner = await import('/js/components/scanner.js');
    const c = document.createElement('canvas');
    c.width = 900; c.height = 1200;
    const g = c.getContext('2d');
    g.fillStyle = '#6b5a45'; g.fillRect(0, 0, 900, 1200);
    g.fillStyle = '#c9a227'; g.fillRect(72, 216, 351, 408);
    await new Promise((r) => {
      const img = document.querySelector('#scanPhotoPreview');
      img.addEventListener('load', r, { once: true });
      scanner.finishPhotoCapture(c.toDataURL('image/jpeg', 0.8));
    });
  });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
});

test('the Shelf tab says how many free shelf scans are left', async ({ page }) => {
  await page.route('**/api/scan/quota', (route) => route.fulfill({ json: quota(2) }));
  await page.goto('/#/add', { waitUntil: 'domcontentloaded' });
  await openShelf(page);
  await expect(page.locator('#scanHint')).toContainText('2 of 3 free shelf scans left this month');
  await shot(page, '1-shelf-tab-free');
});

test('a free shelf scan result shows what is left with a link to Pro', async ({ page }) => {
  await page.route('**/api/scan/quota', (route) => route.fulfill({ json: quota(3) }));
  await page.route('**/api/scan/identify', (route) => route.fulfill({ json: {
    identified: true,
    confidence: 'high',
    sets: [
      { set_num: '75192-1', name: 'Millennium Falcon', theme: 'Star Wars', year: 2017, current_value: 850, match_confidence: 'high' },
      { set_num: '10497-1', name: 'Galaxy Explorer', theme: 'Icons', year: 2022, current_value: 110, match_confidence: 'medium' },
    ],
    minifigs: [],
    quota: { used: 1, limit: 3, remaining: 2, period: 'month', pro: false },
  } }));
  await page.goto('/#/add', { waitUntil: 'domcontentloaded' });
  await openShelf(page);
  await captureStill(page);
  await expect(page.locator('#shelfQuotaLeft')).toContainText('2 of 3 free shelf scans left this month');
  await expect(page.locator('#shelfQuotaPro')).toHaveAttribute('href', '#/pro');
  await shot(page, '2-shelf-result-free');
});

test('the 4th free shelf scan in a month shows the Pro upsell', async ({ page }) => {
  await page.route('**/api/scan/quota', (route) => route.fulfill({ json: quota(1) }));
  await page.route('**/api/scan/identify', (route) => route.fulfill({ status: 429, json: {
    error: "You've used your 3 free shelf scans this month.",
    reason: 'shelf_pro',
    quota: { used: 3, limit: 3, remaining: 0, period: 'month', pro: false },
  } }));
  await page.goto('/#/add', { waitUntil: 'domcontentloaded' });
  await openShelf(page);
  await captureStill(page);
  const sheet = page.locator('[data-upsell="shelf"]');
  await expect(sheet).toContainText('Shelf scans are a Pro perk');
  await expect(sheet).toContainText('used your 3 free shelf scans');
  await expect(page.locator('#scanGoPro')).toBeVisible();
  await page.locator('#scanOnePhoto').scrollIntoViewIfNeeded();
  await shot(page, '3-shelf-upsell');
  // "Scan one set instead" goes to the free single-photo scanner.
  await page.locator('#scanOnePhoto').click();
  await expect(page.locator('.bv-scan')).toHaveAttribute('data-mode', 'image');
});

test('opening the Shelf tab with none left goes straight to the upsell', async ({ page }) => {
  await page.route('**/api/scan/quota', (route) => route.fulfill({ json: quota(0) }));
  await page.goto('/#/add', { waitUntil: 'domcontentloaded' });
  await openShelf(page);
  await expect(page.locator('[data-upsell="shelf"]')).toBeVisible();
  await page.locator('#scanGoPro').click();
  await expect(page).toHaveURL(/#\/pro/);
});

test('Pro members see no shelf count', async ({ page }) => {
  await page.route('**/api/scan/quota', (route) => route.fulfill({ json: quota(20, { pro: true }) }));
  await page.goto('/#/add', { waitUntil: 'domcontentloaded' });
  await openShelf(page);
  await page.waitForResponse('**/api/scan/quota');
  await expect(page.locator('#scanHint')).not.toContainText('free shelf scans');
});

test('the Pro page lists shelf scans', async ({ page }) => {
  await page.goto('/#/pro', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.bv-probenefits')).toContainText('Shelf scans');
  await expect(page.locator('.bv-probenefits')).toContainText('free: 3 a month');
  await shot(page, '4-pro-page');
});
