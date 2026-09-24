import { test, expect } from './fixtures.mjs';

// CI uses software WebGL: creation/disposal of multiple rooms can exceed the
// default 30-second whole-test budget while each interaction remains correct.
test.setTimeout(process.env.CI ? 120000 : 30000);

const holdings = Array.from({ length: 90 }, (_, i) => ({
  set_num: `${1000 + i}-1`,
  name: `Display set ${i}`,
  theme: i < 60 ? 'Space' : 'City',
  quantity: 1,
  image_url: '/brand-brick-transparent.png',
  pieces: i % 4 === 0 ? 90 : i % 4 === 1 ? 420 : i % 4 === 2 ? 1100 : 2400,
  packaging_type: 'Box',
  ...(i === 0 ? { brickset_dimensions: JSON.stringify({ width: 58, height: 37, depth: 8.7 }) } : {}),
}));
async function stubRoom(page, rows = holdings, { videoUnavailable = true } = {}) {
  await page.route('**/api/collection', route => route.fulfill({ json: { items: rows, count: rows.length } }));
  if (videoUnavailable) await page.route('**/video/vault-door-intro.mp4', route => route.abort('failed'));
}
const ready = page => expect(page.locator('#roomStage')).toHaveAttribute('data-room-state', 'ready');
const doorOpen = page => expect(page.locator('#roomStage')).toHaveAttribute('data-door-state', 'open', { timeout: 30000 });
const pose = page => page.locator('#roomStage').evaluate(el => ({ x: Number(el.dataset.cameraX), z: Number(el.dataset.cameraZ), yaw: Number(el.dataset.cameraYaw), pitch: Number(el.dataset.cameraPitch) }));
async function walk(page, key, ms = 400) {
  await page.locator('#roomStage').focus();
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}
async function expectSheetClosed(page) {
  await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#sheetBackdrop')).toHaveAttribute('aria-hidden', 'true');
}
async function findSet(page, number) {
  await page.locator('#roomFind').click();
  await page.locator('#roomSearch').fill(number);
  await page.locator(`[data-room-set="${number}"]`).click();
  await expect.poll(() => page.evaluate(() => {
    const stage = document.querySelector('#roomStage');
    const bounds = stage?.getBoundingClientRect();
    const hit = bounds && document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return {
      sheet: document.querySelector('#sheet')?.getAttribute('aria-hidden'),
      backdrop: document.querySelector('#sheetBackdrop')?.getAttribute('aria-hidden'),
      focused: document.activeElement?.id,
      centerTarget: hit?.tagName,
    };
  })).toEqual({ sheet: 'true', backdrop: 'true', focused: 'roomStage', centerTarget: 'CANVAS' });
}

test('native door intro is time-based, visible, finite, and preserves navigation pose', async ({ page }) => {
  await page.addInitScript(() => {
    window.__doorProgressSamples = [];
    window.__introCameraSamples = [];
    new MutationObserver(() => {
      const stage = document.querySelector('#roomStage');
      const value = Number(stage?.dataset.doorProgress);
      if (Number.isFinite(value)) window.__doorProgressSamples.push(value);
      const cameraZ = Number(stage?.dataset.introCameraZ);
      if (Number.isFinite(cameraZ)) window.__introCameraSamples.push({ cameraZ, threshold: stage.dataset.introThreshold });
    }).observe(document, { attributes: true, attributeFilter: ['data-door-progress', 'data-intro-camera-z'], childList: true, subtree: true });
  });
  await stubRoom(page);
  await page.goto('/#/room');
  const stage = page.locator('#roomStage');
  await expect(stage).toHaveAttribute('data-door-animation', 'native-three-time', { timeout: 30000 });
  await ready(page);
  const savedPose = await pose(page);
  await doorOpen(page);
  await expect(stage).toHaveAttribute('data-door-progress', '1.000');
  const progressSamples = await page.evaluate(() => window.__doorProgressSamples);
  expect(progressSamples.some(value => value > 0 && value < 1)).toBe(true);
  expect(progressSamples.at(-1)).toBe(1);
  for (let index = 1; index < progressSamples.length; index++) {
    expect(progressSamples[index]).toBeGreaterThanOrEqual(progressSamples[index - 1]);
  }
  const renderedCameraSamples = await page.evaluate(() => window.__introCameraSamples);
  expect(renderedCameraSamples.some(sample => sample.cameraZ < 0 && sample.threshold === 'outside')).toBe(true);
  expect(renderedCameraSamples.some(sample => sample.cameraZ > 0 && sample.threshold === 'inside')).toBe(true);
  for (let index = 1; index < renderedCameraSamples.length; index++) {
    expect(renderedCameraSamples[index].cameraZ).toBeGreaterThanOrEqual(renderedCameraSamples[index - 1].cameraZ - 0.001);
  }
  const afterIntro = await pose(page);
  expect(afterIntro.x).toBe(savedPose.x);
  expect(afterIntro.z).toBe(savedPose.z);
  expect(afterIntro.yaw).toBeCloseTo(savedPose.yaw, 4);
  expect(afterIntro.pitch).toBeCloseTo(savedPose.pitch, 4);

  // Reset is a separate lifecycle boundary: it must preserve the completed
  // native door state rather than remounting or replaying the intro.
  await page.locator('#roomReset').click();
  await expect(stage).toHaveAttribute('data-door-state', 'open');
  await expect(stage).toHaveAttribute('data-door-progress', '1.000');
  expect(await pose(page)).toEqual(savedPose);
});

