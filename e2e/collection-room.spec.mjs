import { test, expect } from './fixtures.mjs';

const holdings = Array.from({ length: 15 }, (_, index) => ({
  set_num: `${1000 + index}-1`, name: `Display set ${index}`, theme: index < 13 ? 'Space' : 'City',
  quantity: 1, image_url: '/brand-brick-transparent.png',
}));
async function stubRoom(page) {
  await page.route('**/api/collection', route => route.fulfill({ json: { items: holdings, count: holdings.length } }));
}

test('room loads on request, filters and pages accessible set links with mobile layout', async ({ page }) => {
  const requested = [];
  page.on('request', request => requested.push(new URL(request.url()).pathname));
  await stubRoom(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/');
  await page.getByRole('link', { name: 'Collection room', exact: true }).click();
  await expect(page.locator('#roomShelves a')).toHaveCount(10);
  expect(requested.some(path => /collection-room-scene|three-0/.test(path))).toBe(false);
  await page.locator('#roomTheme').selectOption({ label: 'Space' });
  await expect(page.locator('#roomShelves a')).toHaveCount(12);
  await page.getByRole('button', { name: 'Next shelves' }).click();
  await expect(page.locator('#roomShelves a')).toHaveCount(1);
  await expect(page.locator('#roomShelves a')).toHaveAttribute('href', /#\/set\/\d+-1/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'audit/collection-room-mobile-list.png', fullPage: true });
  await page.locator('#roomShelves a').click();
  await expect(page).toHaveURL(/#\/set\//);
});

test('real room renders, controls work, context loss falls back, and owner change clears it', async ({ page }) => {
  await stubRoom(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/room');
  await page.getByRole('button', { name: 'Open 3D room', exact: true }).click();
  await expect(page.locator('#roomStage')).toHaveAttribute('data-room-state', 'ready');
  await expect(page.locator('#roomStage canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Look left', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await page.screenshot({ path: 'audit/collection-room-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'audit/collection-room-mobile-3d.png', fullPage: true });
  await page.locator('#roomStage canvas').evaluate(canvas => canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
  await expect(page.locator('#roomStatus')).toContainText('3D is unavailable');
  await expect(page.locator('#roomStage canvas')).toHaveCount(0);
  await expect(page.locator('#roomShelves a')).toHaveCount(10);
  await page.getByRole('button', { name: 'Open 3D room', exact: true }).click();
  await expect(page.locator('#roomStage')).toHaveAttribute('data-room-state', 'ready');
  await page.evaluate(async () => {
    const { saveSession } = await import('/js/api.js');
    saveSession({ access_token: `x.${btoa(JSON.stringify({ sub: 'another-owner' }))}.x` });
  });
  await expect(page.locator('#collectionRoomPage')).toHaveCount(0);
  await expect(page.locator('#roomStage canvas')).toHaveCount(0);
});

test('guest room uses local holdings and low-memory fallback keeps shelves available', async ({ page }) => {
  await page.addInitScript(rows => {
    localStorage.removeItem('bv_session');
    localStorage.setItem('bv_guest_collection', JSON.stringify(rows));
    localStorage.setItem('bv_guest_backfill_v', '2');
    Object.defineProperty(navigator, 'deviceMemory', { value: 1 });
  }, holdings);
  let requests = 0;
  await page.route('**/api/collection', route => { requests++; return route.abort(); });
  await page.goto('/#/room');
  await expect(page.locator('#roomShelves a')).toHaveCount(10);
  await page.getByRole('button', { name: 'Open 3D room', exact: true }).click();
  await expect(page.locator('#roomStatus')).toContainText('3D is unavailable');
  expect(requests).toBe(0);
});

test('delayed collection read cannot paint after A to B to A account transition', async ({ page }) => {
  let release;
  await page.route('**/api/collection', async route => {
    await new Promise(resolve => { release = resolve; });
    await route.fulfill({ json: { items: holdings } });
  });
  await page.goto('/#/room');
  await expect.poll(() => !!release).toBe(true);
  await page.evaluate(async () => {
    const { saveSession, _authSession } = await import('/js/api.js');
    const original = _authSession;
    saveSession({ access_token: `x.${btoa(JSON.stringify({ sub: 'another-owner' }))}.x` });
    saveSession(original);
  });
  release();
  await expect(page.locator('#collectionRoomPage')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Display set');
});

test('selecting an image in the room opens set details and removes the canvas', async ({ page }) => {
  await stubRoom(page);
  await page.goto('/#/room');
  await page.getByRole('button', { name: 'Open 3D room', exact: true }).click();
  await expect(page.locator('#roomStage')).toHaveAttribute('data-room-state', 'ready');
  const canvas = page.locator('#roomStage canvas');
  const bounds = await canvas.boundingBox();
  await canvas.click({ position: { x: bounds.width * 0.27, y: bounds.height * 0.25 } });
  await expect(page).toHaveURL(/#\/set\/1013-1/);
  await expect(page.locator('#roomStage canvas')).toHaveCount(0);
});

test('failed read offers retry and cached holdings are explicitly marked stale', async ({ page }) => {
  await page.route('**/api/collection', route => route.fulfill({ status: 503, json: { error: 'offline' } }));
  await page.goto('/#/room');
  await expect(page.locator('#roomRetry')).toBeVisible();
  await page.evaluate(async rows => {
    const { state } = await import('/js/state.js');
    state.portfolio = { items: rows };
  }, holdings);
  await page.locator('#roomRetry').click();
  await expect(page.locator('#roomShelves a')).toHaveCount(10);
  await expect(page.locator('#collectionRoomPage .collection-notice')).toBeVisible();
});

test('leaving during a delayed scene import never mounts a room on the next page', async ({ page }) => {
  await stubRoom(page);
  let release;
  await page.route('**/js/components/collection-room-scene.js', async route => {
    await new Promise(resolve => { release = resolve; });
    await route.continue();
  });
  await page.goto('/#/room');
  await page.getByRole('button', { name: 'Open 3D room', exact: true }).click();
  await expect.poll(() => !!release).toBe(true);
  await page.getByRole('link', { name: 'Back to vault', exact: true }).click();
  const loaded = page.waitForResponse('**/js/components/collection-room-scene.js');
  release();
  await loaded;
  await expect(page.locator('#collectionRoomPage')).toHaveCount(0);
  await expect(page.locator('#root canvas')).toHaveCount(0);
});
