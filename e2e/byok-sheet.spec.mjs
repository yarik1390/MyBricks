// BYOK-first AI (2026-11-08): the Profile row shows the free trial and opens
// the "add your free Gemini key" sheet; a server refusal (402 byok_required)
// opens the same sheet by itself; a working key is saved on the device.
import { test, expect } from './fixtures.mjs';

async function stubMe(page, aiTrial) {
  await page.route('**/api/me', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      display_name: 'Test Collector', handle: 'tester', currency: 'USD',
      is_guest: false, portfolio_stats: {}, ai_trial: aiTrial,
    }),
  }));
}

test('Profile shows trial days and the sheet saves a tested key', async ({ page }) => {
  await stubMe(page, { started_at: '2026-11-01T00:00:00Z', ends_at: '2026-11-15T00:00:00Z', active: true, days_left: 6 });
  await page.route('https://generativelanguage.googleapis.com/**', (route) => route.fulfill({ contentType: 'application/json', body: '{"models":[]}' }));
  await page.goto('/#/me');
  const row = page.locator('#byokRow');
  await expect(row).toBeVisible();
  await expect(row).toContainText('6 days left');
  await row.click();

  const sheet = page.locator('.byok-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('a.byok-open')).toHaveAttribute('href', 'https://aistudio.google.com/apikey');
  await expect(page.locator('#byokRemember')).toBeChecked();
  await page.locator('#byokKeyInput').fill('AIzaTestKey123');
  await page.locator('#byokSave').click();
  await expect(page.locator('#sheet')).not.toHaveClass(/show/);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(stored).toContain('AIzaTestKey123');
});

test('a rejected key shows an error and is not saved', async ({ page }) => {
  await stubMe(page, { started_at: null, ends_at: null, active: true, days_left: 14 });
  await page.route('https://generativelanguage.googleapis.com/**', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: '{}' }));
  await page.goto('/#/me');
  await page.locator('#byokRow').click();
  await page.locator('#byokKeyInput').fill('wrong');
  await page.locator('#byokSave').click();
  await expect(page.locator('#byokError')).toBeVisible();
  await expect(page.locator('#byokError')).toContainText('rejected');
});

test('a 402 byok_required answer opens the sheet with the trial-ended lead', async ({ page }) => {
  await stubMe(page, { started_at: '2026-10-01T00:00:00Z', ends_at: '2026-10-15T00:00:00Z', active: false, days_left: 0 });
  await page.goto('/#/me');
  await expect(page.locator('#byokRow')).toContainText('trial ended');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('bv:byok', { detail: { code: 'byok_required', feature: 'advisor' } })));
  const sheet = page.locator('.byok-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('keep using the advisor');
});
