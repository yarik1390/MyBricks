import { test, expect } from './fixtures.mjs';

// CI uses software WebGL: creation/disposal of multiple rooms can exceed the
// default 30-second whole-test budget while each interaction remains correct.
test.setTimeout(process.env.CI ? 120000 : 30000);

const holdings = Array.from({ length: 90 }, (_, i) => ({ set_num: `${1000 + i}-1`, name: `Display set ${i}`, theme: i < 60 ? 'Space' : 'City', quantity: 1, image_url: '/brand-brick-transparent.png' }));
async function stubRoom(page, rows = holdings) {
  await page.route('**/api/collection', route => route.fulfill({ json: { items: rows, count: rows.length } }));
}
const ready = page => expect(page.locator('#roomStage')).toHaveAttribute('data-room-state', 'ready');
const pose = page => page.locator('#roomStage').evaluate(el => ({ x: Number(el.dataset.cameraX), z: Number(el.dataset.cameraZ), yaw: Number(el.dataset.cameraYaw) }));
async function walk(page, key, ms = 400) {
  await page.locator('#roomStage').focus();
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}
async function findSet(page, number) {
  await page.locator('#roomFind').click();
  await page.locator('#roomSearch').fill(number);
  await page.locator(`[data-room-set="${number}"]`).click();
  await expect(page.locator('#sheet')).not.toHaveClass(/show/);
}

test('Vault enters fullscreen directly; walking, mouse looking, collision and exit work', async ({ page }) => {
  const requests = [];
  page.on('request', req => requests.push(new URL(req.url()).pathname));
  await stubRoom(page);
  await page.goto('/#/');
  await expect(page.getByRole('link', { name: 'Enter collection room' })).toBeVisible();
  expect(requests.some(p => /collection-room-scene|three-0/.test(p))).toBe(false);
  await page.getByRole('link', { name: 'Enter collection room' }).click();
  await ready(page);
  await expect(page.locator('#nav')).toBeHidden();
  const before = await pose(page);
  await walk(page, 'w');
  const after = await pose(page);
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(0.1);
  const box = await page.locator('#roomStage').boundingBox();
  await page.mouse.move(box.width / 2, box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.width / 2 + 100, box.height / 2, { steps: 5 });
  await page.mouse.up();
  expect((await pose(page)).yaw).toBeLessThan(after.yaw);
  await page.locator('#roomReset').click();
  const reset = await pose(page);
  expect(reset.x).toBeCloseTo(before.x, 2);
  expect(reset.z).toBeCloseTo(before.z, 2);
  await page.locator('#roomStage').focus();
  await page.keyboard.down('w');
  await page.waitForTimeout(120);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const blurred = await pose(page);
  await page.waitForTimeout(180);
  expect(await pose(page)).toEqual(blurred);
  await page.keyboard.up('w');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('#roomReset').click();
  await page.screenshot({ path: 'audit/showroom-desktop.png' });
  await page.getByRole('link', { name: 'Exit room' }).click();
  await expect(page.locator('#roomStage')).toHaveCount(0);
  await expect(page.locator('#nav')).toBeVisible();
});

test('find reaches distant sets with bounded rendering and detail sheets preserve the room', async ({ page }) => {
  await stubRoom(page, Array.from({ length: 1200 }, (_, i) => ({ ...holdings[0], set_num: `${2000 + i}-1`, name: `Set ${i}`, theme: `Theme ${Math.floor(i / 100)}` })));
  await page.goto('/#/room');
  await ready(page);
  await findSet(page, '3199-1');
  const located = await pose(page);
  expect(await page.locator('#roomStage').evaluate(el => Number(el.dataset.residentBoxes))).toBeLessThanOrEqual(100);
  // teleport aims the selected box at the center so ray selection is real.
  const bounds = await page.locator('#roomStage').boundingBox();
  await page.mouse.click(bounds.width / 2, bounds.height / 2);
  await expect(page.locator('#roomSheetTitle')).toHaveText('Set 1199');
  await page.keyboard.down('w');
  await page.waitForTimeout(200);
  await page.keyboard.up('w');
  expect(await pose(page)).toEqual(located);
  await page.locator('#roomSheetClose').click();
  expect(await pose(page)).toEqual(located);
  await page.locator('#roomList').click();
  await page.locator('#roomSearch').fill('3199-1');
  await page.locator('[data-room-set="3199-1"]').click();
  await page.locator('#roomFullDetails').click();
  await expect(page).toHaveURL(/#\/set\/3199-1/);
  await page.goBack();
  await ready(page);
  expect(await pose(page)).toEqual(located);
});

test('captured mouse selects a box and releases for its detail panel', async ({ page }) => {
  await stubRoom(page);
  await page.goto('/#/room');
  await ready(page);
  await findSet(page, '1000-1');
  const bounds = await page.locator('#roomStage').boundingBox();
  await page.mouse.move(bounds.width / 2, bounds.height / 2);
  await page.locator('#roomMouse').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.tagName)).toBe('CANVAS');
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('#roomSheetTitle')).toHaveText('Display set 0');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement)).toBe(null);
  await page.locator('#roomSheetClose').click();
  await expect(page.locator('#sheet')).not.toHaveClass(/show/);
});