test('reduced motion opens the native vault door immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await stubRoom(page);
  await page.goto('/#/room');
  await ready(page);
  await doorOpen(page);
  await expect(page.locator('#roomStage')).toHaveAttribute('data-door-progress', '1.000');
});

test('Vault enters fullscreen directly; walking, mouse looking, collision and exit work', async ({ page }) => {
  test.slow();
  const requests = [];
  page.on('request', req => requests.push(new URL(req.url()).pathname));
  await stubRoom(page);
  await page.goto('/#/');
  await expect(page.getByRole('link', { name: 'Room', exact: true })).toBeVisible();
  expect(requests.some(p => /collection-room-scene|three-0/.test(p))).toBe(false);
  await page.getByRole('link', { name: 'Room', exact: true }).click();
  await ready(page);
  await page.locator('#roomReset').click();
  await doorOpen(page);
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
  await page.getByRole('link', { name: 'Back to vault', exact: true }).click();
  await expect(page.locator('#roomStage')).toHaveCount(0);
  await expect(page.locator('#nav')).toBeVisible();
});

test('find reaches distant sets with bounded rendering and detail sheets preserve the room', async ({ page }) => {
  test.slow();
  await stubRoom(page, Array.from({ length: 1200 }, (_, i) => ({ ...holdings[0], set_num: `${2000 + i}-1`, name: `Set ${i}`, theme: `Theme ${Math.floor(i / 100)}` })));
  await page.goto('/#/room');
  await ready(page);
  await findSet(page, '3199-1');
  const located = await pose(page);
  expect(await page.locator('#roomStage').evaluate(el => Number(el.dataset.residentBoxes))).toBeLessThanOrEqual(100);
  // teleport aims the selected box at the center so ray selection is real.
  const bounds = await page.locator('#roomStage').boundingBox();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  const stage = page.locator('#roomStage');
  await expect(stage).toHaveAttribute('data-pickup-state', 'lifting');
  await expect.poll(async () => Number(await stage.getAttribute('data-pickup-progress'))).toBeGreaterThan(0);
  await expect(stage).toHaveAttribute('data-pickup-state', 'held');
  await expect(stage).toHaveAttribute('data-pickup-progress', '1.000');
  await expect(page.locator('#roomSheetTitle')).toHaveText('Set 1199');
  await expect(page.locator('#roomTurntable')).toHaveAttribute('aria-label', 'Rotatable box representation for Set 1199');
  const inspectBox = page.locator('#roomInspectBox');
  await expect.poll(() => inspectBox.evaluate(el => {
    const style = getComputedStyle(el);
    return { filter: style.filter, transformStyle: style.transformStyle };
  })).toEqual({ filter: 'none', transformStyle: 'preserve-3d' });
  const faceAtCenter = () => page.locator('#roomTurntable').evaluate(el => {
    const bounds = el.getBoundingClientRect();
    return document.elementsFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
      .find(node => node.classList?.contains('showroom-inspect-face'))?.className || '';
  });
  await expect.poll(faceAtCenter).toContain('showroom-inspect-front');
  await inspectBox.evaluate(el => el.style.setProperty('--inspect-turn', '180deg'));
  await expect.poll(faceAtCenter).toContain('showroom-inspect-back');
  await inspectBox.evaluate(el => el.style.setProperty('--inspect-turn', '0deg'));
  await page.locator('#roomTurntable').focus();
  await page.keyboard.press('ArrowRight');
  await expect(inspectBox).toHaveAttribute('style', /20deg/);
  await page.getByRole('button', { name: 'Rotate box left' }).click();
  await expect(inspectBox).toHaveAttribute('style', /0deg/);
  await expect(page.locator('#roomInspectHelp')).toContainText('Sides are neutral');
  const inspectingPose = await pose(page);
  await page.keyboard.down('w');
  await page.waitForTimeout(200);
  await page.keyboard.up('w');
  expect(await pose(page)).toEqual(inspectingPose);
  const originalTransform = await stage.getAttribute('data-pickup-origin');
  await stage.evaluate(el => {
    window.__pickupReturnSamples = [];
    const sample = () => window.__pickupReturnSamples.push({
      state: el.dataset.pickupState,
      progress: Number(el.dataset.pickupProgress),
      transform: el.dataset.pickupTransform,
    });
    sample();
    new MutationObserver(sample).observe(el, {
      attributes: true,
      attributeFilter: ['data-pickup-state', 'data-pickup-progress', 'data-pickup-transform'],
    });
  });
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__pickupReturnSamples
    .some(({ state, progress }) => state === 'returning' && progress > 0 && progress < 1))).toBeTruthy();
  await expectSheetClosed(page);
  await expect(stage).toHaveAttribute('data-pickup-state', 'idle');
  await expect(stage).toHaveAttribute('data-pickup-progress', '0.000');
  await expect(stage).toHaveAttribute('data-pickup-transform', originalTransform);
  await expect(stage).toBeFocused();
  expect(await pose(page)).toEqual(located);
  await page.locator('#roomList').click();
  await page.locator('#roomSearch').fill('3199-1');
  await page.locator('[data-room-set="3199-1"]').click();
  await page.locator('#roomFullDetails').click();
  await expect(page).toHaveURL(/#\/set\/3199-1/);
  const remembered = located;
  await page.goBack();
  await ready(page);
  expect(await pose(page)).toEqual(remembered);
});

