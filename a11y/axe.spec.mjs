// Accessibility scan over guest-reachable routes. Serious and critical
// violations fail the build; the JSON artifact preserves the full report.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';

const BASE = process.env.A11Y_BASE || 'http://localhost:4322';
const ROUTES = ['/', '/#/add', '/#/minifigs', '/#/build', '/#/me'];
const report = [];

for (const route of ROUTES) {
  test(`a11y ${route}`, async ({ page }) => {
    await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
    // Dismiss the first-run onboarding carousel if present, to scan the view itself.
    try { await page.getByRole('button', { name: /^skip$/i }).click({ timeout: 1500 }); } catch {}
    await page.waitForTimeout(1800);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const serious = results.violations.filter(v => ['serious', 'critical'].includes(v.impact));
    report.push({
      route,
      total: results.violations.length,
      serious: serious.length,
      violations: results.violations.map(v => ({ impact: v.impact, id: v.id, nodes: v.nodes.length })),
    });
    console.log(`\n[a11y] ${route} — ${results.violations.length} violation(s), ${serious.length} serious/critical`);
    for (const v of results.violations) {
      console.log(`   - [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node[s])`);
    }
    expect(serious, JSON.stringify(serious.map(v => v.id))).toEqual([]);
  });
}

test.afterAll(async () => {
  try { fs.mkdirSync('a11y', { recursive: true }); fs.writeFileSync('a11y/axe-report.json', JSON.stringify(report, null, 2)); } catch {}
});
