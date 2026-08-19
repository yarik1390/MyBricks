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
    { provider: 'merge', model: 'openai/gpt-4o-mini', enabled: true },
    { provider: 'openai', model: 'gpt-4o-mini', enabled: false },
  ],
  advisor: [
    { provider: 'gemini', model: 'gemini-2.5-flash-lite', enabled: true },
    { provider: 'merge', model: 'openai/gpt-5.6-luna', enabled: true },
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
          scan: [{ provider: 'gemini', model: 'gemini-2.5-flash' }, { provider: 'merge', model: 'openai/gpt-4o-mini' }],
          advisor: [{ provider: 'gemini', model: 'gemini-2.5-flash-lite' }],
          valuation: [{ provider: 'gemini', model: 'gemini-2.5-flash-lite' }],
          listing: [{ provider: 'gemini', model: 'gemini-2.5-flash-lite' }],
        },
        workloads: ['scan', 'advisor', 'valuation', 'listing'],
        providers: [
          { name: 'gemini', configured: true }, { name: 'merge', configured: true },
          { name: 'openrouter', configured: true }, { name: 'openai', configured: false },
        ],
        models: {
          merge: ['openai/gpt-5.6-luna', 'openai/gpt-4o-mini', 'z-ai/glm-5.2'],
          openrouter_vision: ['google/gemma-4-31b-it:free'],
          openrouter_text: ['meta-llama/llama-3.3-70b-instruct:free'],
          gemini: ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
          openai: ['gpt-4o-mini'],
        },
      }),
    });
  });
  await page.route('**/api/admin/llm-status', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        merge: {
          configured: true, month: '2026-08', budget_usd: 10, spent_usd: 2.5,
          remaining_usd: 7.5, pct: 25, calls: 42, status: 'ok',
        },
        spend_by_provider: [],
      }),
    });
  });
}

test('LLM routing console is reachable and its controls render', async ({ page }) => {
  await stubAdmin(page);
  await page.goto('/#/me/admin');

  const tab = page.locator('[data-admin-section-link="adminLlm"]');
  await expect(tab).toBeVisible();
  await tab.click();

  const section = page.locator('#adminLlm');
  await expect(section).toHaveClass(/is-active/);

  // The allowance meter states both numbers so "remaining" cannot be misread.
  await expect(section.getByText('$7.50')).toBeVisible();

  // Model choice must be a real dropdown, not a bare text box.
  const firstSelect = section.locator('select.llm-step-model').first();
  await expect(firstSelect).toBeVisible();
  await expect(firstSelect).toHaveValue('gemini-2.5-flash');

  // Every workload gets its own cascade.
  await expect(section.locator('.llm-workload')).toHaveCount(4);
  await expect(section.locator('.llm-step')).toHaveCount(8);

  // A provider with no key is flagged rather than silently ignored.
  await expect(section.locator('.llm-step.is-unconfigured').first()).toBeVisible();
});

test('choosing Custom reveals a free-text model field', async ({ page }) => {
  await stubAdmin(page);
  await page.goto('/#/me/admin');
  await page.locator('[data-admin-section-link="adminLlm"]').click();

  const section = page.locator('#adminLlm');
  await expect(section.locator('.llm-step-custom')).toHaveCount(0);
  await section.locator('select.llm-step-model').first().selectOption('__custom__');
  // Merge serves no catalogue on this plan, so an arbitrary id must stay
  // reachable or its route could never be changed.
  await expect(section.locator('.llm-step-custom').first()).toBeVisible();
});

test('editing the order surfaces a save bar', async ({ page }) => {
  await stubAdmin(page);
  await page.goto('/#/me/admin');
  await page.locator('[data-admin-section-link="adminLlm"]').click();

  const section = page.locator('#adminLlm');
  await expect(section.locator('.llm-savebar')).toHaveCount(0);
  await section.locator('[data-llm-move="down"]').first().click();
  await expect(section.locator('.llm-savebar')).toBeVisible();
});