test('captured mouse acquires pointer lock and releases on Escape', async ({ page }) => {
  test.slow();
  await stubRoom(page);
  await page.goto('/#/room');
  await ready(page);
  await findSet(page, '1000-1');
  const canvas = page.locator('#roomStage canvas');
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.locator('#roomMouse').evaluate(button => {
    window.__roomPointerLockProbe = { activationAtClick: null, errors: 0 };
    button.addEventListener('click', () => {
      window.__roomPointerLockProbe.activationAtClick = navigator.userActivation.isActive;
    }, { capture: true, once: true });
    document.addEventListener('pointerlockerror', () => {
      window.__roomPointerLockProbe.errors += 1;
    }, { once: true });
  });
  await page.locator('#roomMouse').focus();
  await page.keyboard.press('Enter');
  try {
    await expect.poll(() => page.evaluate(() => ({
      activationAtClick: window.__roomPointerLockProbe.activationAtClick,
      errors: window.__roomPointerLockProbe.errors,
      lock: document.pointerLockElement?.tagName || null,
    }))).toEqual({ activationAtClick: true, errors: 0, lock: 'CANVAS' });
  } catch (error) {
    console.error('Pointer-lock diagnostic', await page.evaluate(() => ({
      ...window.__roomPointerLockProbe,
      lock: document.pointerLockElement?.tagName || null,
      focused: document.activeElement?.id,
      status: document.querySelector('#roomStatus')?.textContent,
      visibility: document.visibilityState,
      hasFocus: document.hasFocus(),
    })));
    throw error;
  }
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement)).toBe(null);
});

