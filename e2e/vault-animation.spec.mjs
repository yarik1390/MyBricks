import { expect, test } from './fixtures.mjs';

test.use({ viewport: { width: 390, height: 844 } });

const spread = (samples, key) => Math.max(...samples.map((sample) => sample[key])) - Math.min(...samples.map((sample) => sample[key]));

test('Vault hero value animation pins its final width until interpolation finishes', async ({ page }) => {
  // Font readiness was previously checked only after the first route had
  // already started its 750ms interpolation. On a cold renderer that left one
  // (or zero) eligible samples, even though the animation itself was correct.
  // Prepare fonts, the constrained row, and the sampler before changing route.
  await page.goto('/#/me', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: '.hero > .u-row { width: 260px; }' });
  await page.evaluate(() => {
    const frames = [];
    let sampling = false;
    const sample = () => {
      const el = document.querySelector('#heroValue');
      const row = el?.parentElement;
      if (!el || !row) return;
      const valueRect = el.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const delta = row.querySelector('.delta');
      const deltaRect = delta && getComputedStyle(delta).display !== 'none' ? delta.getBoundingClientRect() : null;
      frames.push({
        relativeTop: valueRect.top - rowRect.top,
        height: valueRect.height,
        rowHeight: rowRect.height,
        deltaRelativeTop: deltaRect ? deltaRect.top - rowRect.top : null,
        minWidth: getComputedStyle(el).minWidth,
        text: el.textContent,
        fontsLoaded: document.fonts.status === 'loaded',
      });
    };
    const observer = new MutationObserver((mutations) => {
      if (sampling || !mutations.some(({ target }) => target.id === 'heroValue' && target.style.minWidth)) return;
      sampling = true;
      const deadline = performance.now() + 900;
      const tick = () => {
        sample();
        if (performance.now() < deadline) requestAnimationFrame(tick);
        else { observer.disconnect(); window.__vaultAnimationFrames = frames; }
      };
      requestAnimationFrame(tick);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'], subtree: true });
    window.__vaultAnimationFrames = null;
  });
  await page.evaluate(() => { location.hash = '#/'; });

  const value = page.locator('#heroValue');
  await expect(value).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__vaultAnimationFrames?.length ?? 0)).toBeGreaterThan(1);
  const samples = await page.evaluate(() => window.__vaultAnimationFrames.filter(({ fontsLoaded }) => fontsLoaded));

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
