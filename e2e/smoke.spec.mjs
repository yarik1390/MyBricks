import { test, expect } from './fixtures.mjs';

// Hermetic smoke tests: auth + all /api/* are stubbed by the `stub` fixture, so
// these exercise the real frontend bundle without any live service.

test('boots into the authed app (not the login screen) and loads the profile', async ({ page, stub }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1.brand-name')).toHaveText('BricksVault');
  // Guests never see the vault header; reaching it proves the injected session took.
  expect(stub.calls.some((c) => c.path === '/api/me')).toBeTruthy();
  expect(stub.calls.some((c) => c.path === '/api/collection')).toBeTruthy();
  // No unhandled requests leaked to the network (everything was intercepted).
});

test('portfolio renders the collection', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1.brand-name')).toBeVisible();
  await expect(page.getByText('Millennium Falcon').first()).toBeVisible();
});

test('catalog ("Find a set") renders search results', async ({ page }) => {
  await page.goto('/#/add', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1.topbar-title')).toHaveText('Find a set');
  await expect(page.locator('#catalogGrid')).toBeVisible();
  await expect(page.locator('#catalogCount')).toContainText('1 result');
});

test('scan route waits for a method choice and accepts a manual set number', async ({ page }) => {
  await page.goto('/#/pile', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.scan-choice')).toBeVisible();
  await expect(page.locator('#pileScanBarcode')).toBeVisible();
  await expect(page.locator('#pileScanPhoto')).toBeVisible();
  await expect(page.locator('#scanOverlay')).not.toHaveClass(/open/);

  await page.locator('#pileManualInput').fill('75192');
  await page.locator('#pileManualSubmit').click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/set/75192-1');
  await expect(page.getByText('Millennium Falcon').first()).toBeVisible();
});

test('guest photo scan asks for setup before mounting the camera', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.addInitScript(() => {
    localStorage.removeItem('bv_session');
    localStorage.removeItem('bv_gemini_key');
    localStorage.removeItem('bv_openai_key');
  });
  await page.goto('/#/pile', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('#pileScanPhoto')).toContainText('Sign in or add an AI key first');
  const scanLayout = await page.locator('#pileScanPhoto').evaluate((row) => {
    const copy = row.querySelector('.scan-method-copy').getBoundingClientRect();
    const arrow = row.querySelector('.scan-method-arrow').getBoundingClientRect();
    return {
      fits: row.scrollWidth <= row.clientWidth + 1,
      arrowAligned: Math.abs((copy.top + copy.height / 2) - (arrow.top + arrow.height / 2)) < 12,
    };
  });
  expect(scanLayout.fits).toBe(true);
  expect(scanLayout.arrowAligned).toBe(true);
  await page.locator('#pileScanPhoto').click();
  await expect(page.locator('#sheet')).toHaveClass(/show/);
  await expect(page.getByRole('heading', { name: 'Set up photo scanning' })).toBeVisible();
  const setupButtons = await page.locator('.photo-scan-setup .btn-row').evaluate((row) => {
    const buttons = [...row.querySelectorAll('button')].map((button) => button.getBoundingClientRect());
    return {
      stacked: buttons[1].top >= buttons[0].bottom,
      fits: row.scrollWidth <= row.clientWidth + 1,
    };
  });
  expect(setupButtons.stacked).toBe(true);
  expect(setupButtons.fits).toBe(true);
  await expect(page.locator('#scanOverlay')).not.toHaveClass(/open/);
});

test('native barcode cancellation returns to the method picker without a scanner flash', async ({ page }) => {
  await page.addInitScript(() => {
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        BarcodeScanner: {
          isSupported: async () => ({ supported: true }),
          isGoogleBarcodeScannerModuleAvailable: async () => ({ available: true }),
          scan: async () => {
            await new Promise(resolve => setTimeout(resolve, 500));
            return { barcodes: [] };
          },
        },
      },
    };
  });
  await page.goto('/#/pile', { waitUntil: 'domcontentloaded' });

  await page.locator('#pileScanBarcode').click();
  await expect(page.locator('#scanOverlay')).toHaveClass(/native-handoff/);
  await expect(page.locator('#scanOverlay')).not.toBeVisible();
  await expect(page.locator('.scan-choice')).toBeVisible();

  await expect(page.locator('#scanOverlay')).not.toHaveClass(/open/);
  await expect(page.locator('#pileScanBarcode')).toBeFocused();
});

