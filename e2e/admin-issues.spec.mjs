import { test, expect } from './fixtures.mjs';

const adminProfile = {
  display_name: 'Admin', handle: 'admin', currency: 'USD', is_guest: false,
  is_admin: true, notify_price_drops: true, portfolio_stats: {},
};

function diagnostic(overrides) {
  return {
    service: 'bricklink',
    label: 'BrickLink',
    configured: true,
    reachable: true,
    degraded: false,
    status: 'ok',
    used_by: ['market pricing'],
    required_secrets: ['BRICKLINK_CONSUMER_KEY'],
    missing_secrets: [],
    notes: 'Primary market source.',
    recommended_action: 'No action required.',
    last_checked_at: new Date().toISOString(),
    last_ok_at: new Date().toISOString(),
    last_fail_at: null,
    last_error: null,
    ok_count: 12,
    fail_count: 0,
    ...overrides,
  };
}

async function mockAdmin(page, { integrations, integrationStatus = 200, flags = {} }) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'WORKER_BASE', { configurable: true, get: () => '', set: () => {} });
  });
  await page.unrouteAll();
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (body, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-allow-methods': 'GET, OPTIONS',
      },
      body: JSON.stringify(body),
    });
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'authorization, content-type',
          'access-control-allow-methods': 'GET, OPTIONS',
        },
      });
    }
    if (path.includes('/admin/integrations')) {
      return json(integrationStatus === 200
        ? { integrations, coverage: {}, quota: [], ai_usage: {}, firecrawl: {}, brightdata: {}, pricecharting_ext: {}, amazon: {}, api_routing: {} }
        : { error: 'diagnostics backend failed' }, integrationStatus);
    }
    if (path.includes('/admin/feature-flags')) {
      return json({ flags: Object.keys(flags), overrides: {}, effective: flags });
    }
    if (path.includes('/admin/source-config')) return json({ config: { brickpicker: { enabled: false }, brickowl: { enabled: false }, bricklink: { enabled: true } } });
    if (path.endsWith('/api/me')) return json(adminProfile);
    if (path.startsWith('/api/')) return json({});
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue();
    return route.abort();
  });
}

async function openOverview(page) {
  await page.goto('/#/me/admin?hub=overview', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adminOverview')).toBeVisible();
}

async function expectIssuesSettled(page, text) {
  await expect(page.locator('#adminIssuesContainer')).toContainText(text);
  await expect(page.locator('#adminIssuesContainer')).not.toContainText('Loading issue evidence');
}

test('Overview Issues distinguishes fresh errors from stale unknown evidence and excludes disabled services', async ({ page }) => {
  const now = Date.now();
  const rawSecretError = '403 invalid token sk_live_DO_NOT_RENDER client_secret=super-secret';
  await mockAdmin(page, {
    flags: { brickowl: true },
    integrations: [
      diagnostic({
        service: 'bricklink', label: 'BrickLink', reachable: false, status: 'down',
        last_checked_at: new Date(now - 5 * 60_000).toISOString(),
        last_ok_at: null, last_fail_at: new Date(now - 5 * 60_000).toISOString(),
        last_error: rawSecretError, fail_count: 2,
      }),
      diagnostic({
        service: 'rebrickable', label: 'Rebrickable', reachable: null, status: 'unknown',
        last_checked_at: new Date(now - 72 * 60 * 60_000).toISOString(),
        last_ok_at: null, last_fail_at: new Date(now - 72 * 60 * 60_000).toISOString(),
      }),
      diagnostic({
        service: 'brickowl', label: 'BrickOwl', reachable: false, status: 'down',
        last_checked_at: new Date(now - 2 * 60_000).toISOString(),
        last_ok_at: null, last_fail_at: new Date(now - 2 * 60_000).toISOString(),
        last_error: 'disabled provider failure', fail_count: 1,
      }),
    ],
  });

  await openOverview(page);
  await expectIssuesSettled(page, 'BrickLink needs access');
  const issues = page.locator('#adminIssuesContainer');
  await expect(issues).toContainText('Access');
  await expect(issues).toContainText('Rebrickable evidence is stale');
  await expect(issues).toContainText('Stale evidence');
  await expect(issues).not.toContainText('BrickOwl');
  await expect(issues).not.toContainText(rawSecretError);
  await expect(issues).not.toContainText('sk_live_DO_NOT_RENDER');
});

test('an issue remedy navigates to the real target hub and panel', async ({ page }) => {
  await mockAdmin(page, {
    integrations: [diagnostic({
      service: 'rebrickable', label: 'Rebrickable', reachable: null, status: 'unknown',
      last_checked_at: null, last_ok_at: null, last_fail_at: null,
    })],
  });

  await openOverview(page);
  await expectIssuesSettled(page, 'Rebrickable health is unknown');
  const remedy = page.locator('#adminIssuesContainer a', { hasText: 'Review catalog sources' });
  await expect(remedy).toHaveAttribute('href', '#/me/admin?hub=pricing&view=populate');
  await remedy.click();

  await expect(page).toHaveURL(/#\/me\/admin\?hub=pricing&view=populate$/);
  await expect(page.locator('#adminPricing')).toBeVisible();
  await expect(page.locator('#pricingPopulatePanel')).toBeVisible();
  await expect(page.locator('#pricingCenterPanel')).toBeHidden();
});

test('failed diagnostics render explicit unknown evidence rather than false healthy state', async ({ page }) => {
  await mockAdmin(page, { integrationStatus: 500 });

  await openOverview(page);
  await expectIssuesSettled(page, 'Service evidence is unavailable');
  const issues = page.locator('#adminIssuesContainer');
  await expect(issues).toContainText('Unknown');
  await expect(issues).toContainText('Overview could not confirm current service health.');
  await expect(issues).not.toContainText('No current issues found');
  await expect(issues).not.toContainText('Healthy');
});
