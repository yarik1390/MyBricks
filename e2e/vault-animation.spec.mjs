import { expect, test } from './fixtures.mjs';

test.use({ viewport: { width: 390, height: 844 } });

const spread = (samples, key) => Math.max(...samples.map((sample) => sample[key])) - Math.min(...samples.map((sample) => sample[key]));

test('Vault hero value animation pins its final width until interpolation finishes', async ({ page }) => {
  // Enter through another route so the constrained row CSS is present before
  // Vault's first 0 → total animation begins.
  await page.goto('/#/me', { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: '.hero > .u-row { width: 260px; }' });
  await page.evaluate(() => { location.hash = '#/'; });

  const value = page.locator('#heroValue');
  await expect(value).toBeVisible();

  const samples = await page.evaluate(async () => {
    const el = document.querySelector('#heroValue');
    const row = el?.parentElement;
    if (!el || !row) throw new Error('hero value row not rendered');

    const frames = [];
    const start = performance.now();
    while (performance.now() - start < 900) {
      const valueRect = el.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const deltaRect = row.querySelector('.delta')?.getBoundingClientRect();
      frames.push({
        relativeTop: valueRect.top - rowRect.top,
        height: valueRect.height,
        rowHeight: rowRect.height,
        deltaRelativeTop: deltaRect ? deltaRect.top - rowRect.top : null,
        minWidth: getComputedStyle(el).minWidth,
        text: el.textContent,
        fontsLoaded: document.fonts.status === 'loaded',
      });
      await new Promise(requestAnimationFrame);
    }
    return frames.filter(({ fontsLoaded }) => fontsLoaded);
  });

  expect(samples.length).toBeGreaterThan(1);
  expect(samples.every(({ deltaRelativeTop }) => deltaRelativeTop != null)).toBe(true);
  const animatedSamples = samples.filter(({ minWidth }) => minWidth !== 'auto' && Number.parseFloat(minWidth) > 0);
  expect(animatedSamples.length).toBeGreaterThan(1);
  expect(spread(animatedSamples, 'relativeTop')).toBeLessThan(0.5);
  expect(spread(animatedSamples, 'height')).toBeLessThan(0.5);
  expect(spread(animatedSamples, 'rowHeight')).toBeLessThan(0.5);
  expect(spread(animatedSamples, 'deltaRelativeTop')).toBeLessThan(0.5);
  expect(samples.at(-1)?.minWidth).toBe('auto');
});

test('Vault hero value retains the final accessible amount while its digits animate', async ({ page }) => {
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });

  const value = page.locator('#heroValue');
  await expect(value).toHaveAttribute('aria-label', '$850.00');
  await expect(value).toHaveAttribute('aria-live', 'off');
  await expect(value).toContainText('$850.00');
});

test('reduced motion renders the final Vault hero value without interpolation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });

  const value = page.locator('#heroValue');
  await expect(value).toContainText('$850.00');
  await expect(value).toHaveCSS('min-width', 'auto');
});
