// Visual check for the LLM routing console.
//
// It exists because this section shipped once with its markup rendering into a
// DOM node that no tab could ever activate — invisible in production, green in
// every other test. A test that actually opens the tab and asserts the controls
// are there is the cheapest guard against repeating that.
import { test, expect } from './fixtures.mjs';

const ROUTES = {
  scan: [
    { provider: 'gemini', model: 'gemini-2.5-flash', enabled: true },
    { provider: 'openrouter', model: '', enabled: true },
    { provider: 'groq', model: 'qwen/qwen3.8-27b', enabled: true },
    { provider: 'openai', model: 'gpt-4o-mini', enabled: false },
  ],
  advisor: [
    { provider: 'gemini', model: 'gemini-2.5-flash-lite', enabled: true },
    { provider: 'workersai', model: '@cf/google/gemma-4-26b-a4b-it', enabled: true },
  ],
  valuation: [{ provider: 'gemini', model: 'gemini-2.5-flash-lite', enabled: true }],
  listing: [{ provider: 'gemini', model: 'gemini-2.5-flash-lite', enabled: true }],
};

async function stubAdmin(page) {
  // The fixture profile is deliberately non-admin (another test asserts the
  // bounce), so grant admin only for this spec.
  await page.route('**/api/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        display_name: 'Test Collector', handle: 'tester', currency: 'USD',
        is_guest: false, is_admin: true, portfolio_stats: {},
      }),
    });
  });
  await page.route('**/api/admin/llm-routing', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        routes: ROUTES,
        defaults: ROUTES,
        effective: {
          scan: [{ provider: 'gemini', model: 'gemini-2.5-flash' }, { provider: 'groq', model: 'qwen/qwen3.8-27b' }],
          advisor: [{ provider: 'gemini', model: 'gemini-2.5-flash-lite' }],
          valuation: [{ provider: 'gemini', model: 'gemini-2.5-flash-lite' }],
          listing: [{ provider: 'gemini', model: 'gemini-2.5-flash-lite' }],
        },
        workloads: ['scan', 'advisor', 'valuation', 'listing'],
        providers: [
          { name: 'gemini', configured: true }, { name: 'groq', configured: true },
          { name: 'workersai', configured: true },
          { name: 'openrouter', configured: true }, { name: 'openai', configured: false },
        ],
        models: {
          groq: ['qwen/qwen3.8-27b'],
          workersai: ['@cf/google/gemma-4-26b-a4b-it'],
          openrouter_vision: ['google/gemma-4-31b-it:free'],
          openrouter_text: ['meta-llama/llama-3.3-70b-instruct:free'],
          gemini: ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
          openai: ['gpt-4o-mini'],
        },
      }),
    });
  });
}

test('LLM routing console is reachable and its controls render', async ({ page }) => {
  await stubAdmin(page);
  await page.goto('/#/me/admin');

  const tab = page.locator('[data-admin-section-link="adminServices"]');
  await expect(tab).toBeVisible();
  await tab.click();

  const section = page.locator('#adminServices');
  await section.locator('#adminAiRoutingFold > summary').click();
  await expect(section).toHaveClass(/is-active/);

  // Merge Gateway was removed (2026-11-08): no allowance card, no Merge rows.
  await expect(section.locator('.llm-balance')).toHaveCount(0);
  await expect(section.getByText(/Merge/)).toHaveCount(0);

  // Model choice is a button that opens the app's bottom sheet — a native
  // <select> renders as an Android system spinner outside the page and did not
  // work reliably on device.
  const firstPick = section.locator('.llm-model-btn').first();
  await expect(firstPick).toBeVisible();
  await expect(firstPick).toContainText('gemini-2.5-flash');

  // Every workload gets its own cascade.
  await expect(section.locator('.llm-workload')).toHaveCount(4);
  await expect(section.locator('.llm-step')).toHaveCount(8);

  // A provider with no key is flagged rather than silently ignored.
  await expect(section.locator('.llm-step.is-unconfigured').first()).toBeVisible();
});

test('the model picker opens a sheet and applies a choice', async ({ page }) => {
  await stubAdmin(page);
  await page.goto('/#/me/admin');
  await page.locator('[data-admin-section-link="adminServices"]').click();

  const section = page.locator('#adminServices');
  await section.locator('#adminAiRoutingFold > summary').click();
  await section.locator('.llm-model-btn').first().click();
  const list = page.locator('.llm-pick-list');
  await expect(list).toBeVisible();
  // The custom escape hatch must be present so a route can name a model the
  // suggestion list does not carry.
  await expect(list.getByText('Custom model ID…')).toBeVisible();

  await list.locator('[data-pick-value="gemini-3.6-flash"]').click();
  await expect(section.locator('.llm-model-btn').first()).toContainText('gemini-3.6-flash');
  await expect(section.locator('.llm-savebar')).toBeVisible();
});

test('editing the order surfaces a save bar', async ({ page }) => {
  await stubAdmin(page);
  await page.goto('/#/me/admin');
  await page.locator('[data-admin-section-link="adminServices"]').click();

  const section = page.locator('#adminServices');
  await section.locator('#adminAiRoutingFold > summary').click();
  await expect(section.locator('.llm-savebar')).toHaveCount(0);
  await section.locator('[data-llm-move="down"]').first().click();
  await expect(section.locator('.llm-savebar')).toBeVisible();
});