test('centered canvas selection opens the teleported box detail panel', async ({ page }) => {
  await stubRoom(page);
  await page.goto('/#/room');
  await ready(page);
  await findSet(page, '1000-1');
  const canvas = page.locator('#roomStage canvas');
  const bounds = await canvas.boundingBox();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(page.locator('#roomSheetTitle')).toHaveText('Display set 0');
  await page.locator('#roomSheetClose').click();
  await expectSheetClosed(page);
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
    if (u.pathname === '/video/vault-door-intro.mp4') return route.abort('failed');
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
  // Enter from the Vault so an accidental edge-swipe has a real route to exit to.
  await page.getByRole('link', { name: 'Back to vault', exact: true }).click();
  await page.getByRole('link', { name: 'Room', exact: true }).click();
  await ready(page);
  await page.locator('#roomReset').click();
  await doorOpen(page);
  const beforeEdgeLook = await pose(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 24, y: 420, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 150, y: 420, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page).toHaveURL(/#\/room$/);
  await ready(page);
  expect((await pose(page)).yaw).not.toBe(beforeEdgeLook.yaw);
  await page.screenshot({ path: 'audit/showroom-mobile.png' });
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('#roomJoystick')).toBeVisible();
  await page.getByRole('link', { name: 'Back to vault', exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://localhost:${process.env.PORT || 4321}/#/add`);
  await expect(page.locator('body')).toHaveAttribute('data-route', 'catalog');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 24, y: 420, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 150, y: 420, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page).toHaveURL(/#\/$/);
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
  await expectSheetClosed(page);
});

test('context loss offers fallback and delayed loading cannot repaint after navigation', async ({ page }) => {
  test.slow();
  await stubRoom(page);
  await page.goto('/#/room');
  await ready(page);
  await page.locator('#roomStage canvas').evaluate(canvas => canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
  await expect(page.locator('#roomFallbackList')).toBeVisible();
  await expect(page.locator('#roomStage canvas')).toHaveCount(0);
  await page.locator('#roomRetry3D').click();
  await ready(page);
  await page.evaluate(() => { location.hash = '#/'; });
  await expect(page).toHaveURL(/#\/$/);
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
  await page.getByRole('link', { name: 'Back to vault', exact: true }).click();
  await page.evaluate(async rows => { const { state } = await import('/js/state.js'); state.portfolio = { items: rows }; }, holdings);
  await page.route('**/api/collection', route => route.fulfill({ status: 503, json: { error: 'offline' } }));
  await page.getByRole('link', { name: 'Room', exact: true }).click();
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
  await expectSheetClosed(page);
  await ready(page);
  await page.evaluate(() => window.__roomBack({ canGoBack: false }));
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('#nav')).toBeVisible();
  await page.locator('[data-vault-view="room"]').click();
  await ready(page);
  await page.evaluate(() => window.__roomBack({ canGoBack: true }));
  await expect(page).toHaveURL(/#\/$/);
  await page.locator('#nav [data-route="/add"]').click();
  await page.locator('#nav [data-route="/"]').click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('#roomStage')).toHaveCount(0);
});

test('exit room via browser back, visit another page, then Vault returns to grid', async ({ page }) => {
  await stubRoom(page);
  await page.goto('/#/');
  await page.getByRole('link', { name: 'Room', exact: true }).click();
  await ready(page);
  // Exit via browser back
  await page.goBack();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('#collectionRoomPage')).toHaveCount(0);
  // Navigate to another tab (Catalog)
  await page.locator('#nav [data-route="/add"]').click();
  await expect(page).toHaveURL(/#\/add$/);
  // Tapping bottom Vault must reliably return Grid, not room
  await page.locator('#nav [data-route="/"]').click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('#collectionRoomPage')).toHaveCount(0);
  await expect(page.locator('#setList')).toBeVisible();
  await page.getByRole('link', { name: 'Room', exact: true }).click();
  await ready(page);
  await page.locator('[data-vault-view="grid"]').click();
  await page.locator('#nav [data-route="/wishlist"]').click();
  await page.locator('#nav [data-route="/"]').click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('#collectionRoomPage')).toHaveCount(0);
});

test('room -> full details -> browser back preserves camera pose', async ({ page }) => {
  await stubRoom(page);
  await page.goto('/#/room');
  await ready(page);
  await findSet(page, '1000-1');
  const targetPose = await pose(page);
  const stage = await page.locator('#roomStage').boundingBox();
  await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await expect(page.locator('#roomSheetTitle')).toHaveText('Display set 0');
  await page.locator('#roomFullDetails').click();
  await expect(page).toHaveURL(/#\/set\/1000-1$/);
  // Browser back to room
  await page.goBack();
  await ready(page);
  const restoredPose = await pose(page);
  expect(restoredPose.x).toBeCloseTo(targetPose.x, 1);
  expect(restoredPose.z).toBeCloseTo(targetPose.z, 1);
});

test('room toolbar and status notices do not overlap across 320, 390, 412 portrait and landscape', async ({ page }) => {
  await stubRoom(page);
  for (const vp of [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 915, height: 412 },
  ]) {
    await page.setViewportSize(vp);
    await page.goto('/#/room');
    await ready(page);
    const bar = await page.locator('.bv-room-bar').boundingBox();
    const notices = await page.locator('.showroom-notices').boundingBox();
    const controls = await page.locator('.showroom-controls').boundingBox();
    expect(bar).not.toBeNull();
    expect(notices).not.toBeNull();
    // The hint pill sits between the top bar and the bottom controls.
    expect(notices.y).toBeGreaterThanOrEqual(bar.y + bar.height - 2);
    expect(notices.y + notices.height).toBeLessThanOrEqual(controls.y + 2);
  }
});

test('a single holding is visible from the entrance and has no more-results button', async ({ page }) => {
  const singleHolding = [{ set_num: '1000-1', name: 'Single Set', theme: 'Space', quantity: 1, image_url: '/brand-brick-transparent.png' }];
  await stubRoom(page, singleHolding);
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto('/#/room');
  await ready(page);
  // Default pose faces collection shelves, not ceiling
  const initial = await pose(page);
  expect(initial.pitch).toBeLessThan(0.05);
  const stage = await page.locator('#roomStage').boundingBox();
  await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await expect(page.locator('#roomSheetTitle')).toHaveText('Single Set');
  await page.locator('#roomSheetClose').click();
  // Open accessible list
  await page.locator('#roomList').click();
  const more = page.locator('#roomMore');
  await expect(more).toBeHidden();
  const display = await more.evaluate(el => window.getComputedStyle(el).display);
  expect(display).toBe('none');
});

test('Scan FAB floats above the navigation and never covers the last row', async ({ page }) => {
  await stubRoom(page);
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto('/#/');
  const fab = page.locator('#bvFab');
  await expect(fab).toBeVisible();
  // The extended FAB sits 16dp above the bottom bar, right-aligned.
  const navBox = await page.locator('#nav').boundingBox();
  const fabBox = await fab.boundingBox();
  expect(fabBox.y + fabBox.height).toBeLessThanOrEqual(navBox.y - 8);
  expect(fabBox.height).toBeGreaterThanOrEqual(48);
  // At the end of the page the last interactive element clears the FAB.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const covered = await page.evaluate(() => {
    const fabRect = document.getElementById('bvFab').getBoundingClientRect();
    const items = [...document.querySelectorAll('#root a, #root button')].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
    });
    return items.filter(el => {
      const r = el.getBoundingClientRect();
      return r.bottom > fabRect.top + 1 && r.top < fabRect.bottom && r.right > fabRect.left && r.left < fabRect.right;
    }).map(el => el.id || el.className);
  });
  expect(covered).toEqual([]);
});

test('narrow Catalog toolbar view toggle stays on screen without badge letter wrap', async ({ page }) => {
  for (const width of [320, 390, 412]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/#/add');
    const toggle = page.locator('#catalogLayoutToggle');
    await expect(toggle).toBeVisible();
    const box = await toggle.boundingBox();
    expect(box).not.toBeNull();
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    const filterBtn = page.locator('#filterChip');
    await expect(filterBtn).toBeVisible();
  }
});
