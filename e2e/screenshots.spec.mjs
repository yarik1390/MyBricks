import { test } from './fixtures.mjs';

const { describe } = test;

// Captures the PWA manifest / store-listing screenshots against the stubbed
// e2e server (same fixtures as the smoke suite, so no live services and
// deterministic data). Output sizes must match manifest.json's `sizes`:
// narrow = 393×852 css @2x → 786×1704 px, wide = 1280×800 @1x.
// Run via e2e/screenshots.config.mjs (NOT part of the smoke suite).

test.use({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });

test('vault (narrow)', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('h1.brand-name').waitFor();
  await page.waitForTimeout(600); // hero value animation settles
  await page.screenshot({ path: 'public/screenshots/vault-narrow.png' });
});

test('set detail (narrow)', async ({ page }) => {
  await page.goto('/#/set/75192-1', { waitUntil: 'domcontentloaded' });
  await page.getByText('Millennium Falcon').first().waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'public/screenshots/detail-narrow.png' });
});

describe('wide', () => {
  test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  test('catalog (wide)', async ({ page }) => {
    await page.goto('/#/add', { waitUntil: 'domcontentloaded' });
    await page.locator('#catalogGrid').waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'public/screenshots/catalog-wide.png' });
  });
});

// ---------------------------------------------------------------------------
// Google Play listing assets → store/play/. Play phone screenshots must be
// between 16:9 and 9:16 — 360×640 css @3x = 1080×1920 px (exactly 9:16).
// ---------------------------------------------------------------------------
describe('play', () => {
  test.use({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3 });

  test('play: vault', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('h1.brand-name').waitFor();
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'store/play/01-vault.png' });
  });

  test('play: set detail', async ({ page }) => {
    await page.goto('/#/set/75192-1', { waitUntil: 'domcontentloaded' });
    await page.getByText('Millennium Falcon').first().waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'store/play/02-set-detail.png' });
  });

  test('play: catalog', async ({ page }) => {
    await page.goto('/#/add', { waitUntil: 'domcontentloaded' });
    await page.locator('#catalogGrid').waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'store/play/03-catalog.png' });
  });

  test('play: wishlist', async ({ page }) => {
    await page.route('**/api/wishlist', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        wishlist: [{ id: 'w1', set_num: '75192-1', name: 'Millennium Falcon', theme: 'Star Wars', current_value: 850, target_price: 720, image_url: null }],
        unread_alerts: [],
      }),
    }));
    await page.goto('/#/wishlist', { waitUntil: 'domcontentloaded' });
    await page.getByText('Millennium Falcon').first().waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'store/play/04-wishlist.png' });
  });

  // Feature graphic (required by Play, exactly 1024×500): composed from the app
  // icon + name + tagline on the brand kraft background. "brick collection"
  // wording deliberately avoids the LEGO trademark in marketing imagery.
  describe('feature graphic', () => {
    test.use({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
    test('play: feature graphic', async ({ page }) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.setContent(`
        <style>
          html,body{margin:0;padding:0;}
          .fg{width:1024px;height:500px;background:#F5F1E8;display:flex;align-items:center;justify-content:center;gap:56px;font-family:Georgia,'Times New Roman',serif;}
          .fg img{width:220px;height:220px;border-radius:48px;box-shadow:8px 8px 0 rgba(26,23,18,.15);}
          .fg .t h1{font-size:64px;margin:0 0 10px;color:#1A1712;letter-spacing:-1px;}
          .fg .t p{font-size:26px;margin:0;color:#5C5648;font-family:Arial,Helvetica,sans-serif;}
        </style>
        <div class="fg">
          <img src="http://localhost:4321/icon-512.png">
          <div class="t">
            <h1>BricksVault</h1>
            <p>Track, value &amp; grow your brick collection</p>
          </div>
        </div>`);
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: 'store/play/feature-graphic.png' });
    });
  });
});
