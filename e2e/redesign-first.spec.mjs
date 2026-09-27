import { test, expect } from './fixtures.mjs';

// First run and app states of the 2026 redesign: login, the Welcome flow and
// Brickset import, offline / can't-reach / error states, the app lock screen
// and the large-screen list–detail layout.

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

test('login offers providers, email on request and a guest path into the first run', async ({ page }) => {
  await page.addInitScript(() => { localStorage.removeItem('bv_setup_v1'); localStorage.setItem('bv_first_detected', '1'); });
  await page.goto('/#/login', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Know what your bricks are worth.' })).toBeVisible();
  await expect(page.locator('#googleSignIn')).toHaveText('Continue with Google');
  // Email is one tap away and keeps the existing form ids.
  await expect(page.locator('#authEmail')).toHaveCount(0);
  await page.locator('#authEmailToggle').click();
  await expect(page.locator('#authEmail')).toBeFocused();
  await expect(page.locator('#authPass')).toBeVisible();
  await page.locator('#authSubmit').click();
  await expect(page.locator('#authErr')).toHaveText('Email and password required.');
  await page.locator('#authSwitch').click();
  await expect(page.locator('#authSubmit')).toHaveText('Create account');

  await page.locator('.bv-login__legal[data-legal-sheet="terms"]').click();
  await expect(page.locator('#sheet')).toContainText('Terms of Service');
  await page.keyboard.press('Escape');

  await page.locator('#authGuest').click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/welcome');
});

test('a fresh device lands in Welcome; choices apply in place and finishing marks the first run done', async ({ page }) => {
  await page.addInitScript(() => { localStorage.removeItem('bv_setup_v1'); localStorage.setItem('bv_first_detected', '1'); });
  const patches = [];
  await page.route('**/api/me', (route) => {
    if (route.request().method() === 'PATCH') { patches.push(JSON.parse(route.request().postData() || '{}')); return json(route, { ok: true }); }
    return json(route, { display_name: 'Sam Rivera', handle: 'sam', currency: 'USD', retail_market: 'FR', is_guest: false, notify_price_drops: true, portfolio_stats: {} });
  });
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/welcome');
  await expect(page.locator('#welTitle')).toHaveText('Welcome, Sam');
  await expect(page.locator('.bv-wel__step')).toHaveText('Step 1 of 2');

  await page.locator('#welCurrency').click();
  await page.locator('#welCurrencySelect').selectOption('EUR');
  await expect.poll(() => patches.at(-1)).toEqual({ currency: 'EUR' });
  await expect(page.locator('#welCurrency .bv-row__trail')).toContainText('EUR €');

  await page.locator('#welMode').click();
  await page.locator('#welModeSheet [data-mode="simple"]').click();
  await expect(page.locator('#welMode .bv-row__trail')).toHaveText('Simple');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('bv_mode'))).toBe('simple');

  await page.locator('#welContinue').click();
  await expect(page.getByRole('heading', { name: 'Let’s fill your vault' })).toBeVisible();
  await expect(page.locator('#fillShelf')).toContainText('Fastest');
  await page.locator('#fillLater').click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/');
  expect(await page.evaluate(() => localStorage.getItem('bv_setup_v1'))).toBe('1');
});

test('Brickset import connects, shows what arrived and ends on Vault ready', async ({ page }) => {
  await page.addInitScript(() => { localStorage.removeItem('bv_setup_v1'); localStorage.setItem('bv_first_detected', '1'); });
  const calls = [];
  await page.route('**/api/brickset/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    calls.push(path);
    if (path.endsWith('/login')) return json(route, { ok: true });
    await new Promise((r) => setTimeout(r, 200));
    return json(route, { ok: true, added: 1, skipped: 2, unknown: 1, already: 1, added_set_nums: ['75192-1'], total: 3 });
  });
  await page.goto('/#/welcome/import', { waitUntil: 'domcontentloaded' });
  await page.locator('#welBsUser').fill('sam');
  await page.locator('#welBsPass').fill('secret');
  await page.locator('#welBsConnect').click();
  await expect(page.locator('.bv-ring')).toContainText('of 3 sets');
  await expect(page.locator('.bv-importsum')).toContainText('$850');
  await expect(page.locator('.bv-importsum')).toContainText('Already in your vault1');
  await expect(page.locator('.bv-importsum')).toContainText('Not in our catalog1 · review later');
  await expect(page.locator('.bv-justadded__row')).toHaveCount(1);
  expect(calls).toEqual(['/api/brickset/login', '/api/brickset/sync']);

  await page.getByRole('link', { name: 'See my vault' }).click();
  await expect(page.getByRole('heading', { name: 'Your vault is ready' })).toBeVisible();
  await expect(page.locator('.bv-ready__value')).toHaveText('$850');
  await page.locator('#readyOpen').click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/');
  expect(await page.evaluate(() => localStorage.getItem('bv_setup_v1'))).toBe('1');
});

test('a repeat Brickset sync says the sets are already in the vault, not missing, and lists nothing as just added', async ({ page }) => {
  await page.addInitScript(() => { localStorage.removeItem('bv_setup_v1'); localStorage.setItem('bv_first_detected', '1'); });
  await page.route('**/api/brickset/**', (route) => (new URL(route.request().url()).pathname.endsWith('/login')
    ? json(route, { ok: true })
    : json(route, { ok: true, added: 0, skipped: 3, unknown: 0, already: 3, added_set_nums: [], total: 3 })));
  await page.goto('/#/welcome/import', { waitUntil: 'domcontentloaded' });
  await page.locator('#welBsUser').fill('sam');
  await page.locator('#welBsPass').fill('secret');
  await page.locator('#welBsConnect').click();
  const summary = page.locator('.bv-importsum');
  await expect(summary).toContainText('Already in your vault3');
  await expect(summary).not.toContainText('Not in our catalog');
  // The vault's own Millennium Falcon wasn't added by this run.
  await expect(page.locator('.bv-justadded__row')).toHaveCount(0);
});

