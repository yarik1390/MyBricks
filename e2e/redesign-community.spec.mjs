import { test, expect } from './fixtures.mjs';

// Community & fun area of the 2026 redesign: the leaderboard and public
// profiles, contributions, Brick Wrapped, Price It!, the full-screen advisor
// and Kids Mode.

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const LEADERS = [
  ['brickbaron', 184210, 1420, 12.4], ['ucs_only', 96480, 212, 3.1], ['mocmaster', 71905, 610, 22.8],
].map(([handle, total_value, set_count, change_30d_pct], i) => ({ rank: i + 1, handle, display_name: handle, is_supporter: handle === 'ucs_only', set_count, total_value, change_30d_pct }));

async function stubMe(page, extra = {}) {
  await page.route('**/api/me', (route) => json(route, {
    display_name: 'Test Collector', handle: 'tester', currency: 'USD', is_guest: false, notify_price_drops: true,
    is_public: false, portfolio_stats: { set_count: 1, total_value: 850 }, ...extra,
  }));
}

test('leaderboard ranks by value, sets or 30-day rise and tells a private collector where they would land', async ({ page }) => {
  await stubMe(page);
  const asked = [];
  await page.route('**/api/users/leaderboard**', (route) => {
    const url = new URL(route.request().url());
    asked.push(url.search);
    const sort = url.searchParams.get('sort');
    const leaders = sort === 'rising' ? [...LEADERS].sort((a, b) => b.change_30d_pct - a.change_30d_pct).map((l, i) => ({ ...l, rank: i + 1 })) : LEADERS;
    return json(route, { leaders, total: 1203, sort, would_rank: url.searchParams.get('value') ? 214 : null });
  });
  await page.goto('/#/leaderboard', { waitUntil: 'domcontentloaded' });
  const rows = page.locator('.bv-lbrow');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('@brickbaron');
  await expect(rows.first()).toContainText('$184,210');
  // A private collector gets "where would I be" and a way to go public.
  await expect(page.locator('#lbJoinBar')).toContainText('You’d be #214 of 1,204');
  expect(asked[0]).toContain('value=850');

  await page.locator('[data-lb-sort="rising"]').click();
  await expect(rows.first()).toContainText('@mocmaster');
  await expect(rows.first().locator('.bv-delta')).toHaveText('+22.8%');
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/leaderboard?sort=rising');

  await page.locator('#lbGoPublic').click();
  await expect(page.locator('#publicProfileSheet')).toBeVisible();
  await expect(page.locator('#publicToggle')).toHaveAttribute('aria-checked', 'false');
});

test('a slow answer for the previous leaderboard tab never paints under the new one', async ({ page }) => {
  await stubMe(page);
  let releaseRising;
  const risingHeld = new Promise((resolve) => { releaseRising = resolve; });
  await page.route('**/api/users/leaderboard**', async (route) => {
    const sort = new URL(route.request().url()).searchParams.get('sort') || 'value';
    if (sort === 'rising') await risingHeld;
    const by = { sets: (a, b) => b.set_count - a.set_count, rising: (a, b) => b.change_30d_pct - a.change_30d_pct };
    const leaders = by[sort] ? [...LEADERS].sort(by[sort]).map((l, i) => ({ ...l, rank: i + 1 })) : LEADERS;
    return json(route, { leaders, total: 3, sort, would_rank: null });
  });
  await page.goto('/#/leaderboard', { waitUntil: 'domcontentloaded' });
  const rows = page.locator('.bv-lbrow');
  await expect(rows).toHaveCount(3);
  // Rising is still loading when the collector moves on to By sets.
  await page.locator('[data-lb-sort="rising"]').click();
  await page.locator('[data-lb-sort="sets"]').click();
  await expect(rows.nth(1)).toContainText('@mocmaster');
  await expect(rows.first()).toContainText('@brickbaron');

  releaseRising();
  // The rising answer lands in its own cache...
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).some((k) => k.endsWith(':rising')))).toBe(true);
  // ...while By sets keeps its own ranking (rising would put @mocmaster first).
  await expect(page.locator('[data-lb-sort="sets"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(rows.first()).toContainText('@brickbaron');
});

