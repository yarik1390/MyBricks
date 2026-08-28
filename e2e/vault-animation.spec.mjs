import { expect, test } from './fixtures.mjs';

test.use({ viewport: { width: 390, height: 844 } });

test('Vault hero value animation keeps its layout box vertically stable', async ({ page }) => {
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });

  const value = page.locator('#heroValue');
  await expect(value).toBeVisible();

  const samples = await page.evaluate(async () => {
    const el = document.querySelector('#heroValue');
    if (!el) throw new Error('hero value not rendered');

    const frames = [];
    const start = performance.now();
    while (performance.now() - start < 900) {
      const rect = el.getBoundingClientRect();
      const hero = el.closest('.hero');
      frames.push({
        relativeTop: rect.top - (hero?.getBoundingClientRect().top ?? 0),
        height: rect.height,
        text: el.textContent,
        fontsLoaded: document.fonts.status === 'loaded',
      });
      await new Promise(requestAnimationFrame);
    }
    return frames.filter(({ fontsLoaded }) => fontsLoaded);
  });

  const topSpread = Math.max(...samples.map(({ relativeTop }) => relativeTop)) - Math.min(...samples.map(({ relativeTop }) => relativeTop));
  const heightSpread = Math.max(...samples.map(({ height }) => height)) - Math.min(...samples.map(({ height }) => height));

  expect(topSpread).toBeLessThan(0.5);
  expect(heightSpread).toBeLessThan(0.5);
});

test('Vault hero value retains the final accessible amount while its digits animate', async ({ page }) => {
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });

  const value = page.locator('#heroValue');
  await expect(value).toHaveAttribute('aria-label', '$850.00');
  await expect(value).toHaveAttribute('aria-live', 'off');
  await expect(value).toContainText('$850.00');
});

test('reduced motion renders the final Vault value without intermediate animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('#heroValue')).toHaveText('$850.00');
});
