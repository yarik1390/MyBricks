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
  await expect(page.locator('#suLangs')).toHaveAttribute('aria-label', 'Мова');
  // The language's own name stays in its own language, or the picker is
  // unusable for the person who needs it.
  await expect(page.locator('.bv-lang[data-lang="de"]')).toHaveText('Deutsch');
  await expect(page.locator('.bv-lang[data-lang="uk"]')).toHaveClass(/sel/);
  await expect(page.locator('.bv-lang[data-lang="uk"]')).toBeFocused();

  await page.locator('.bv-lang[data-lang="en"]').click();
  await expect(welcome).toHaveText('Welcome to BricksVault');
});

test('Settings switches uk to de to en without retaining stale exact-match copy', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('bv.lang', 'uk'));
  await page.goto('/#/me', { waitUntil: 'domcontentloaded' });
  const vault = page.locator('#nav .nav-tab[data-route="/"]');
  const language = page.locator('#languageSelect');
  await expect(language).toHaveAttribute('aria-label', 'Мова');
  await expect(vault).toHaveAttribute('aria-label', 'Сховище');
  await expect(page.locator('.setting-row .lbl').filter({ hasText: 'Мова' }).first()).toBeVisible();

  await language.selectOption('de');
  await expect(language).toHaveAttribute('aria-label', 'Sprache');
  await expect(vault).toHaveAttribute('aria-label', 'Tresor');
  await expect(page.locator('#root')).not.toContainText('Налаштування');
  await expect(page.locator('#root')).toContainText('Einstellungen');

  await language.selectOption('en');
  await expect(language).toHaveAttribute('aria-label', 'Language');
  await expect(vault).toHaveAttribute('aria-label', 'Vault');
  await expect(page.locator('#root')).not.toContainText('Sprache');
  await expect(page.locator('#root')).toContainText('Language');
});

test('latest locale selection wins when an earlier locale module is delayed', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('bv.lang', 'en'));
  await page.route('**/js/locales/de.js', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 180));
    await route.continue();
  });
  await page.goto('/#/me', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async () => {
    const { setLocale, getLocale, applyUiDictionary } = await import('/js/lib/i18n.js');
    const older = setLocale('de');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const newer = setLocale('uk');
    await Promise.all([older, newer]);
    await applyUiDictionary();
    return { locale: getLocale(), stored: localStorage.getItem('bv.lang'), lang: document.documentElement.lang };
  });
  expect(result).toEqual({ locale: 'uk', stored: 'uk', lang: 'uk' });
  await expect(page.locator('#nav .nav-tab[data-route="/"]')).toHaveAttribute('aria-label', 'Сховище');
});