test('compact catalog rows reflow long labels without horizontal clipping', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('bv_compact_view', 'true'));
  await page.goto('/#/add', { waitUntil: 'domcontentloaded' });

  const row = page.locator('.set-list-card.compact').first();
  await expect(row).toBeVisible();
  await expect(row.locator('.sl-name')).toHaveCSS('-webkit-line-clamp', '2');
  const clippedBadge = await row.locator('.trust-badge').evaluate(el => el.scrollWidth > el.clientWidth + 1);
  expect(clippedBadge).toBe(false);
  const pageOverflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(pageOverflows).toBe(false);
});

test('set detail renders with the action bar', async ({ page }) => {
  await page.goto('/#/set/75192-1', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Millennium Falcon').first()).toBeVisible();
  await expect(page.locator('#wishToggle')).toBeVisible();
  await expect(page.locator('#addBtn')).toBeVisible();
});

test('pricing details opens as a bottom sheet and keeps the set page mounted', async ({ page }) => {
  await page.goto('/#/set/75192-1', { waitUntil: 'domcontentloaded' });
  await page.locator('#pricingDetailsBtn').click();
  await expect(page.locator('#sheet')).toHaveClass(/show/);
  await expect(page.locator('#pricingDetailsSheetTitle')).toHaveText('Pricing details');
  await expect(page).toHaveURL(/#\/set\/75192-1$/);
  await page.locator('#pricingDetailsClose').click();
  await expect(page.locator('#sheet')).not.toHaveClass(/show/);
});

test('how-we-price opens in-app and preserves the current route', async ({ page }) => {
  await page.goto('/#/me', { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: 'How We Price' }).click();
  await expect(page.locator('#methodologySheetTitle')).toHaveText('How we price LEGO sets');
  await expect(page.locator('.methodology-sheet')).toContainText('Five numbers, five different jobs');
  await expect(page).toHaveURL(/#\/me$/);
});

test('Pixel-sized set detail clears the sticky action bar and uses a compact hero', async ({ page, stub }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.route('**/api/sets/75192-1', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ set: { ...stub.SET, image_url: '/icon.svg' }, entry: null }),
  }));
  await page.goto('/#/set/75192-1/community', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.detail-action-bar')).toBeVisible();
  await expect(page.locator('.detail-tab-panel')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const layout = await page.evaluate(() => {
    const panel = document.querySelector('.detail-tab-panel').getBoundingClientRect();
    const action = document.querySelector('.detail-action-bar').getBoundingClientRect();
    const hero = document.querySelector('.detail-hero').getBoundingClientRect();
    return { panelBottom: panel.bottom, actionTop: action.top, heroHeight: hero.height };
  });
  expect(layout.panelBottom).toBeLessThanOrEqual(layout.actionTop - 16);
  expect(layout.heroHeight).toBeLessThanOrEqual(232);
});

test('Pixel-sized set detail ends close to the action bar and blends the hero at both edges', async ({ page, stub }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.route('**/api/sets/75192-1', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ set: { ...stub.SET, image_url: '/icon.svg' }, entry: null }),
  }));
  await page.goto('/#/set/75192-1', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.detail-action-bar')).toBeVisible();
  await expect(page.locator('.bl-buy-link').last()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

  const layout = await page.evaluate(() => {
    const lastLink = [...document.querySelectorAll('.bl-buy-link')].at(-1).getBoundingClientRect();
    const action = document.querySelector('.detail-action-bar').getBoundingClientRect();
    const backdrop = getComputedStyle(document.querySelector('.detail-hero-bg'));
    const photo = getComputedStyle(document.querySelector('.detail-img img.set-photo'));
    return {
      gap: action.top - lastLink.bottom,
      mask: backdrop.maskImage || backdrop.webkitMaskImage,
      filter: photo.filter,
    };
  });
  expect(layout.gap).toBeGreaterThanOrEqual(8);
  expect(layout.gap).toBeLessThanOrEqual(72);
  expect(layout.mask).toContain('rgba(0, 0, 0, 0) 0%');
  expect(layout.mask).toContain('rgba(0, 0, 0, 0) 100%');
  expect(layout.filter).toContain('drop-shadow');
});

