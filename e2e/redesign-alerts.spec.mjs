import { test, expect } from './fixtures.mjs';

// Alerts area of the 2026 redesign: the Wishlist's target progress and alert
// card, the price alert sheet (target + per-set switches), "I bought it",
// the Notifications screen's category switches / quiet hours / in-context push
// explainer, and launcher-shortcut deep links into the scanner.

const WISHLIST = [
  { id: 11, set_num: '21333-1', name: 'The Starry Night', theme: 'Ideas', current_value: 172, blended_value: 172, target_price: 175, notify_target: 1, notify_retiring: 1, notify_stock: 1 },
  { id: 12, set_num: '10276-1', name: 'Colosseum', theme: 'Icons', current_value: 540, blended_value: 540, blended_low: 510, blended_high: 590, target_price: 480, retail_price: 549.99, notify_target: 1, notify_retiring: 1, notify_stock: 0 },
  { id: 13, set_num: '10302-1', name: 'Optimus Prime', theme: 'Icons', current_value: 169, blended_value: 169, target_price: null, notify_target: 1, notify_retiring: 1, notify_stock: 1 },
];
const ALERT = { id: 501, set_num: '21333-1', set_name: 'The Starry Night', target_price: 175, current_value: 172, alert_type: 'drop', triggered_at: new Date().toISOString() };

async function stubWishlist(page, { alerts = [ALERT] } = {}) {
  const calls = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith('/api/wishlist') || url.pathname.startsWith('/api/collection') || url.pathname === '/api/me') {
      if (req.method() !== 'GET') calls.push({ method: req.method(), path: url.pathname, body: req.postData() ? JSON.parse(req.postData()) : null });
    }
  });
  await page.route('**/api/wishlist', (route) => (route.request().method() === 'GET'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ wishlist: WISHLIST, unread_alerts: alerts }) })
    : route.fulfill({ status: 201, contentType: 'application/json', body: '{"item":{"id":99}}' })));
  await page.route('**/api/wishlist/*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await page.route('**/api/collection', (route) => (route.request().method() === 'POST'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"item":{"id":7001}}' })
    : route.fallback()));
  return calls;
}

test('wishlist shows target progress and the alert card; Dismiss marks it read', async ({ page }) => {
  const calls = await stubWishlist(page);
  await page.goto('/#/wishlist', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#wishlistPage h1')).toHaveText('Wishlist');
  await expect(page.locator('#bvFab')).toBeVisible();
  await expect(page.locator('#wishlistPage .bv-topbar__sub')).toHaveText('3 sets · prices checked daily');
  const card = page.locator('.bv-wlalert');
  await expect(card).toContainText('The Starry Night dropped to $172');
  await expect(card).toContainText('Below your $175 target');

  const rows = page.locator('.bv-wlrow');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('At target');
  await expect(rows.nth(1)).toContainText('$60 to go');
  await expect(rows.nth(1)).toContainText('Target $480');
  await expect(rows.nth(2)).toContainText('No target yet');
  await expect(page.locator('#bvFab')).toHaveAttribute('aria-label', 'Add');

  await card.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.locator('.bv-wlalert')).toHaveCount(0);
  expect(calls.some((c) => c.method === 'POST' && c.path === '/api/wishlist/501')).toBe(true);
});

test('price alert sheet saves the target and per-set switches', async ({ page }) => {
  const calls = await stubWishlist(page, { alerts: [] });
  await page.goto('/#/wishlist', { waitUntil: 'domcontentloaded' });
  await page.locator('.bv-wlrow', { hasText: 'Colosseum' }).click();
  const sheet = page.locator('#priceAlertSheet');
  await expect(sheet).toContainText('Now $540 · market range $510 – $590');
  await expect(sheet.locator('#paTarget')).toHaveValue('480.00');
  await expect(sheet.locator('#paNotifyStock')).toHaveAttribute('aria-checked', 'false');

  await sheet.getByRole('button', { name: /^−10%/ }).click();
  await expect(sheet.locator('#paTarget')).toHaveValue('486.00');
  await sheet.locator('#paNotifyRetiring').click();
  await sheet.locator('#paNotifyStock').click();
  await sheet.locator('#paSave').click();

  await expect.poll(() => calls.find((c) => c.method === 'PATCH' && c.path === '/api/wishlist/12')?.body).toEqual({
    target_price: 486, notify_target: true, notify_retiring: false, notify_stock: true,
  });
  await expect(page.locator('.bv-wlrow', { hasText: 'Colosseum' })).toContainText('Target $486');
});

test('Undo after Remove restores the per-set switches the user had', async ({ page }) => {
  const calls = await stubWishlist(page, { alerts: [] });
  await page.goto('/#/wishlist', { waitUntil: 'domcontentloaded' });
  await page.locator('.bv-wlrow', { hasText: 'Colosseum' }).click();
  await page.locator('#paRemove').click();
  await expect.poll(() => calls.some((c) => c.method === 'DELETE' && c.path === '/api/wishlist/12')).toBe(true);
  await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
  // Colosseum had "Back in stock" off; recreating it must not switch it back on.
  await expect.poll(() => calls.find((c) => c.method === 'POST' && c.path === '/api/wishlist')?.body).toMatchObject({
    set_num: '10276-1', target_price: 480, notify_target: true, notify_retiring: true, notify_stock: false,
  });
});

