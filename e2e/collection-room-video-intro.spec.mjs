import { test, expect } from './fixtures.mjs';

const holdings = [{ set_num: '75192-1', name: 'Millennium Falcon', theme: 'Star Wars', quantity: 1, image_url: '/brand-brick-transparent.png', pieces: 7541 }];

async function stubRoom(page) {
  await page.route('**/api/collection', route => route.fulfill({ json: { items: holdings, count: holdings.length } }));
}

async function gotoRoom(page) {
  await stubRoom(page);
  await page.goto('/#/room');
  await expect(page.locator('#roomStage')).toHaveAttribute('data-room-state', 'ready', { timeout: 30000 });
}

test('real room intro video advances and hands off without native replay', async ({ page }) => {
  await gotoRoom(page);
  const overlay = page.locator('.showroom-video-intro');
  const video = page.locator('.showroom-video-intro-media');
  await expect(overlay).toBeVisible();
  await expect(video).toHaveAttribute('muted', '');
  await expect(video).toHaveAttribute('playsinline', '');
  const first = await video.evaluate(element => element.currentTime);
  await expect.poll(() => video.evaluate(element => element.currentTime), { timeout: 6000 }).toBeGreaterThan(first + 0.2);
  await expect(overlay).toHaveAttribute('data-video-intro-state', 'playing');
  await expect(overlay).toHaveCount(0, { timeout: 9000 });
  await expect(page.locator('#roomStage')).toHaveAttribute('data-door-state', 'open');
  await expect(page.locator('#roomStage')).toHaveAttribute('data-door-progress', '1.000');
});

test('skip fades directly to the ready final room pose', async ({ page }) => {
  await gotoRoom(page);
  await expect(page.locator('.showroom-video-intro')).toBeVisible();
  await page.getByRole('button', { name: 'Skip intro' }).click();
  await expect(page.locator('.showroom-video-intro')).toHaveCount(0);
  await expect(page.locator('#roomStage')).toHaveAttribute('data-door-state', 'open');
  await expect(page.locator('#roomStage')).toHaveAttribute('data-door-progress', '1.000');
});

test('media error falls back to the bounded native door intro', async ({ page }) => {
  await page.route('**/video/vault-door-intro.mp4', route => route.abort('failed'));
  await gotoRoom(page);
  await expect(page.locator('.showroom-video-intro')).toHaveCount(0);
  await expect(page.locator('#roomStage')).toHaveAttribute('data-door-state', 'opening');
  await expect(page.locator('#roomStage')).toHaveAttribute('data-door-state', 'open', { timeout: 30000 });
});

test('reduced motion skips video and native motion at the ready final pose', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoRoom(page);
  await expect(page.locator('.showroom-video-intro')).toHaveCount(0);
  await expect(page.locator('#roomStage')).toHaveAttribute('data-door-state', 'open');
  await expect(page.locator('#roomStage')).toHaveAttribute('data-door-progress', '1.000');
});

test('save-data skips video and uses native fallback', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true, effectiveType: '4g' } });
  });
  await gotoRoom(page);
  await expect(page.locator('.showroom-video-intro')).toHaveCount(0);
  await expect(page.locator('#roomStage')).toHaveAttribute('data-door-state', 'opening');
});

test('route departure removes video and prevents late intro mutations', async ({ page }) => {
  await gotoRoom(page);
  await expect(page.locator('.showroom-video-intro')).toBeVisible();
  await page.goto('/#/catalog');
  await expect(page.locator('.showroom-video-intro')).toHaveCount(0);
  await page.waitForTimeout(900);
  await expect(page.locator('#collectionRoomPage')).toHaveCount(0);
});
