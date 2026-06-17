import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'axe.spec.mjs',
  timeout: 60000,
  retries: 1,
  workers: 1,
  reporter: 'list',
  use: { headless: true },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