test('public profile shows what the owner exposes; the owner previews a private one', async ({ page }) => {
  const profile = {
    handle: 'brickbaron', display_name: 'Brick Baron', is_public: true, is_owner: false, is_supporter: true, approved_contributions: 3,
    expose_public_value: true, set_count: 6, piece_count: 26639, collecting_since: 2024, total_value: 2425,
    top_themes: [{ theme: 'Star Wars', value: 850 }, { theme: 'Icons', value: 850 }, { theme: 'Technic', value: 300 }],
    showcase: [{ set_num: '75192-1', name: 'Millennium Falcon', theme: 'Star Wars', current_value: 850, blended_value: 850 }],
  };
  await page.route('**/api/users/brickbaron/profile', (route) => json(route, profile));
  await page.goto('/#/u/brickbaron', { waitUntil: 'domcontentloaded' });
  const card = page.locator('.bv-pubcard');
  await expect(card).toContainText('Brick Baron');
  await expect(card).toContainText('Contributor · Pro · collecting since 2024');
  await expect(card).toContainText('$2,425');
  await expect(card).toContainText('26.6K');
  await expect(page.locator('.bv-trophy')).toHaveCount(1);
  await expect(page.locator('.bv-trophy--add')).toHaveCount(0);
  await expect(page.locator('.bv-themebar')).toHaveCount(3);
  await expect(page.locator('#pubPreviewBanner')).toHaveCount(0);

  // The owner asks with their session and sees a preview of a private profile.
  await stubMe(page);
  await page.route('**/api/users/tester/profile', (route) => {
    const signedIn = !!route.request().headers().authorization;
    return signedIn
      ? json(route, { ...profile, handle: 'tester', display_name: 'Test Collector', is_public: false, is_owner: true })
      : json(route, { error: 'Profile not found' }, 404);
  });
  await page.goto('/#/u/tester', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#pubPreviewBanner')).toContainText('Only you see this until you turn on Public profile.');
  await expect(page.locator('.bv-trophy--add')).toHaveCount(5);
  await expect(page.locator('#pubShare')).toHaveCount(0);

  await page.route('**/api/users/nobody-here/profile', (route) => json(route, { error: 'Profile not found' }, 404));
  await page.goto('/#/u/nobody-here', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Profile not found' })).toBeVisible();
});

test('contributions list status, filter pending and withdraw', async ({ page }) => {
  await stubMe(page);
  const deleted = [];
  await page.route('**/api/contributions/**', (route) => {
    const req = route.request();
    if (req.method() === 'DELETE') { deleted.push(new URL(req.url()).pathname); return json(route, { ok: true }); }
    return json(route, { approved_count: 12, submissions: [
      { type: 'photo', id: 4, set_num: '75192-1', set_name: 'Millennium Falcon', kind: null, status: 'approved', created_at: '2026-09-12 10:00:00', reviewed_at: '2026-09-14 10:00:00' },
      { type: 'data', id: 7, set_num: '10294-1', set_name: 'Titanic', kind: 'price', status: 'pending', created_at: '2026-09-20 10:00:00' },
      { type: 'data', id: 5, set_num: '10276-1', set_name: 'Colosseum', kind: 'barcode', status: 'rejected', review_note: 'duplicate of 10276', created_at: '2026-08-20 10:00:00' },
    ] });
  });
  await page.goto('/#/me/contributions', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.bv-contribsum')).toContainText('Contributor');
  await expect(page.locator('.bv-contribsum')).toContainText('3 more for the Gold badge');
  const rows = page.locator('.contrib-mine-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Photo · Millennium Falcon');
  await expect(rows.nth(2)).toContainText('Not added — duplicate of 10276');
  await expect(rows.nth(2)).toContainText('Declined');

  await page.locator('[data-cfilter="pending"]').click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Sale price · Titanic');
  await rows.first().getByRole('button', { name: 'Withdraw' }).click();
  await expect.poll(() => deleted).toEqual(['/api/contributions/data/7']);
  await expect(page.getByText('Nothing waiting for review.')).toBeVisible();
});

test('Brick Wrapped offers a retry instead of an empty story when the vault fails to load', async ({ page }) => {
  let fail = true;
  await page.route('**/api/collection', (route) => (fail && route.request().method() === 'GET'
    ? json(route, { error: 'unavailable' }, 503)
    : route.fallback()));
  await page.route('**/api/me/wrapped**', (route) => json(route, { year: 2026, sets_sold: 0, realized_gain: 0 }));
  await page.goto('/#/wrapped', { waitUntil: 'domcontentloaded' });
  const story = page.locator('#wrappedStory');
  await expect(story.getByRole('alert')).toContainText('Couldn’t load this');
  await expect(story).not.toContainText('getting started');
  await expect(page.locator('#wrShareStory')).toHaveCount(0);

  fail = false;
  await page.locator('#wrRetry').click();
  await expect(story.locator('.bv-wr__head')).toHaveText('You built a $850 vault.');
});

test('Brick Wrapped does not mistake a Vault that failed to load for an empty one', async ({ page }) => {
  await page.route('**/api/collection', (route) => (route.request().method() === 'GET'
    ? json(route, { error: 'unavailable' }, 503)
    : route.fallback()));
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(async () => (await import('/js/state.js')).state.portfolio?._loadFailed)).toBe(true);
  await page.goto('/#/wrapped', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#wrappedStory').getByRole('alert')).toContainText('Couldn’t load this');
  await expect(page.locator('#wrappedStory')).not.toContainText('getting started');
});

test('Brick Wrapped steps through the story and shares a real PNG', async ({ page }) => {
  await page.route('**/api/me/wrapped**', (route) => json(route, { year: 2026, sets_sold: 1, realized_gain: 48 }));
  await page.goto('/#/wrapped', { waitUntil: 'domcontentloaded' });
  const story = page.locator('#wrappedStory');
  await expect(story.locator('.bv-wr__head')).toHaveText('You built a $850 vault.');
  // Only the headline shows first; each tap reveals the next stat.
  await expect(story.locator('.bv-wr__stat:visible')).toHaveCount(0);
  await page.locator('#wrNext').click();
  await expect(story.locator('.bv-wr__stat:visible')).toHaveCount(1);
  await expect(story.locator('.bv-wr__stat').first()).toContainText('1 set');
  await page.keyboard.press('ArrowRight');
  await expect(story.locator('.bv-wr__stat:visible')).toHaveCount(2);
  // Best performer from what was paid: 850 vs 700 → +21%.
  await expect(story.locator('.bv-wr__stat').nth(1)).toContainText('+21%');
  await expect(story).toContainText('Realized from 1 sale');
  await expect(story.locator('.bv-wr__prog span.is-on')).toHaveCount(3);

  await page.evaluate(() => { navigator.canShare = () => false; });
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#wrShareStory').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('brick-wrapped-2026.png');
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(await download.path());
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  expect(bytes.readUInt32BE(16)).toBe(1080);
  expect(bytes.readUInt32BE(20)).toBe(1920);
});

test('Price It! steps the guess, locks it in once and colours the round', async ({ page }) => {
  await page.addInitScript(() => { localStorage.removeItem('bv_game_result'); });
  const guesses = [];
  await page.route('**/api/game/**', (route) => {
    const req = route.request();
    if (req.url().includes('/daily')) return json(route, { day: '2026-09-25', rounds: [
      { set_num: '10307-1', name: 'Eiffel Tower', theme: 'Icons', year: 2022, pieces: 10001, retail_price: 629.99, image_url: null },
      { set_num: '10294-1', name: 'Titanic', theme: 'Icons', year: 2021, pieces: 9090, retail_price: 679.99, image_url: null },
    ] });
    guesses.push(JSON.parse(req.postData() || '{}'));
    return json(route, { correct: true, actual: 700, pct_off: 0 });
  });
  await page.goto('/#/game', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.bv-topbar__sub')).toHaveText('Daily challenge · round 1 of 2');
  const input = page.locator('#gameGuess');
  await expect(input).toHaveValue('630');
  await page.locator('.bv-game__steps [data-step="50"]').click();
  await page.locator('.bv-game__steps [data-step="10"]').click();
  await expect(input).toHaveValue('690');
  await page.locator('#gameLock').dblclick();
  await expect(page.locator('.bv-game__verdict.is-right')).toContainText('$700');
  expect(guesses).toEqual([{ set_num: '10307-1', guess: 690 }]);
  await expect(page.locator('.bv-game__prog span.is-right')).toHaveCount(1);
  await page.locator('#gameNext').click();
  await expect(page.locator('.bv-topbar__sub')).toHaveText('Daily challenge · round 2 of 2');
});

test('the advisor is a full-screen page: old entry points open it and answers stay XSS-safe', async ({ page }) => {
  await page.addInitScript(() => { localStorage.removeItem('bv_chat'); });
  await page.route('**/api/advisor', (route) => route.fulfill({
    status: 200, contentType: 'text/event-stream',
    body: `data: ${JSON.stringify({ text: "I'd **hold**. <img src=x onerror=\"window.__pwned=1\">" })}\n\ndata: {"done":true}\n\n`,
  }));
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => { const { toggleAdvisor } = await import('/js/components/advisor-lazy.js'); await toggleAdvisor(); });
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/advisor');
  await expect(page.locator('#advHealth')).toContainText('Portfolio health');
  await expect(page.locator('.bv-topbar__sub')).toHaveText('Uses your vault · cloud AI');

  await page.locator('[data-prompt="bvCommunity.advPromptSell"]').click();
  const answer = page.locator('.chat-msg.ai').last();
  await expect(answer.locator('strong')).toHaveText('hold');
  await expect(page.locator('.chat-msg.ai img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  await expect(page.locator('.chat-msg.user').last()).toHaveText('What should I sell this month?');

  // Clearing lives in the options sheet.
  await page.locator('#advMenu').click();
  await page.locator('#clearChat').click();
  await expect(page.locator('.chat-msg.user')).toHaveCount(0);
});

test('Kids Mode home is price-free with a big scan button and the badge row', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('bv_mode', 'kids'));
  await page.route('**/api/me', (route) => json(route, { display_name: 'Kid', handle: null, currency: 'USD', is_guest: false, kids_xp: 30, kids_badges: ['first_brick'], has_kids_pin: true, portfolio_stats: { set_count: 1 } }));
  await page.goto('/#/kids', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.bv-kids__level')).toHaveText('Level 2 builder');
  await expect(page.locator('#kidsScan')).toHaveAttribute('href', '#/pile');
  await expect(page.locator('.bv-kids__tile')).toHaveCount(1);
  await expect(page.locator('.bv-kids')).not.toContainText('$');
  await expect(page.locator('.bv-kids__badges')).toContainText('My badges · 1 of 6');
  const box = await page.locator('#kidsScan').boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(72);

  await page.locator('#exitKidsBtn').click();
  await expect(page.locator('#exitPinInput')).toBeVisible();
});
