import { test, expect } from './fixtures.mjs';

// Reported on Android: leaving the AI Advisor did not land on the page it was
// opened from. The Advisor's back arrow stepped back twice (its own listener
// plus the app-wide one), skipping the previous page.
test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

function androidShell() {
  window.__back = null;
  const noop = () => Promise.resolve({ remove() {} });
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    Plugins: {
      App: {
        addListener: (name, fn) => { if (name === 'backButton') window.__back = fn; return noop(); },
        toggleBackButtonHandler: () => Promise.resolve(),
        minimizeApp: () => { window.__minimized = true; return Promise.resolve(); },
      },
    },
  };
}
const pressBack = (page) => page.evaluate(() => window.__back({ canGoBack: history.length > 1 }));

async function start(page) {
  await page.addInitScript(androidShell);
  await page.addInitScript(() => localStorage.setItem('bv_advisor', 'on'));
  await page.goto('/#/');
  await expect(page.locator('#vaultPage')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__back)).toBe('function');
}

async function scrollDown(page) {
  // Make every page tall enough to scroll, whatever the fixture data.
  await page.addStyleTag({ content: '#root { min-height: 4000px; }' });
  await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(400);
}

async function leave(page, how) {
  await expect(page).toHaveURL(/#\/advisor$/);
  await expect(page.locator('#advisorPage')).toBeVisible();
  if (how === 'arrow') await page.locator('#advisorPage [data-bv-back]').click();
  else await pressBack(page);
}

const ENTRIES = [
  {
    name: 'a set page',
    url: /#\/set\/75192-1$/,
    ready: '.bv-setpage',
    async open(page) {
      await page.evaluate(() => { location.hash = '#/add'; });
      await expect(page.locator('#discoverPage')).toBeVisible();
      await page.evaluate(() => { location.hash = '#/set/75192-1'; });
      await expect(page.locator('.bv-setpage')).toBeVisible();
    },
    openAdvisor: (page) => page.locator('[data-collector-advisor]').first().click(),
  },
  {
    name: 'the Vault',
    url: /#\/$/,
    ready: '#vaultPage',
    async open() {},
    openAdvisor: (page) => page.locator('#advisorFab').dispatchEvent('click'),
  },
  {
    name: 'Discover',
    url: /#\/add$/,
    ready: '#discoverPage',
    async open(page) {
      await page.locator('#nav [data-route="/add"]').click();
      await expect(page.locator('#discoverPage')).toBeVisible();
    },
    openAdvisor: (page) => page.evaluate(() => { location.hash = '#/advisor'; }),
  },
  {
    name: 'the Wishlist',
    url: /#\/wishlist$/,
    ready: '#wishlistPage',
    async open(page) {
      await page.locator('#nav [data-route="/wishlist"]').click();
      await expect(page.locator('#wishlistPage')).toBeVisible();
    },
    // The FAB tucks away while scrolling down; tap it where it sits.
    openAdvisor: (page) => page.locator('#advisorFab').dispatchEvent('click'),
  },
];

for (const entry of ENTRIES) {
  for (const how of ['arrow', 'android']) {
    test(`leaving the Advisor (${how}) returns to ${entry.name} at the same scroll`, async ({ page }) => {
      await start(page);
      await entry.open(page);
      await scrollDown(page);
      await entry.openAdvisor(page);
      await leave(page, how);
      await expect(page).toHaveURL(entry.url);
      await expect(page.locator(entry.ready)).toBeVisible();
      await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(400);
    });
  }
}

// The Leaderboard and public profiles had the same doubled back step.
test('the Leaderboard back arrow returns to the page it was opened from', async ({ page }) => {
  await start(page);
  await page.locator('#nav [data-route="/me"]').click();
  await expect(page.locator('#profilePage')).toBeVisible();
  await page.evaluate(() => { location.hash = '#/leaderboard'; });
  await expect(page.locator('.bv-lb [data-bv-back]')).toBeVisible();
  await page.locator('.bv-lb [data-bv-back]').click();
  await expect(page).toHaveURL(/#\/me$/);
  await expect(page.locator('#profilePage')).toBeVisible();
});