test('Pixel-sized vault card reserves enough room for a four-digit price', async ({ page, stub }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  const item = {
    id: 7, quantity: 1, purchase_price: 4121.46, ...stub.SET,
    name: "Jango Fett's Slave I with Bonus Collector Packaging",
    market_value: 2796.67, blended_value: 2796.67, current_value: 2796.67,
  };
  await page.route('**/api/collection', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ items: [item], total_value: 2796.67, total_paid: 4121.46, count: 1 }),
  }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const layout = await page.locator('.set-list-card:not(.compact)').first().evaluate((card) => {
    const name = card.querySelector('.sl-name').getBoundingClientRect();
    const value = card.querySelector('.sl-value');
    const valueRect = value.getBoundingClientRect();
    return {
      nameRight: name.right,
      valueLeft: valueRect.left,
      valueFits: value.scrollWidth <= value.clientWidth + 1,
      cardFits: card.scrollWidth <= card.clientWidth + 1,
    };
  });
  expect(layout.nameRight).toBeLessThanOrEqual(layout.valueLeft - 4);
  expect(layout.valueFits).toBe(true);
  expect(layout.cardFits).toBe(true);
});

test('Pixel-sized long set title and pricing sheet remain readable', async ({ page, stub }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  const longSet = {
    ...stub.SET,
    name: `H.C. Andersen's "Clumsy Hans" by D.H. Design (LEGO Inside Tour Version)`,
    image_url: '/icon.svg',
    valuation: {
      read_enabled: true,
      model_version: 'v3',
      new: { fair_value: 3052.8, low: 2800, high: 3300, confidence: 'medium', sample_count: 8, independent_family_count: 2, basis: [], as_of: '2026-07-19' },
      used: { fair_value: 341.13, low: 277, high: 444, confidence: 'low', sample_count: 12, independent_family_count: 1, basis: [], as_of: '2026-06-22' },
    },
  };
  await page.route('**/api/sets/75192-1', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ set: longSet, entry: null }),
  }));
  await page.goto('/#/set/75192-1', { waitUntil: 'domcontentloaded' });

  const title = page.locator('.detail-title');
  await expect(title).toHaveClass(/is-very-long/);
  expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.locator('#pricingDetailsBtn').click();
  const cards = page.locator('.pricing-condition-card');
  await expect(cards).toHaveCount(2);
  const stacked = await cards.evaluateAll((els) => {
    const first = els[0].getBoundingClientRect();
    const second = els[1].getBoundingClientRect();
    return second.top >= first.bottom;
  });
  expect(stacked).toBe(true);
  expect(await page.locator('#sheet').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});

test('upcoming sets show announced retail instead of stale market estimates', async ({ page, stub }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  const upcoming = {
    ...stub.SET,
    coming_soon: true,
    upcoming_price: 299.99,
    current_value: 11,
    market_value: 11,
    launch_date: '2026-09-01',
    valuation: {
      read_enabled: true,
      model_version: 'v3',
      new: { fair_value: 11, low: 7.15, high: 14.85, confidence: 'estimated', sample_count: 0, independent_family_count: 1, basis: [] },
    },
  };
  await page.route('**/api/sets/75192-1', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ set: upcoming, entry: null }),
  }));
  await page.goto('/#/set/75192-1', { waitUntil: 'domcontentloaded' });
  await page.locator('#pricingDetailsBtn').click();

  const sheet = page.locator('.pricing-details-sheet-body');
  await expect(sheet).toContainText('Retail price, not resale value');
  await expect(sheet).toContainText('Announced retail price');
  await expect(sheet).toContainText('$299.99');
  await expect(sheet).toContainText('Resale pricing');
  await expect(sheet).not.toContainText('$11.00');
  await expect(sheet.locator('.pricing-condition-card')).toHaveCount(1);
});

test('vivid light mode gives set photos a neutral non-blended stage', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('bv_skin', 'vivid');
    localStorage.setItem('bv_theme', 'light');
  });
  await page.route('**/api/sets/search*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ sets: [{
      set_num: '75192-1', name: 'Millennium Falcon', year: 2017, pieces: 7541,
      theme: 'Star Wars', image_url: '/icon.svg', current_value: 850,
    }], total: 1, hasMore: false }),
  }));
  await page.goto('/#/add', { waitUntil: 'domcontentloaded' });
  const image = page.locator('.set-card-img img.set-photo').first();
  await expect(image).toBeVisible();
  await expect(image).toHaveCSS('mix-blend-mode', 'normal');
  await expect(page.locator('.set-card-img').first()).toHaveCSS('background-color', 'rgb(244, 244, 242)');
});