test('a box beyond the previous selection reach opens without approaching it', async ({ page }) => {
  await page.route('**/room-selection-test', route => route.fulfill({ contentType: 'text/html', body: '<html><body style="margin:0"><div id="stage" style="width:100vw;height:100vh"></div><output id="selected"></output></body></html>' }));
  await page.goto('/room-selection-test');
  const distance = await page.evaluate(async () => {
    const { createCollectionRoom } = await import('/js/components/collection-room-scene.js');
    const { createRoomLayout, ROOM_LAYOUT } = await import('/js/lib/collection-room.js');
    const catalog = Array.from({ length: 72 }, (_, i) => ({ set_num: `${i + 1}-1`, name: `Set ${i + 1}`, theme: 'Space', image_url: '' }));
    const layout = createRoomLayout(catalog);
    const box = layout.boxes[48];
    const x = 0, z = 0.85;
    const dx = box.x + ROOM_LAYOUT.boxDepth / 2 - x;
    const dz = box.z - z;
    const horizontal = Math.hypot(dx, dz);
    await createCollectionRoom(document.querySelector('#stage'), catalog, {
      initialPose: { x, z, yaw: Math.atan2(dx, dz), pitch: Math.atan2(box.y - ROOM_LAYOUT.eyeHeight, horizontal) },
      onSelect: number => { document.querySelector('#selected').textContent = number; },
    });
    return horizontal;
  });
  expect(distance).toBeGreaterThan(14);
  const bounds = await page.locator('#stage').boundingBox();
  await page.mouse.click(bounds.width / 2, bounds.height / 2);
  await expect(page.locator('#selected')).toHaveText('49-1');
});

test('mobile joystick and look accept simultaneous touches without scrolling', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  // Reuse the hermetic fixtures by capturing all API/remote traffic explicitly.
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.pathname === '/api/collection') return route.fulfill({ json: { items: holdings } });
    if (u.pathname.startsWith('/api/')) return route.fulfill({ json: u.pathname === '/api/me' ? { is_guest: true, currency: 'USD' } : {} });
    if (u.hostname === 'localhost') return route.continue();
    return route.abort();
  });
  await page.addInitScript(rows => {
    localStorage.setItem('bv_guest_collection', JSON.stringify(rows));
    localStorage.setItem('bv_guest_backfill_v', '2');
    localStorage.setItem('bv_setup_v1', '1');
    localStorage.setItem('bv_welcome_v1', '1');
    localStorage.setItem('bv_onboarded_v1', '1');
  }, holdings);
  await page.goto(`http://localhost:${process.env.PORT || 4321}/#/room`);
  await ready(page);
  const before = await pose(page);
  const stick = await page.locator('#roomJoystick').boundingBox();
  const x = stick.x + stick.width / 2, y = stick.y + stick.height / 2;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }, { x: 290, y: 420, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 34, id: 1 }, { x: 335, y: 420, id: 2 }] });
  await page.waitForTimeout(450);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const after = await pose(page);
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(0.1);
  expect(after.yaw).not.toBe(before.yaw);
  await page.waitForTimeout(120);
  expect(await pose(page)).toEqual(after);
  expect(await page.evaluate(() => scrollY === 0 && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'audit/showroom-mobile.png' });
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('#roomJoystick')).toBeVisible();
  await context.close();
});

