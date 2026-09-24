import { test, expect } from './fixtures.mjs';

// The scanner's top bar packs three things into one row: the Close / Done pill,
// the Barcode · Photo · Shelf segmented control and the torch. They share a
// 3-column grid; translated labels (Ukrainian, German) are much longer than the
// English ones, and the middle column has to give way (ellipsis) rather than
// drawing over its neighbours.
//
// The scanner needs getUserMedia, which does not exist here, so this mounts the
// same markup and class names the scanner renders against the real stylesheet
// and measures. The bug class is in the CSS contract, not the camera path.
test.use({ viewport: { width: 390, height: 844 } });

const MOUNT = ({ close, modes, torch = true }) => `
  <div id="scanOverlay" class="open" style="position:fixed;inset:0;display:flex;">
    <div class="bv-scan" data-mode="barcode" style="height:844px;">
      <video class="bv-scan__video"></video>
      <div class="bv-scan__top">
        <button type="button" class="bv-scan__pill" id="scanCloseBtn"><svg viewBox="0 0 24 24"></svg><span>${close}</span></button>
        <div class="bv-scan__seg scan-mode-toggle" role="group">${modes.map((m, i) => `<button type="button" aria-pressed="${i === 0}">${m}</button>`).join('')}</div>
        <button type="button" class="bv-scan__round" id="scanTorchBtn" aria-pressed="false"${torch ? '' : ' hidden'}><svg viewBox="0 0 24 24"></svg></button>
      </div>
      <div class="bv-scan__frame"></div>
      <div class="bv-scan__hint">Point at the barcode</div>
    </div>
  </div>`;

const CASES = [
  { name: 'English', args: { close: 'Close', modes: ['Barcode', 'Photo', 'Shelf'] } },
  { name: 'English, three sets added', args: { close: 'Done · 3', modes: ['Barcode', 'Photo', 'Shelf'] } },
  // The Ukrainian labels are the widest the scanner renders.
  { name: 'Ukrainian', args: { close: 'Готово · 3', modes: ['Штрихкод', 'Фото', 'Полиця'] } },
  { name: 'German', args: { close: 'Schließen', modes: ['Barcode', 'Foto', 'Regal'] } },
];

const overlaps = (a, b) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5
  && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

for (const { name, args } of CASES) {
  test(`scanner top bar controls do not overlap (${name})`, async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate((html) => { document.body.innerHTML = html; }, MOUNT(args));
    await page.waitForTimeout(120);

    const close = await page.locator('#scanCloseBtn').boundingBox();
    const seg = await page.locator('.bv-scan__seg').boundingBox();
    const torch = await page.locator('#scanTorchBtn').boundingBox();
    expect(close && seg && torch, 'all three controls render').toBeTruthy();
    expect(overlaps(close, seg), `${name}: Close runs into the mode switch`).toBe(false);
    expect(overlaps(seg, torch), `${name}: mode switch runs into the torch`).toBe(false);
    for (const [label, box] of [['Close', close], ['modes', seg], ['torch', torch]]) {
      expect(box.x, `${name}: ${label} off the left edge`).toBeGreaterThanOrEqual(-0.5);
      expect(box.x + box.width, `${name}: ${label} off the right edge`).toBeLessThanOrEqual(390.5);
    }
    // Each mode button stays a usable tap target even when labels are long.
    const heights = await page.locator('.bv-scan__seg button').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(36);
  });
}

test('a result sheet hides the idle frame and hint', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('body').evaluate((body) => {
    body.innerHTML = `
      <div class="bv-scan has-result" style="position:relative;height:844px;">
        <video class="bv-scan__video"></video>
        <div class="bv-scan__frame"></div>
        <div class="bv-scan__hint">Point at the barcode</div>
        <div class="bv-scan__bottom"><button type="button" class="bv-scan__round">T</button></div>
        <div class="bv-scan__sheet show">Set found</div>
      </div>`;
  });
  for (const selector of ['.bv-scan__frame', '.bv-scan__hint', '.bv-scan__bottom']) {
    await expect(page.locator(selector)).toHaveCSS('opacity', '0');
  }
  await expect(page.locator('.bv-scan__sheet')).toBeVisible();
});

test('captured photo remains visible while live video is hidden', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('body').evaluate((body) => {
    body.innerHTML = `
      <div class="bv-scan is-photo has-captured-photo" style="position:relative;height:844px;">
        <video class="bv-scan__video"></video>
        <img class="bv-scan__photo" alt="Captured photo"
             src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">
      </div>`;
  });
  const video = page.locator('.bv-scan__video');
  const preview = page.locator('.bv-scan__photo');
  await expect(video).toHaveCSS('opacity', '0');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveCSS('object-fit', 'cover');
});
