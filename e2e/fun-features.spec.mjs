import { test, expect, SET } from './fixtures.mjs';

// Screenshots for review; FUN_SHOTS points them elsewhere locally.
const SHOTS = process.env.FUN_SHOTS || 'artifacts/fun-features';
const THEMES = [['Star Wars', 1200], ['Technic', 640], ['Icons', 420], ['City', 160], ['Ninjago', 90], ['Friends', 40], ['Ideas', 30]];
const ITEMS = THEMES.map(([theme, v], i) => ({ ...SET, id: i + 1, set_num: `${7000 + i}-1`, name: `${theme} set`, theme, quantity: 3, purchase_price: v * 0.8, market_value: v, blended_value: v, current_value: v, value: v, market_value_low: v * .9, market_value_high: v * 1.1 }));

async function mockVault(page, items = ITEMS) {
  await page.route('**/api/collection', route => route.request().method() === 'GET'
    ? route.fulfill({ json: { items, total_value: items.reduce((s, i) => s + i.value, 0), total_paid: items.reduce((s, i) => s + i.purchase_price, 0), count: items.length } })
    : route.fallback());
}

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Vault hero shows a brick tower, one layer per theme, largest at the bottom', async ({ page }) => {
    await mockVault(page);
    await page.goto('/#/');
    const tower = page.locator('#vaultHero .vault-tower');
    await expect(tower).toBeVisible();
    // 5 themes + "Other" for the tail.
    const layers = await tower.evaluate(svg => [...svg.querySelectorAll('.vault-tower__layer')].map(r => Number(r.getAttribute('height'))));
    expect(layers.length).toBe(6);
    expect(layers[0]).toBeGreaterThan(layers[3]);
    const hero = await page.locator('#vaultHero').boundingBox();
    const box = await tower.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(hero.x + hero.width);
    await page.locator('#vaultHero').screenshot({ path: `${SHOTS}/tower-phone.png` });
  });

  test('a one-set vault gets a short one-layer tower', async ({ page }) => {
    await mockVault(page, [{ ...ITEMS[0], quantity: 1 }]);
    await page.goto('/#/');
    const tower = page.locator('#vaultHero .vault-tower');
    await expect(tower).toBeVisible();
    expect((await tower.boundingBox()).height).toBeLessThanOrEqual(24);
  });
});

test.describe('set page', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('history tab compares launch price, today and savings', async ({ page }) => {
    await page.goto('/#/set/75192-1');
    await page.locator('#tab-forecast').click();
    const card = page.locator('#whatIfCard');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Bought in 2017 for $850');
    await expect(card).toContainText('Savings, 3%/yr');
    await expect(card).toContainText('A savings account would have done better.');
    await card.screenshot({ path: `${SHOTS}/what-if-phone.png` });
  });

  test('a set without a launch price shows no What if card', async ({ page }) => {
    await page.route('**/api/sets/75192-1*', route => route.fulfill({ json: { set: { ...SET, retail_price: null }, entry: null } }));
    await page.goto('/#/set/75192-1');
    await page.locator('#tab-forecast').click();
    await expect(page.locator('#setSpark')).toBeAttached();
    await expect(page.locator('#whatIfCard')).toHaveCount(0);
  });
});

const QUESTS = { quests: [
  { theme: 'Modular Buildings', subtheme: 'Modular Buildings Collection', owned: 8, total: 14, missing: [
    { set_num: '10297-1', name: 'Boutique Hotel', year: 2022, image_url: null, retired: 1, value: 260 },
    { set_num: '10326-1', name: 'Natural History Museum', year: 2023, image_url: null, retired: 0, value: 300 },
  ] },
  { theme: 'Star Wars', subtheme: 'Ultimate Collector Series', owned: 2, total: 45, missing: [] },
] };