test('guest fallback retains searchable holdings; context loss and owner changes clear graphics', async ({ page }) => {
  await page.addInitScript(rows => {
    localStorage.removeItem('bv_session');
    localStorage.setItem('bv_guest_collection', JSON.stringify(rows));
    localStorage.setItem('bv_guest_backfill_v', '2');
    Object.defineProperty(navigator, 'deviceMemory', { value: 1 });
  }, holdings);
  let calls = 0;
  await page.route('**/api/collection', route => { calls++; return route.abort(); });
  await page.goto('/#/room');
  await expect(page.locator('#roomStage')).toHaveAttribute('data-room-state', 'unavailable');
  await page.locator('#roomFallbackList').click();
  await page.locator('#roomSearch').fill('1089-1');
  await expect(page.locator('[data-room-set]')).toHaveCount(1);
  expect(calls).toBe(0);
  await page.evaluate(async () => {
    const { saveSession } = await import('/js/api.js');
    saveSession({ access_token: `x.${btoa(JSON.stringify({ sub: 'new-owner' }))}.x` });
  });
  await expect(page.locator('#collectionRoomPage')).toHaveCount(0);
  await expect(page.locator('#sheet')).not.toHaveClass(/show/);
});

test('context loss offers fallback and delayed loading cannot repaint after navigation', async ({ page }) => {
  await stubRoom(page);
  await page.goto('/#/room');
  await ready(page);
  await page.locator('#roomStage canvas').evaluate(canvas => canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
  await expect(page.locator('#roomFallbackList')).toBeVisible();
  await expect(page.locator('#roomStage canvas')).toHaveCount(0);
  await page.locator('#roomRetry3D').click();
  await ready(page);
  await page.evaluate(async () => { const { go } = await import('/js/router.js'); go('#/'); });
  await expect(page.locator('#collectionRoomPage')).toHaveCount(0);
  await expect(page.locator('#nav')).toBeVisible();
});

test('failed collection read retries and delayed A-B-A reads do not paint stale holdings', async ({ page }) => {
  await page.route('**/api/collection', route => route.fulfill({ status: 503, json: { error: 'offline' } }));
  await page.goto('/#/room');
  await expect(page.locator('#roomRetry')).toBeVisible();
  let release;
  await page.route('**/api/collection', async route => { await new Promise(resolve => { release = resolve; }); await route.fulfill({ json: { items: holdings } }); });
  await page.locator('#roomRetry').click();
  await expect.poll(() => !!release).toBe(true);
  await page.evaluate(async () => {
    const { saveSession, _authSession } = await import('/js/api.js');
    const original = _authSession;
    saveSession({ access_token: `x.${btoa(JSON.stringify({ sub: 'other' }))}.x` });
    saveSession(original);
  });
  release();
  await expect(page.locator('#collectionRoomPage')).toHaveCount(0);
});

test('empty showroom remains enterable and cached holdings are labelled after read failure', async ({ page }) => {
  await stubRoom(page, []);
  await page.goto('/#/room');
  await ready(page);
  await expect(page.locator('#roomStatus')).toContainText('Add sets');
  await walk(page, 'w');
  await page.getByRole('link', { name: 'Exit room' }).click();
  await page.evaluate(async rows => { const { state } = await import('/js/state.js'); state.portfolio = { items: rows }; }, holdings);
  await page.route('**/api/collection', route => route.fulfill({ status: 503, json: { error: 'offline' } }));
  await page.getByRole('link', { name: 'Enter collection room' }).click();
  await ready(page);
  await expect(page.locator('.showroom-notices p')).toHaveCount(2);
  await page.locator('#roomList').click();
  await expect(page.locator('[data-room-set]')).toHaveCount(40);
});

test('Android back closes room panels first, then leaves the room', async ({ page }) => {
  await stubRoom(page);
  await page.goto('/#/room');
  await ready(page);
  await page.evaluate(async () => {
    const { initNativeBack } = await import('/js/lib/native-back.js');
    initNativeBack({ Capacitor: { isNativePlatform: () => true, Plugins: { App: {
      addListener(name, callback) { if (name === 'backButton') window.__roomBack = callback; }, exitApp() {},
    } } } });
  });
  await page.locator('#roomHelp').click();
  await page.evaluate(() => window.__roomBack({ canGoBack: false }));
  await expect(page.locator('#sheet')).not.toHaveClass(/show/);
  await ready(page);
  await page.evaluate(() => window.__roomBack({ canGoBack: false }));
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('#nav')).toBeVisible();
});