test('wishlist toggle removes the set and flips the button', async ({ page, stub }) => {
  // Load the portfolio first so state.wishlist is populated (the set is wished).
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1.brand-name')).toBeVisible();
  // In-app (no-reload) navigation preserves the in-memory wishlist state.
  await page.evaluate(() => { location.hash = '#/set/75192-1'; });

  const wish = page.locator('#wishToggle');
  await expect(wish).toHaveAttribute('aria-label', 'Remove from wishlist');
  await wish.click();
  // Optimistic repaint flips the control back to "Add".
  await expect(wish).toHaveAttribute('aria-label', 'Add to wishlist');
  expect(stub.calls.some((c) => c.method === 'DELETE' && c.path.startsWith('/api/wishlist/'))).toBeTruthy();
});

test('set detail: adding to the vault posts to the collection', async ({ page, stub }) => {
  await page.goto('/#/set/75192-1', { waitUntil: 'domcontentloaded' });
  const add = page.locator('#addBtn');
  await expect(add).toBeVisible();
  await add.click();
  await expect
    .poll(() => stub.calls.some((c) => c.method === 'POST' && c.path === '/api/collection'))
    .toBe(true);
});

test('set detail: switching to the forecast tab keeps the page mounted', async ({ page }) => {
  await page.goto('/#/set/75192-1/forecast', { waitUntil: 'domcontentloaded' });
  // The set-detail view still renders (tabbed) rather than falling back to an error.
  await expect(page.getByText('Millennium Falcon').first()).toBeVisible();
  await expect(page.locator('#addBtn')).toBeVisible();
});

test('admin console renders its sections for an admin user', async ({ page }) => {
  // Elevate this run to admin (more-specific route registered after the fixture's
  // catch-all, so it wins for /api/me); the admin section loads fall back to {}.
  await page.route('**/api/me', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ display_name: 'Admin', handle: 'admin', currency: 'USD', is_guest: false, is_admin: true, notify_price_drops: true, portfolio_stats: {} }),
  }));
  await page.goto('/#/me/admin', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.admin-dashboard-page')).toBeVisible();
  await expect(page.locator('.admin-segments')).toBeVisible();
  // The segment nav (always visible) exposes the section tabs.
  await expect(page.locator('[data-admin-section-link="adminPopulate"]')).toBeVisible();
  await expect(page.locator('[data-admin-section-link="adminUsers"]')).toBeVisible();

  // Segment tabs are wired synchronously (wireAdminShell) — clicking one
  // activates it without any network.
  const usersTab = page.locator('[data-admin-section-link="adminUsers"]');
  await usersTab.click();
  await expect(usersTab).toHaveAttribute('aria-selected', 'true');
});

