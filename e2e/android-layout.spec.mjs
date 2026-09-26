import { test, expect } from './fixtures.mjs';

test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
const output = 'artifacts/android-room-2026-09-14';
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const language of ['en', 'uk']) for (const theme of ['light', 'dark']) {
  test(`Android shared layouts keep actions reachable: ${language} ${theme}`, async ({ page }) => {
    test.setTimeout(90000);
    await page.addInitScript(({ language, theme }) => {
      localStorage.setItem('bv.lang', language);
      localStorage.setItem('bv_theme', theme);
    }, { language, theme });
    await page.route('**/api/minifigs?*', route => route.fulfill({ json: { minifigs: [], total: 0 } }));
    await page.route('**/api/subcollections', route => route.fulfill({ json: { subcollections: [] } }));
    for (const [route, ready, name] of [
      ['/', '#setList', 'vault'], ['/add', '#catalogLayoutToggle', 'catalog'],
      ['/wishlist', '.page', 'wishlist'], ['/collections', '#subcollectionsPage', 'collections'],
      ['/minifigs?owned=0', '#figSearch', 'minifigures'], ['/me', '#themeSeg', 'profile'],
    ]) {
      await page.goto(`/#${route}`);
      await expect(page.locator(ready)).toBeVisible();
      for (const width of [320, 390, 412]) {
        await page.setViewportSize({ width, height: 915 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        // View content can mount before the router restores the nav chrome.
        await expect(page.locator('#nav')).toBeVisible();
        const nav = await page.locator('#nav').boundingBox();
        const fab = page.locator('#bvFab');
        if (await fab.isVisible()) {
          // The Scan FAB floats 16dp above the bar, right-aligned, 56dp tall.
          const bounds = await fab.boundingBox();
          expect(bounds.y + bounds.height).toBeLessThanOrEqual(nav.y);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
          expect(bounds.width).toBeGreaterThanOrEqual(48);
          expect(bounds.height).toBeGreaterThanOrEqual(48);
        }
        if (name === 'catalog') {
          const toggle = await page.locator('#catalogLayoutToggle').boundingBox();
          expect(toggle.x + toggle.width).toBeLessThanOrEqual(width);
          expect(toggle.height).toBeGreaterThanOrEqual(48);
        }
        // Content may pass under the floating FAB while scrolling; at the end
        // of the page nothing may remain covered by it.
        for (const position of [1]) {
          await page.evaluate(position => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * position), position);
          const covered = await page.locator('#root').evaluate(root => [...root.querySelectorAll('a,button,summary')].filter(el => {
            const r = el.getBoundingClientRect();
            const y = r.top + r.height / 2, x = r.left + r.width / 2;
            const navTop = document.querySelector('#nav').getBoundingClientRect().top;
            return r.width > 0 && r.height > 0 && el.checkVisibility?.({ visibilityProperty: true }) !== false && y >= 0 && y < navTop && x >= 0 && x < innerWidth && document.elementFromPoint(x,y)?.closest('#bvFab');
          }).map(el => el.textContent));
          expect(covered).toEqual([]);
        }
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${output}/${name}-${language}-${theme}-after.png`, animations: 'disabled' });
      if (name === 'vault') {
        // Secondary vault actions (advisor, export, select…) live in More options.
        const tool = await page.locator('#vaultMoreBtn').boundingBox();
        expect(tool.height).toBeGreaterThanOrEqual(48);
        expect(tool.y + tool.height).toBeLessThanOrEqual((await page.locator('#nav').boundingBox()).y);
        await page.screenshot({ path: `${output}/vault-links-${language}-${theme}-after.png`, animations: 'disabled' });
      }
      if (name === 'collections') {
        await page.locator('#bvFab').click();
        await expect(page.locator('#collectionEditor input').first()).toBeVisible();
      }
      if (name === 'profile') {
        const contrast = await page.locator('#themeSeg button.active').evaluate(el => {
          const luminance = color => color.match(/[\d.]+/g).slice(0,3).map(Number).map(v => {
            v /= 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          }).reduce((sum,v,i) => sum + v * [0.2126,0.7152,0.0722][i], 0);
          const style = getComputedStyle(el), a = luminance(style.color), b = luminance(style.backgroundColor);
          return (Math.max(a,b) + 0.05) / (Math.min(a,b) + 0.05);
        });
        expect(contrast).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
}

test('touch room fits translated controls in portrait and landscape', async ({ page }) => {
  test.setTimeout(90000);
  await page.addInitScript(() => localStorage.setItem('bv.lang', 'uk'));
  await page.goto('/#/room');
  await expect(page.locator('#roomStage')).toHaveAttribute('data-room-state', 'ready');
  await expect(page.locator('#roomMouse')).toBeHidden();
  await expect(page.locator('#roomJoystick')).toBeVisible();
  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 412, height: 915 }, { width: 915, height: 412 }]) {
    await page.setViewportSize(viewport);
    const bar = await page.locator('.bv-room-bar').boundingBox();
    const status = await page.locator('.showroom-notices').boundingBox();
    expect(overlaps(bar, status)).toBe(false);
    const find = await page.locator('#roomFind').boundingBox();
    const list = await page.locator('#roomList').boundingBox();
    expect(overlaps(find,list)).toBe(false);
    expect(find.height).toBeLessThanOrEqual(68);
    expect(list.height).toBeLessThanOrEqual(68);
    const joystick = await page.locator('#roomJoystick').boundingBox();
    const controls = await page.locator('.showroom-controls').boundingBox();
    expect(overlaps(joystick,controls)).toBe(false);
    // The hint pill sits above the bottom controls, clear of the top bar.
    expect(status.y + status.height).toBeLessThanOrEqual(controls.y);
    expect(status.y).toBeGreaterThan(bar.y + bar.height);
    await page.screenshot({ path: `${output}/room-touch-${viewport.width}-after.png`, animations: 'disabled' });
  }
});
