import { test, expect } from './fixtures.mjs';

// Photo scan choreography: a pointer searches the frozen still while the scan
// runs, then visits each set found (located boxes from Shelf Snap), locks on,
// names it and leaves a numbered marker before the result sheet rises.

const SHELF = {
  identified: true,
  confidence: 'high',
  sets: [
    { set_num: '75192-1', name: 'Millennium Falcon', theme: 'Star Wars', year: 2017, current_value: 850, match_confidence: 'high', scan_box: [180, 80, 520, 470] },
    { set_num: '10497-1', name: 'Galaxy Explorer', theme: 'Icons', year: 2022, current_value: 110, match_confidence: 'medium', scan_box: [560, 520, 880, 930] },
  ],
  minifigs: [],
};

async function captureShelfStill(page, { shelf = true } = {}) {
  await page.evaluate(async (shelfMode) => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }], getVideoTracks: () => [] }) },
    });
    const scanner = await import('/js/components/scanner.js');
    scanner.openScan('image', { deferStart: true, shelf: shelfMode });
    const c = document.createElement('canvas');
    c.width = 900; c.height = 1200;
    const g = c.getContext('2d');
    g.fillStyle = '#6b5a45'; g.fillRect(0, 0, 900, 1200);
    g.fillStyle = '#c9a227'; g.fillRect(72, 216, 351, 408);
    g.fillStyle = '#2b6cb0'; g.fillRect(468, 672, 369, 384);
    await new Promise((r) => {
      const img = document.querySelector('#scanPhotoPreview');
      img.addEventListener('load', r, { once: true });
      scanner.finishPhotoCapture(c.toDataURL('image/jpeg', 0.8));
    });
  }, shelf);
}

test('shelf scan searches the photo, focuses each set, then shows results', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let release;
  const answered = new Promise((r) => { release = r; });
  await page.route('**/api/scan/identify', async (route) => {
    await answered;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SHELF) });
  });
  await page.goto('/#/add', { waitUntil: 'domcontentloaded' });
  await captureShelfStill(page);

  // Searching: the pointer roams the still and the sheet stays down.
  const wrap = page.locator('.bv-scan');
  await expect(wrap).toHaveClass(/is-seeking/);
  await expect(page.locator('.bv-seek__ret')).toBeVisible();
  await expect(page.locator('#scanResult')).not.toBeInViewport();
  const first = await page.locator('.bv-seek__ret').evaluate((n) => n.style.transform);
  await page.waitForTimeout(1000);
  const later = await page.locator('.bv-seek__ret').evaluate((n) => n.style.transform);
  expect(later).not.toBe(first);

  release();
  // Found: it locks on each set in turn and names it.
  await expect(page.locator('#scanChip')).toContainText('75192 · Millennium Falcon');
  await expect(page.locator('.bv-seek__ret')).toHaveClass(/is-lock/);
  await expect(page.locator('#scanChip')).toContainText('10497 · Galaxy Explorer');
  await expect(page.locator('.bv-seek__mark')).toHaveCount(2);

  // Then the results rise, with the markers left on the photo.
  await expect(page.locator('#scanResult')).toContainText('Millennium Falcon');
  await expect(wrap).not.toHaveClass(/is-seeking/);
  await expect(page.locator('.bv-seek__mark')).toHaveCount(2);
  const mark = await page.locator('.bv-seek__mark').first().boundingBox();
  // Box [180, 80, 520, 470] on a 900×1200 still covering 390×844 (scale ≈ .703).
  expect(Math.abs(mark.y - (0.18 * 1200 * 0.7033 - 6))).toBeLessThan(6);
  await expect(page.locator('#scanChip')).toBeHidden();
});

test('a single photo focuses the aimed frame before the result', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/scan/identify', async (route) => {
    await new Promise((r) => setTimeout(r, 600));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ identified: true, confidence: 'high', sets: [{ ...SHELF.sets[0], scan_box: undefined }] }) });
  });
  await page.goto('/#/add', { waitUntil: 'domcontentloaded' });
  await captureShelfStill(page, { shelf: false });
  await expect(page.locator('#scanChip')).toContainText('75192 · Millennium Falcon');
  await expect(page.locator('#scanResult')).toContainText('Millennium Falcon');
  await expect(page.locator('.bv-seek__mark')).toHaveCount(0);
});

test('a miss drops the pointer and shows the miss card', async ({ page }) => {
  await page.route('**/api/scan/identify', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ identified: false, reasoning: "Couldn't identify any sets on that shelf." }),
  }));
  await page.goto('/#/add', { waitUntil: 'domcontentloaded' });
  await captureShelfStill(page);
  await expect(page.locator('#scanResult')).toContainText("Couldn't identify");
  await expect(page.locator('.bv-seek')).toHaveCount(0);
  await expect(page.locator('.bv-scan')).not.toHaveClass(/is-seeking/);
});

test('reduced motion skips the search animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/scan/identify', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SHELF) }));
  await page.goto('/#/add', { waitUntil: 'domcontentloaded' });
  await captureShelfStill(page);
  await expect(page.locator('#scanResult')).toContainText('Millennium Falcon');
  await expect(page.locator('.bv-seek')).toHaveCount(0);
});

test('an exhausted AI cascade shows its reason, not a raw error code', async ({ page }) => {
  await page.route('**/api/scan/identify', (route) => route.fulfill({
    status: 503, contentType: 'application/json',
    body: JSON.stringify({ identified: false, reason: 'provider_unavailable', reasoning: 'Tried 3 AI providers without a confident match. Try a clearer photo, or scan the barcode.' }),
  }));
  await page.goto('/#/add', { waitUntil: 'domcontentloaded' });
  await captureShelfStill(page);
  const card = page.locator('#scanResult');
  await expect(card).toContainText('Tried 3 AI providers without a confident match');
  await expect(card).not.toContainText('provider_unavailable');
  await expect(card).not.toContainText('Error:');
  await expect(card.locator('#scanRetry')).toBeVisible();
  await expect(page.locator('.bv-seek')).toHaveCount(0);
});
