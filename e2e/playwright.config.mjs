import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

// Hermetic frontend smoke suite: a zero-dep static server serves public/, and each
// test stubs Supabase auth + all /api/* (see fixtures.mjs), so the suite needs NO
// live Worker/Supabase and never mutates real data. Mirrors a11y/playwright.config.mjs.
const PORT = Number(process.env.PORT || 4321);

export default defineConfig({
  testDir: '.',
  testMatch: process.env.PW_MATCH || /(smoke|i18n|i18n-dict|scan-layout|card-badge-layout)\.spec\.mjs$/,
  timeout: 30000,
  expect: { timeout: 7000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    // Block the service worker so its caching can't introduce cross-test races —
    // we want deterministic network interception via page.route().
    serviceWorkers: 'block',
    // Sandboxes with a pre-installed Chromium (e.g. Claude Code remote env) set
    // PW_CHROMIUM_PATH instead of downloading a browser; CI leaves it unset.
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `node e2e/serve.mjs`,
    cwd: REPO_ROOT,
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    env: { PORT: String(PORT) },
  },
});
