import { test, expect } from './fixtures.mjs';

// The scanner's top area stacks two centred pills: the Barcode/Photo mode
// toggle inside .scan-top, and the One set/Whole shelf scope row below it. The
// scope row was positioned at a hard-coded top:62px, which lands INSIDE
// .scan-top (60px of padding plus a 42px control), so the two drew on top of
// each other — visible once translated labels grew.
//
// The scanner itself needs getUserMedia, which does not exist here, so this
// mounts the same markup and class names against the real stylesheet and
// measures. That is the right target anyway: the bug was in the CSS contract
// between .scan-top and .scan-top-stack, not in the camera path.
test.use({ viewport: { width: 390, height: 844 } });

const MOUNT = (barcodeLabel, photoLabel, oneSet, wholeShelf) => `
  <div class="scan-video-wrap" style="position:relative;height:844px;">
    <div class="scan-top" style="justify-content: space-between;">
      <button aria-label="Close">x</button>
      <div class="scan-mode-toggle" role="group" style="display:flex;align-items:center;">
        <button class="active">${barcodeLabel}</button><button>${photoLabel}</button>
      </div>
      <div style="width:42px;"></div>
    </div>
    <div class="scan-shelf-row scan-top-stack" role="group"
         style="position:absolute;left:0;right:0;display:flex;justify-content:center;z-index:3;">
      <div style="display:inline-flex;border-radius:999px;overflow:hidden;">
        <button style="font-size:12px;font-weight:700;padding:7px 14px;white-space:nowrap;">${oneSet}</button>
        <button style="font-size:12px;font-weight:700;padding:7px 14px;white-space:nowrap;">${wholeShelf}</button>
      </div>
    </div>
  </div>`;

const CASES = [
  { name: 'English', args: ['Barcode', 'Photo', 'One set', 'Whole shelf'] },
  // The Ukrainian labels that exposed the overlap on a real device.
  { name: 'Ukrainian', args: ['Штрихкод', 'Фото', 'Один набір', 'Уся полиця'] },
];

test('photo result hides the inactive camera chrome', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('body').evaluate((body) => {
    body.innerHTML = `
      <div class="scan-video-wrap has-result" style="position:relative;height:844px;">
        <video class="scan-video"></video>
        <div class="scan-top-stack">One set / Whole shelf</div>
        <div class="scan-frame"></div>
        <div class="scan-result show">Set found</div>
      </div>`;
  });

  for (const selector of ['.scan-video', '.scan-frame', '.scan-top-stack']) {
    await expect(page.locator(selector)).toHaveCSS('opacity', '0');
  }
  await expect(page.locator('.scan-result')).toBeVisible();
});

for (const { name, args } of CASES) {
  test(`scanner top controls do not overlap (${name})`, async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate((html) => { document.body.innerHTML = html; }, MOUNT(...args));
    await page.waitForTimeout(120);

    const toggle = await page.locator('.scan-mode-toggle').boundingBox();
    const shelf = await page.locator('.scan-shelf-row > div').boundingBox();
    expect(toggle, 'mode toggle should render').toBeTruthy();
    expect(shelf, 'scope row should render').toBeTruthy();

    expect(shelf.y, `${name}: scope row starts before the mode toggle ends`)
      .toBeGreaterThanOrEqual(toggle.y + toggle.height);
  });
}

test('captured photo remains visible while live video is hidden', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('body').evaluate((body) => {
    body.innerHTML = `
      <div class="scan-video-wrap has-captured-photo" style="height:844px;">
        <video class="scan-video"></video>
        <img class="scan-photo-preview" alt="Captured photo"
             src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">
      </div>`;
  });
  const video = page.locator('.scan-video');
  const preview = page.locator('.scan-photo-preview');
  await expect(video).toHaveCSS('opacity', '0');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveCSS('object-fit', 'cover');
});