test.describe(() => {
  test.use({ locale: 'uk-UA' });

  test('translates root and dynamically changed user-facing attributes', async ({ page }) => {
    await page.goto('/#/', { waitUntil: 'domcontentloaded' });
    const values = await page.evaluate(async () => {
      const { setLocale, applyUiDictionary, translateDOM } = await import('/js/lib/i18n.js');
      await setLocale('uk');
      await applyUiDictionary();
      const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const root = document.createElement('input');
      root.setAttribute('placeholder', 'Language');
      root.setAttribute('aria-label', 'Language');
      root.setAttribute('title', 'Language');
      document.body.appendChild(root);
      const rootHits = translateDOM(root);
      root.setAttribute('placeholder', 'Language');
      root.setAttribute('aria-label', 'Language');
      root.setAttribute('title', 'Language');
      await frame();
      const result = {
        rootHits,
        placeholder: root.getAttribute('placeholder'),
        ariaLabel: root.getAttribute('aria-label'),
        title: root.getAttribute('title'),
      };
      root.remove();
      return result;
    });
    expect(values.rootHits).toBe(3);
    expect(values).toMatchObject({ placeholder: 'Мова', ariaLabel: 'Мова', title: 'Мова' });
  });

  test('uses parameterized Ukrainian grammar for dynamic UI branches', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('bv_gemma_dl', JSON.stringify({
        url: 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.task',
        totalBytes: 1000,
        loadedBytes: 420,
        complete: false,
      }));
    });
    await page.goto('/#/me/integrations', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#gemmaModelDesc')).toContainText('Завантаження перервано на 42%');
    await expect(page.locator('#downloadGemmaBtn')).toHaveText('Продовжити (42%)');

    const messages = await page.evaluate(async () => {
      const { t, tPlural, setLocale } = await import('/js/lib/i18n.js');
      await setLocale('uk');
      return {
        pending: [1, 3, 5, 21].map((n) => tPlural('community.pendingSubmission', n)),
        approved: [1, 3, 5, 21].map((n) => tPlural('contributions.approved', n)),
        running: [1, 2, 5, 21].map((n) => tPlural('admin.countRunning', n)),
        figures: [1, 2, 5, 21].map((n) => tPlural('admin.figures', n)),
        filters: t('catalog.filtersWithCount', { n: 2 }),
        upload: t('admin.uploadingFile', { file: 'figs.tsv' }),
        scan: t('downloads.scanProgress', { current: 2, total: 4 }),
      };
    });
    expect(messages).toEqual({
      pending: [
        '⏳ У вас 1 заявка очікує схвалення.',
        '⏳ У вас 3 заявки очікують схвалення.',
        '⏳ У вас 5 заявок очікують схвалення.',
        '⏳ У вас 21 заявка очікує схвалення.',
      ],
      approved: ['1 схвалений внесок', '3 схвалені внески', '5 схвалених внесків', '21 схвалений внесок'],
      running: ['1 виконується', '2 виконуються', '5 виконуються', '21 виконується'],
      figures: ['1 мініфігурка', '2 мініфігурки', '5 мініфігурок', '21 мініфігурка'],
      filters: 'Фільтри · 2',
      upload: 'Завантаження figs.tsv…',
      scan: 'Розпізнавання 2 з 4…',
    });
  });

  test('renders the Ukrainian few-form in the live contributions summary', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/me') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ display_name: 'Test', handle: 'test', currency: 'USD', is_guest: false, portfolio_stats: {} }) });
      if (path === '/api/contributions/mine') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ approved_count: 3, submissions: [] }) });
      return route.fallback();
    });
    await page.goto('/#/me/contributions', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#contribMineBody .u-mute').first()).toHaveText('3 схвалені внески');
  });

  test('uses localized relative time in the live admin activity row', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (path === '/api/me') return json({ display_name: 'Admin', handle: 'admin', currency: 'USD', is_guest: false, is_admin: true, portfolio_stats: {} });
      if (path === '/api/admin/activity') return json({ group_order: ['Catalog'], processes: [{ name: 'catalog', group: 'Catalog', label: 'Catalog', description: 'Refresh catalog', status: 'ok', finished_at: new Date(Date.now() - 120000).toISOString() }] });
      if (path === '/api/admin/import-status') return json({ runs: [] });
      if (path === '/api/admin/integrations') return json({ integrations: [], coverage: {} });
      if (path === '/api/admin/feature-flags') return json({ flags: [], overrides: {}, effective: {} });
      return route.fallback();
    });
    await page.goto('/#/me/admin', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-admin-section-link="adminJobs"]').evaluate((button) => button.click());
    await expect(page.locator('.admin-process-meta')).toContainText('останній запуск');
    await expect(page.locator('.admin-process-meta')).toContainText('хв');
  });

  test('renders driven Brickset failure and admin success through locale keys', async ({ page }) => {
    await page.route('**/api/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ display_name: 'Admin', handle: 'admin', currency: 'USD', is_guest: false, is_admin: true, brickset_connected: true, portfolio_stats: {} }) }));
    await page.route('**/api/brickset/sync', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'network boom' }) }));
    await page.goto('/#/me/integrations', { waitUntil: 'domcontentloaded' });
    await page.locator('#bricksetSyncBtn').click();
    await expect(page.locator('#bricksetSyncResult')).toContainText('Не вдалося синхронізувати Brickset: network boom');

    await page.route('**/api/admin/populate-everything', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ run_id: 42, done: true }) }));
    await page.goto('/#/me/admin', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-admin-section-link="adminPopulate"]').click();
    await page.locator('[data-admin-tool="everything"]').click();
    await expect(page.locator('#toast')).toContainText('Завдання #42 запущено');
  });

  test('photo picker stays keyboard reachable and shows focus on its styled control', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('bv_setup_v1', '1'));
    await page.goto('/#/', { waitUntil: 'domcontentloaded' });
    // Let the asynchronous route mount finish before opening an external sheet;
    // otherwise that first route paint can immediately reset the overlay.
    await expect(page.locator('#root .page')).toBeVisible();
    await page.waitForTimeout(1200);
    await page.evaluate(async () => {
      const { openPhotoSheet } = await import('/js/components/contribute.js');
      openPhotoSheet('75192-1');
    });
    const file = page.locator('#phFile');
    const control = page.locator('button.csv-file-label');
    // The styled control is the single keyboard stop; it delegates activation
    // to its transparent native input without creating a duplicate tab stop.
    const caption = page.locator('#phCaption');
    await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'false');
    await caption.focus();
    await expect(caption).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(control).toBeFocused();
    await expect(control).toHaveCSS('outline-style', 'solid');
    await page.evaluate(() => {
      window.__photoPickerNativeClick = false;
      const input = document.getElementById('phFile');
      input.addEventListener('click', (event) => {
        event.preventDefault();
        window.__photoPickerNativeClick = true;
      }, { once: true });
    });
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => window.__photoPickerNativeClick)).toBe(true);
    const closing = await page.evaluate(async () => {
      const { hideSheet } = await import('/js/components/sheet.js');
      hideSheet();
      const sheet = document.getElementById('sheet');
      return {
        ariaHidden: sheet.getAttribute('aria-hidden'),
        closing: sheet.classList.contains('closing'),
        visibility: getComputedStyle(sheet).visibility,
      };
    });
    expect(closing).toEqual({ ariaHidden: 'true', closing: true, visibility: 'visible' });
    await page.waitForTimeout(380);
    await expect(page.locator('#sheet')).toHaveCSS('visibility', 'hidden');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(async () => {
      const { openPhotoSheet } = await import('/js/components/contribute.js');
      const { hideSheet } = await import('/js/components/sheet.js');
      openPhotoSheet('75192-1');
      hideSheet();
    });
    await page.waitForTimeout(30);
    await expect(page.locator('#sheet')).toHaveCSS('visibility', 'hidden');
  });

  test('translates the downloadable Advisor model status', async ({ page }) => {
    await page.addInitScript(() => {
      self.LanguageModel = { availability: async () => 'downloadable' };
    });
    await page.goto('/#/me/integrations', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#chromeAiStatus')).toContainText(
      'Модель потрібно завантажити. Виконайте запит на вкладці «Радник», щоб почати завантаження.',
    );
  });

  test('uses localized Google OAuth setup guidance instead of Worker prose', async ({ page }) => {
    await page.goto('/#/me/integrations', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Google Sheets вимкнено, доки не налаштовано OAuth.')).toBeVisible();
    await expect(page.getByText('Відсутні секрети Worker:')).toBeVisible();
    await expect(page.getByText('Додайте їх як секрети GitHub Actions і повторно розгорніть застосунок, щоб увімкнути прив’язку облікового запису.')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET as GitHub Actions secrets');
  });

  test('translates lowercase alternate-build labels after switching modes', async ({ page }) => {
    await page.goto('/#/build', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-mode="alts"]').click();
    await expect(page.locator('.b-tiles .b-l').first()).toHaveText('альтернативні моделі');
  });

  test('translates Chrome AI checking and ready states', async ({ page }) => {
    await page.addInitScript(() => {
      self.LanguageModel = {
        availability: () => new Promise((resolve) => { self.__resolveChromeAiAvailability = resolve; }),
      };
    });
    await page.goto('/#/me/integrations', { waitUntil: 'domcontentloaded' });
    const status = page.locator('#chromeAiStatus');
    await expect(status).toHaveText('Перевірка сумісності...');
    await expect.poll(() => page.evaluate(() => typeof self.__resolveChromeAiAvailability)).toBe('function');
    await page.evaluate(() => self.__resolveChromeAiAvailability('available'));
    await expect(status).toContainText('Готово до офлайн-порад.');
  });

  test('translates configured admin health states', async ({ page }) => {
    // Fall through to the shared fixture for unrelated endpoints. A single
    // broad route avoids the fixture's catch-all handler swallowing one of
    // the three admin responses before this test can drive the real branch.
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (path === '/api/me') return json({ display_name: 'Test Collector', handle: 'tester', currency: 'USD', is_guest: false, is_admin: true, portfolio_stats: {} });
      if (path === '/api/admin/integrations') return json({
        integrations: [{ service: 'ebay', configured: true, status: 'ok', last_ok_at: null, last_fail_at: null }],
        coverage: { sets_with_ebay_new: 1, sets_with_ebay_ask: 1 },
      });
      if (path === '/api/admin/feature-flags') return json({ flags: [], overrides: { ebay_sold_comps: true }, effective: { ebay_sold_comps: false } });
      return route.fallback();
    });
    await page.goto('/#/me/admin', { waitUntil: 'commit' });
    await expect(page.getByText('Консоль адміністратора')).toBeVisible();
    await page.locator('[data-service-tab="Pricing"]').evaluate((button) => button.click());
    await page.locator('details[data-svc="ebay"] > summary').evaluate((summary) => summary.click());
    await expect(page.getByText('потрібен ключ')).toBeVisible();
    await expect(page.getByText('дані запитуваних цін доступні')).toBeVisible();
  });

  test('admin uploader has one visible keyboard control and delegates to its file input', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      if (new URL(route.request().url()).pathname === '/api/me') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ display_name: 'Test Collector', handle: 'tester', currency: 'USD', is_guest: false, is_admin: true, portfolio_stats: {} }) });
      }
      return route.fallback();
    });
    await page.goto('/#/me/admin', { waitUntil: 'commit' });
    await page.locator('[data-admin-section-link="adminPopulate"]').evaluate((button) => button.click());
    const control = page.locator('[data-file-input="blMinifigFile"]');
    const input = page.locator('#blMinifigFile');
    await expect(control).toBeVisible();
    await expect(input).toBeVisible();
    await control.focus();
    await expect(control).toBeFocused();
    await expect(control).toHaveCSS('outline-style', 'solid');
    await page.evaluate(() => {
      window.__adminPickerNativeClick = false;
      document.getElementById('blMinifigFile').addEventListener('click', (event) => {
        event.preventDefault();
        window.__adminPickerNativeClick = true;
      }, { once: true });
    });
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => window.__adminPickerNativeClick)).toBe(true);
  });

  test('uses a literal ampersand in text-only toasts', async ({ page }) => {
    await page.goto('/#/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      const { toast } = await import('/js/utils.js');
      toast('Unlock Premium & Gold by supporting BricksVault ★', 'info');
    });
    await expect(page.locator('#toast')).toContainText('Відкрийте Преміум і Золотий вигляд, підтримавши BricksVault ★');
    await expect(page.locator('#toast')).not.toContainText('&amp;');
  });

  test('translates methodology loading and earned-badge conditional states', async ({ page }) => {
    await page.route('**/methodology.html', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({ path: 'public/methodology.html' });
    });
    await page.goto('/#/me', { waitUntil: 'domcontentloaded' });
    await page.locator('a[href="/methodology.html"]').click();
    await expect(page.getByText('Завантаження методології ціноутворення...')).toBeVisible();

    await page.route('**/api/me', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ display_name: 'Test Collector', handle: 'tester', currency: 'USD', is_guest: false, kids_xp: 10, kids_badges: ['first_brick'], portfolio_stats: {} }),
    }));
    await page.evaluate(async () => {
      const { state } = await import('/js/state.js');
      state.me = null;
    });
    await page.goto('/#/kids/badges', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('✓ Отримано!')).toBeVisible();
  });
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