for (const [who, setCount, expected] of [
  ['a returning collector keeps their synced currency and market on a new phone', 3, []],
  ['a brand-new account takes its currency and market from the phone region', 0, [{ currency: 'EUR', retail_market: 'DE' }]],
]) {
  test(who, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('bv_setup_v1');
      localStorage.removeItem('bv_first_detected');
      localStorage.removeItem('bv_currency');
      Object.defineProperty(navigator, 'language', { get: () => 'de-DE' });
    });
    const patches = [];
    await page.route('**/api/me', (route) => {
      if (route.request().method() === 'PATCH') { patches.push(JSON.parse(route.request().postData() || '{}')); return json(route, { ok: true }); }
      return json(route, { display_name: 'Sam Rivera', handle: 'sam', currency: 'USD', retail_market: 'FR', is_guest: false, notify_price_drops: true, portfolio_stats: { set_count: setCount } });
    });
    await page.goto('/#/welcome', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#welTitle')).toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('bv_first_detected'))).toBe('1');
    await expect.poll(() => patches).toEqual(expected);
  });
}

test('offline says when values are from and what will sync; an unreachable server offers Retry', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('bv_outbox', JSON.stringify([{ id: 1, path: '/api/collection', method: 'POST' }, { id: 2, path: '/api/collection', method: 'POST' }]));
  });
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#setList .bv-setrow')).toHaveCount(1);
  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  const bannerText = page.locator('#offlineBanner .offline-banner__text');
  await expect(page.locator('#offlineBanner')).toBeVisible({ timeout: 8000 });
  await expect(bannerText).toContainText(/^Offline · values from .+\. 2 changes will sync when you’re back$/);
  // An edit made while already offline updates the count in place.
  await page.evaluate(async () => { (await import('/js/api.js')).outboxEnqueue({ path: '/api/collection', method: 'POST' }); });
  await expect(bannerText).toContainText(/3 changes will sync when you’re back$/);
  // (Drop the queued changes so reconnecting doesn't replay them and reload the vault.)
  await page.evaluate(() => localStorage.removeItem('bv_outbox'));
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('bv:api-ok')));
  await expect(page.locator('#offlineBanner')).toBeHidden();

  // Saved values on screen, server unreachable: say so and offer Retry.
  let fail = true;
  await page.route('**/api/collection', (route) => (fail && route.request().method() === 'GET'
    ? json(route, { error: 'boom' }, 500)
    : route.fallback()));
  await page.goto('/#/me', { waitUntil: 'domcontentloaded' });
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#bvReachError')).toContainText('Can’t reach BricksVault');
  fail = false;
  await page.locator('#bvReachRetry').click();
  await expect(page.locator('#bvReachError')).toHaveCount(0);
});

test('error and not-found pages are honest and actionable', async ({ page }) => {
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const { errorStateHTML } = await import('/js/router.js');
    document.getElementById('root').innerHTML = errorStateHTML();
  });
  await expect(page.getByRole('heading', { name: 'This page didn’t load' })).toBeVisible();
  await expect(page.locator('#errorRetry')).toHaveText('Retry');
  await page.goto('/#/no-such-page', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  expect(await page.title()).toBe('Page not found · BricksVault');
});

test('app lock screen hides values and offers the sensor and a PIN fallback', async ({ page }) => {
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => { (await import('/js/lib/app-lock.js')).lockAndPrompt(); });
  const lock = page.getByRole('dialog', { name: 'BricksVault is locked' });
  await expect(lock).toBeVisible();
  await expect(lock).toContainText('Values stay hidden in recent apps.');
  await expect(lock.getByRole('button', { name: 'Unlock with fingerprint' })).toBeVisible();
  await expect(lock.getByRole('button', { name: 'Use PIN instead' })).toBeVisible();
});

test.describe('large screens', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('a set opens beside its list; other routes close the pane', async ({ page }) => {
    await page.route('**/api/collection', (route) => (route.request().method() === 'GET'
      ? json(route, {
        items: [
          { id: 1, quantity: 1, purchase_price: 700, set_num: '75192-1', name: 'Millennium Falcon', theme: 'Star Wars', current_value: 850, blended_value: 850 },
          { id: 2, quantity: 1, purchase_price: 600, set_num: '10294-1', name: 'Titanic', theme: 'Icons', current_value: 760, blended_value: 760 },
        ], total_value: 1610, total_paid: 1300, count: 2,
      })
      : route.fallback()));
    await page.goto('/#/', { waitUntil: 'domcontentloaded' });
    await page.locator('#setList .vault-row a.vault-row__link').first().click();
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/set\//);
    const pane = page.locator('#bvListPane');
    await expect(pane).toBeVisible();
    await expect(pane.locator('.is-current')).toHaveCount(1);
    await expect(page.locator('#nav')).toBeVisible();

    await page.goto('/#/me', { waitUntil: 'domcontentloaded' });
    await expect(pane).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveClass(/bv-two-pane/);
  });
});