test('non-admin is redirected away from the admin console', async ({ page }) => {
  // The default fixture profile has no is_admin flag → renderMeAdmin bounces to /me.
  await page.goto('/#/me/admin', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/me');
});

test('me: account deletion is gated behind typing DELETE (store requirement)', async ({ page, stub }) => {
  await page.goto('/#/me', { waitUntil: 'domcontentloaded' });

  const row = page.locator('#deleteAccountRow');
  await expect(row).toBeVisible();
  await row.click();

  // The confirm button is present but inert until the user types DELETE.
  const btn = page.locator('#deleteAccountBtn');
  await expect(btn).toBeVisible();
  await expect(btn).toBeDisabled();

  await page.locator('#deleteConfirmInput').fill('nope');
  await expect(btn).toBeDisabled();

  await page.locator('#deleteConfirmInput').fill('DELETE');
  await expect(btn).toBeEnabled();

  // Only after confirmation does the destructive DELETE /api/me fire.
  await btn.click();
  await expect
    .poll(() => stub.calls.filter((c) => c.method === 'DELETE' && c.path === '/api/me').length)
    .toBeGreaterThan(0);
});

test('me: public profile switches update without repainting the page', async ({ page, stub }) => {
  await page.goto('/#/me', { waitUntil: 'domcontentloaded' });

  for (const id of ['publicToggle', 'publicValToggle']) {
    const toggle = page.locator(`#${id}`);
    await expect(toggle).toBeVisible();
    await toggle.evaluate(el => { el.dataset.keptAcrossToggle = 'yes'; });
    const before = await toggle.getAttribute('aria-checked');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');
    await expect(toggle).toHaveAttribute('data-kept-across-toggle', 'yes');
  }

  await expect.poll(() => stub.calls.filter(c => c.method === 'PATCH' && c.path === '/api/me').length).toBe(2);
  await expect(page).toHaveURL(/#\/me$/);
});

// ---------------------------------------------------------------------------
// Valuation trust pass: estimates read humbler than market values.
// ---------------------------------------------------------------------------

test('formula-valued set renders as a humble estimate (~, label, provenance)', async ({ page }) => {
  await page.goto('/#/set/4000-1', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Formula Test Set').first()).toBeVisible();
  const summary = page.locator('.detail-summary');
  await expect(summary.locator('.detail-summary-lbl')).toHaveText('Estimated value');
  await expect(summary.locator('.detail-summary-val')).toContainText('~');
  await expect(summary.locator('.detail-summary-src')).toContainText('no recent market sales');
  // The sticky add button carries the same humility marker.
  await expect(page.locator('#addBtn')).toContainText('~');
});

test('market-valued set cites its provenance (source count + typical range)', async ({ page }) => {
  await page.goto('/#/set/75192-1', { waitUntil: 'domcontentloaded' });
  const summary = page.locator('.detail-summary');
  await expect(summary.locator('.detail-summary-lbl')).toHaveText('Value');
  await expect(summary.locator('.detail-summary-val')).not.toContainText('~');
  await expect(summary.locator('.detail-summary-src')).toContainText('From 3 market sources');
  await expect(summary.locator('.detail-summary-src')).toContainText('typically');
});

test('forecast tab shows only the caveated 2-year projection (no 5-year)', async ({ page }) => {
  await page.goto('/#/set/75192-1/forecast', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('2-year projection')).toBeVisible();
  await expect(page.getByText('5-year')).toHaveCount(0);
  await expect(page.getByText('Not financial advice')).toBeVisible();
});

// ---------------------------------------------------------------------------
// Pro gating: Insights teaser, locked history ranges, tiered export copy.
// ---------------------------------------------------------------------------

test('free user sees the Insights teaser instead of the toolkit', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('.portfolio-tab[data-tab="insights"]').click();
  await expect(page.getByTestId('insights-teaser')).toBeVisible();
  await expect(page.locator('#insightsUpgradeBtn')).toBeVisible();
  // The real toolkit sections must NOT render — "Top Movers (90-day Slope)" is
  // a section heading unique to the full view (the teaser only *names* radar
  // etc., and getByText matches case-insensitive substrings).
  await expect(page.getByText('Top Movers (90-day Slope)')).toHaveCount(0);
});

test('free user: 1Y range pill is locked and explains itself instead of lying', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const pill = page.locator('#rangePills button[data-r="1Y"]');
  await expect(pill).toContainText('⭐');
  await pill.click();
  await expect(page.getByText('History beyond 90 days is a Pro perk')).toBeVisible();
  // The pill did not activate — the range selection stayed put.
  await expect(pill).not.toHaveClass(/active/);
});

test('Pro user gets the full Insights toolkit, no teaser', async ({ page }) => {
  await page.route('**/api/collection/history*', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      pro: true, days: 365,
      snapshots: [
        { snapshot_date: '2026-06-01', total_value: 800, total_paid: 700, set_count: 1 },
        { snapshot_date: '2026-07-01', total_value: 850, total_paid: 700, set_count: 1 },
      ],
    }),
  }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('.portfolio-tab[data-tab="insights"]').click();
  await expect(page.getByText('Retirement Radar')).toBeVisible();
  await expect(page.getByTestId('insights-teaser')).toHaveCount(0);
});

test('export page states the free/Pro column split honestly', async ({ page }) => {
  await page.goto('/#/me/data', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText("CSV of everything you've entered")).toBeVisible();
  await expect(page.getByText('adds current value, retail & ROI')).toBeVisible();
});

