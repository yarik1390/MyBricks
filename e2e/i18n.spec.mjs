import { test, expect } from './fixtures.mjs';
test.use({ locale: 'de-DE' });
test('device locale drives the UI language', async ({ page }) => {
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#nav .nav-tab[data-route="/"] .nav-label')).toHaveText('Tresor');
  await expect(page.locator('#nav .nav-tab[data-route="/add"] .nav-label')).toHaveText('Katalog');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('de');
});

// Regression: text patched in by morphdom must be translated WITHOUT a reload.
//
// mount() renders through morphdom, which reuses the existing element and
// rewrites its text node in place. That produces a characterData mutation and
// no childList mutation at all, so an observer watching only childList never
// saw it: the catalog's "Coming Soon" strip, result counts and wishlist buttons
// stayed English after a filter change and only appeared translated once a full
// page reload rebuilt the tree. Asserting on the dictionary is not enough here —
// the key existed the whole time; it was the delivery that was broken.
test.describe(() => {
  test.use({ locale: 'uk-UA' });
  test('morphdom-patched text is translated without a reload', async ({ page }) => {
    await page.goto('/#/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#nav .nav-tab[data-route="/"] .nav-label')).toHaveText('Сховище');

    const text = await page.evaluate(async () => {
      const { mount } = await import('/js/utils.js');
      const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const host = document.createElement('div');
      // Seed with text that is NOT in the dictionary, so the first (childList)
      // pass changes nothing and the assertion can only be satisfied by the
      // characterData path.
      host.innerHTML = '<p>zzz-not-a-ui-string</p>';
      document.body.appendChild(host);
      await frame();
      mount(host, '<p>Coming Soon</p>');
      await frame();
      const out = host.querySelector('p').textContent;
      host.remove();
      return out;
    });
    expect(text).toBe('Незабаром');
  });
});

// The first-run wizard has to be escapable from a language you cannot read.
// Device locale is the default and is right for most people, but someone on a
// shared or second-hand phone was stuck: the only language control lived in
// Settings, which they had to navigate to in a language they could not read.
test('onboarding language picker switches the wizard live', async ({ page }) => {
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const { showSetup } = await import('/js/components/onboarding.js');
    showSetup();
  });
  // The device is de-DE (test.use at the top of this file), so the wizard opens
  // in German — that is the situation being escaped from.
  const welcome = page.locator('.bv-setup-body h3');
  await expect(welcome).toHaveText('Willkommen bei BricksVault');

  await page.locator('.bv-lang[data-lang="uk"]').click();
  await expect(welcome).toHaveText('Ласкаво просимо в BricksVault');
  // The language's own name stays in its own language, or the picker is
  // unusable for the person who needs it.
  await expect(page.locator('.bv-lang[data-lang="de"]')).toHaveText('Deutsch');
  await expect(page.locator('.bv-lang[data-lang="uk"]')).toHaveClass(/sel/);

  await page.locator('.bv-lang[data-lang="en"]').click();
  await expect(welcome).toHaveText('Welcome to BricksVault');
});

// Non-Latin scripts and the newly added languages — a catalogue that parses is
// not the same as one that reaches the screen.
for (const [locale, code, vault, catalog] of [
  ['uk-UA', 'uk', 'Сховище', 'Каталог'],
  ['zh-CN', 'zh', '收藏库', '目录'],
  ['ja-JP', 'ja', 'コレクション', 'カタログ'],
  ['hi-IN', 'hi', 'संग्रह', 'कैटलॉग'],
]) {
  test.describe(() => {
    test.use({ locale });
    test(`renders ${code} from the device locale`, async ({ page }) => {
      await page.goto('/#/', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#nav .nav-tab[data-route="/"] .nav-label')).toHaveText(vault);
      await expect(page.locator('#nav .nav-tab[data-route="/add"] .nav-label')).toHaveText(catalog);
      expect(await page.evaluate(() => document.documentElement.lang)).toBe(code);
    });
  });
}