test.describe('quests', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Vault teases the closest quest and the quests page lists missing sets', async ({ page }) => {
    await page.route('**/api/quests', route => route.fulfill({ json: QUESTS }));
    await mockVault(page);
    await page.goto('/#/');
    const teaser = page.locator('#vaultQuest');
    await expect(teaser).toContainText('Modular Buildings Collection');
    await expect(teaser).toContainText('8/14');
    await expect(teaser).toContainText('Next: Boutique Hotel');
    await page.locator('.vault-aside').screenshot({ path: `${SHOTS}/quest-teaser-phone.png` });
    await teaser.click();
    await expect(page).toHaveURL(/#\/quests$/);
    await expect(page.locator('.bv-quest')).toHaveCount(2);
    await page.locator('.bv-quest__missing summary').first().click();
    await expect(page.locator('.bv-quest__set').first()).toContainText('Boutique Hotel');
    await page.screenshot({ path: `${SHOTS}/quests-phone.png` });
  });

  test('no quests: the Vault shows no teaser', async ({ page }) => {
    await page.route('**/api/quests', route => route.fulfill({ json: { quests: [] } }));
    await mockVault(page);
    await page.goto('/#/');
    await expect(page.locator('#heroValue')).toBeVisible();
    await expect(page.locator('#vaultQuest')).toHaveCount(0);
  });
});

test.describe('anniversary', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('an owned set on its purchase anniversary shows a banner with a share card', async ({ page }) => {
    const d = new Date();
    const bought = `${d.getUTCFullYear() - 3}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    await page.route('**/api/sets/75192-1*', route => route.fulfill({ json: { set: SET, entry: { id: 1, set_num: SET.set_num, quantity: 1, condition: 'sealed', purchase_price: 640, purchased_at: bought } } }));
    await page.goto('/#/set/75192-1');
    const banner = page.locator('#annivBanner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('3 years with Millennium Falcon');
    await expect(banner).toContainText('up $210');
    await banner.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
    await page.screenshot({ path: `${SHOTS}/anniversary-banner-phone.png` });
    const png = await page.evaluate(async () => {
      const { drawAnniversaryCard } = await import('/js/ui/anniversary.js');
      const c = drawAnniversaryCard(document.createElement('canvas'), { title: '3 years with Millennium Falcon! 🎂', sub: 'Bought for $640 — up $210 since.', value: 850, setNum: '75192-1' });
      return c.toDataURL('image/png');
    });
    const fs = await import('node:fs');
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(`${SHOTS}/anniversary-card.png`, Buffer.from(png.split(',')[1], 'base64'));
  });

  test('no banner on other days', async ({ page }) => {
    await page.route('**/api/sets/75192-1*', route => route.fulfill({ json: { set: SET, entry: { id: 1, set_num: SET.set_num, quantity: 1, condition: 'sealed', purchase_price: 640, purchased_at: '2001-01-01' === new Date().toISOString().slice(0, 10) ? '2001-01-02' : '2001-01-01' } } }));
    await page.goto('/#/set/75192-1');
    await expect(page.locator('#addBtn, #sellBtn').first()).toBeAttached();
    await expect(page.locator('#annivBanner')).toHaveCount(0);
  });
});

test.describe('desktop and dark', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('tower and quest card fit the desktop Vault aside', async ({ page }) => {
    await page.route('**/api/quests', route => route.fulfill({ json: QUESTS }));
    await mockVault(page);
    await page.goto('/#/');
    await expect(page.locator('#vaultQuest')).toBeVisible();
    const aside = await page.locator('.vault-aside').boundingBox();
    const tower = await page.locator('.vault-tower').boundingBox();
    expect(tower.x + tower.width).toBeLessThanOrEqual(aside.x + aside.width);
    await page.screenshot({ path: `${SHOTS}/vault-desktop.png` });
  });

  test('dark mode Vault hero and What if', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('bv_theme', 'dark'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/quests', route => route.fulfill({ json: QUESTS }));
    await mockVault(page);
    await page.goto('/#/');
    await expect(page.locator('#vaultQuest')).toBeVisible();
    await page.locator('.vault-aside').screenshot({ path: `${SHOTS}/vault-dark-phone.png` });
    await page.goto('/#/set/75192-1');
    await page.locator('#tab-forecast').click();
    await expect(page.locator('#whatIfCard')).toBeVisible();
    await page.locator('#whatIfCard').screenshot({ path: `${SHOTS}/what-if-dark-phone.png` });
  });

  test('320px phone keeps the hero row inside the card', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await mockVault(page);
    await page.goto('/#/');
    await expect(page.locator('.vault-tower')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const hero = await page.locator('#vaultHero').boundingBox();
    const tower = await page.locator('.vault-tower').boundingBox();
    expect(tower.x + tower.width).toBeLessThanOrEqual(hero.x + hero.width);
    await page.locator('#vaultHero').screenshot({ path: `${SHOTS}/tower-320.png` });
  });
});