test('Pro pitch on the Me page leads with the investor toolkit', async ({ page }) => {
  await page.goto('/#/me', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Investor insights: sell/buy signals, top movers, retirement radar')).toBeVisible();
  await expect(page.getByText('Full 1-year portfolio history')).toBeVisible();
});

// ---------------------------------------------------------------------------
// Audit-remediation regressions: Kids escape, undo, alerts, wishlist target,
// value consistency, share target.
// ---------------------------------------------------------------------------

test('kids mode without a PIN exits freely (no PIN trap)', async ({ page }) => {
  await page.route('**/api/me', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ display_name: 'Parent', handle: 'parent', currency: 'USD', is_guest: false, has_kids_pin: false, notify_price_drops: true, portfolio_stats: {} }),
  }));
  await page.addInitScript(() => localStorage.setItem('bv_mode', 'kids'));
  // Load the app (state.me populates via /api/me on the me-dependent views);
  // prime state.me by visiting the vault first, then enter kids.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const { api } = await import('/js/api.js');
    const { state } = await import('/js/state.js');
    state.me = await api('/api/me');
    location.hash = '#/kids';
  });
  const exit = page.locator('#exitKidsBtn');
  await exit.waitFor();
  await exit.click();
  // No PIN configured → no PIN sheet, straight back to the vault.
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/');
  await expect(page.locator('#exitPinInput')).toHaveCount(0);
});

test('deleting an owned set offers a working Undo', async ({ page, stub }) => {
  await page.route('**/api/sets/75192-1', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ set: stub.SET, entry: { id: 1, quantity: 1, purchase_price: 700, condition: 'new' } }),
  }));
  await page.goto('/#/set/75192-1', { waitUntil: 'domcontentloaded' });
  await page.locator('#qtyDown').click();
  // Confirm sheet → Remove
  await page.locator('#cfYes').click();
  await expect.poll(() => stub.calls.some((c) => c.method === 'DELETE' && c.path.startsWith('/api/collection/'))).toBe(true);
  // Undo toast appears; tapping it re-POSTs the kept payload.
  const undo = page.locator('#toast .toast-undo-btn');
  await expect(undo).toBeVisible();
  await undo.click();
  await expect.poll(() => stub.calls.some((c) => c.method === 'POST' && c.path === '/api/collection')).toBe(true);
});

test('viewing the alerts sheet marks alerts read and clears the badge', async ({ page, stub }) => {
  await page.route('**/api/wishlist', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      wishlist: [{ id: 'w1', set_num: '75192-1', name: 'Millennium Falcon' }],
      unread_alerts: [{ id: 'a1', alert_type: 'drop', set_name: 'Millennium Falcon', current_value: 800, target_price: 850, triggered_at: new Date().toISOString() }],
    }),
  }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#alertsBtn').click();
  await expect(page.getByText('Price drop ·')).toBeVisible();
  // Viewing IS reading: the per-alert mark-read POST fires without any tap.
  await expect.poll(() => stub.calls.some((c) => c.method === 'POST' && c.path === '/api/wishlist/a1')).toBe(true);
});

test('wishlist sheet pre-fills a suggested target and explains the no-target case', async ({ page }) => {
  await page.route('**/api/wishlist', (route, req) => {
    if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ wishlist: [], unread_alerts: [] }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ item: { id: 'w9' } }) });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { location.hash = '#/set/75192-1'; });
  const wish = page.locator('#wishToggle');
  await expect(wish).toHaveAttribute('aria-label', 'Add to wishlist');
  await wish.click();
  const target = page.locator('#wlTargetPrice');
  await expect(target).toBeVisible();
  // 85% of the $850 market value, pre-filled so "no target" is an explicit act.
  await expect(target).toHaveValue('722.50');
  await expect(page.getByText('Leave empty to watch without price-drop alerts.')).toBeVisible();
});

test('catalog and detail show the SAME value for a blended-only set', async ({ page }) => {
  const BLENDED_ONLY = {
    set_num: '77777-1', name: 'Blend Test Set', year: 2020, pieces: 500, minifigs: 0,
    theme: 'Creator', image_url: null, retail_price: 49.99,
    blended_value: 500, valuation_method: 'market', retired: 0,
  };
  await page.route('**/api/sets/search**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ sets: [BLENDED_ONLY], total: 1, hasMore: false }),
  }));
  await page.route('**/api/sets/77777-1', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ set: BLENDED_ONLY, entry: null }),
  }));
  await page.goto('/#/add', { waitUntil: 'domcontentloaded' });
  // Catalog card must use the blended value (the old code fell through to a
  // missing current_value and disagreed with the vault/detail).
  await expect(page.locator('.set-card-value').first()).toContainText('$500');
  await page.evaluate(() => { location.hash = '#/set/77777-1'; });
  await expect(page.locator('.detail-summary-val')).toContainText('$500');
});

test('web share target lands as a catalog search', async ({ page }) => {
  await page.goto('/?text=75192', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => location.hash)).toContain('#/add?q=75192');
  await expect(page.locator('h1.topbar-title')).toHaveText('Find a set');
});