test('turning push off here unsubscribes only this browser, not the other devices', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'granted' });
    const sub = { endpoint: 'https://push.example/this-browser', unsubscribe: async () => true, toJSON: () => ({ keys: {} }) };
    const reg = { pushManager: { getSubscription: async () => sub } };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.resolve(reg), controller: null, register: async () => reg, getRegistrations: async () => [], addEventListener() {}, removeEventListener() {} },
    });
  });
  const deletes = [];
  await page.route('**/api/push/subscribe', (route) => {
    if (route.request().method() === 'DELETE') deletes.push(route.request().postData() ? JSON.parse(route.request().postData()) : null);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.goto('/#/me/notifications', { waitUntil: 'domcontentloaded' });
  const push = page.locator('#ntPush');
  await expect(push).toHaveAttribute('aria-checked', 'true');
  await push.click();
  await expect.poll(() => deletes.length).toBe(1);
  expect(deletes[0]).toEqual({ endpoint: 'https://push.example/this-browser' });
});

test('"I bought it" moves the set to the vault with an Undo', async ({ page }) => {
  const calls = await stubWishlist(page);
  await page.goto('/#/wishlist', { waitUntil: 'domcontentloaded' });
  await page.locator('.bv-wlalert').getByRole('button', { name: 'I bought it' }).click();
  await expect(page.locator('#toast')).toContainText('Moved The Starry Night to your vault');
  await expect(page.locator('.bv-wlrow', { hasText: 'The Starry Night' })).toHaveCount(0);
  await expect.poll(() => calls.find((c) => c.method === 'POST' && c.path === '/api/collection')?.body)
    .toEqual({ set_num: '21333-1', quantity: 1, purchase_price: 172 });
  await expect.poll(() => calls.some((c) => c.method === 'DELETE' && c.path === '/api/wishlist/11')).toBe(true);
  await expect(page.locator('#toast').getByRole('button', { name: 'Undo' })).toBeVisible();
});

test('notifications: switches save per category, quiet hours carry the time zone, push is explained in context', async ({ page }) => {
  // The explainer is for a browser that has never been asked. Full Chromium
  // reports that as Notification.permission 'default', but chrome-headless-shell
  // (what CI runs) reports 'denied', which correctly reads as blocked and skips
  // the explainer. Pin the never-asked state this test is about.
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'default' });
  });
  const patches = [];
  await page.route('**/api/me', (route) => {
    if (route.request().method() === 'PATCH') {
      patches.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      display_name: 'Test Collector', handle: 'tester', currency: 'USD', is_guest: false, email: 'tester@example.com',
      notify_price_drops: true, notify_sell_targets: true, notify_big_moves: false, notify_retiring: true, notify_back_in_stock: false,
      notify_weekly_digest: true, quiet_hours: false, quiet_start: 22, quiet_end: 8, portfolio_stats: {},
    }) });
  });
  await page.goto('/#/me/notifications', { waitUntil: 'domcontentloaded' });
  const pageEl = page.locator('#notificationsPage');
  await expect(pageEl.locator('h1')).toHaveText('Notifications');
  await expect(pageEl.getByRole('switch', { name: 'Big moves' })).toHaveAttribute('aria-checked', 'false');
  await expect(pageEl.getByRole('switch', { name: 'Sell targets' })).toHaveAttribute('aria-checked', 'true');

  await pageEl.getByRole('switch', { name: 'Sell targets' }).click();
  await expect.poll(() => patches.at(-1)).toEqual({ notify_sell_targets: false });

  // Switching an alert ON while push is off explains why, once, before asking.
  await pageEl.getByRole('switch', { name: 'Big moves' }).click();
  await expect.poll(() => patches.at(-1)).toEqual({ notify_big_moves: true });
  await expect(page.locator('#sheet')).toContainText('Get alerts on this phone?');
  await page.locator('#ntPermLater').click();
  await expect(page.locator('#sheet')).not.toHaveClass(/\bshow\b/);
  await pageEl.getByRole('switch', { name: 'Back in stock' }).click();
  await expect.poll(() => patches.at(-1)).toEqual({ notify_back_in_stock: true });
  // Asked once already — no second explainer.
  await expect(page.locator('#sheet')).not.toHaveClass(/\bshow\b/);

  await pageEl.getByRole('switch', { name: 'Quiet hours' }).click();
  await expect.poll(() => patches.at(-1)?.quiet_hours).toBe(true);
  expect(typeof patches.at(-1).timezone).toBe('string');
  await page.locator('#ntQuietStart').selectOption('23');
  await expect.poll(() => patches.at(-1)).toEqual({ quiet_start: 23 });
});

test('a launcher shortcut link opens the scanner and Back returns to the picker', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }], getVideoTracks: () => [] }) },
    });
  });
  await page.goto('/#/pile?scan=barcode', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#scanOverlay')).toHaveClass(/open/);
  expect(await page.evaluate(() => location.hash)).toBe('#/pile');
  const modes = await page.evaluate(async () => {
    const { deepLinkHash } = await import('/js/lib/deep-links.js');
    return [deepLinkHash('https://bricksvault.app/#/pile?scan=shelf'), deepLinkHash('https://bricksvault.app/wishlist')];
  });
  expect(modes).toEqual(['#/pile?scan=shelf', '#/wishlist']);
});
