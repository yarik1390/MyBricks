// Config for the one-off PWA/store screenshot capture (screenshots.spec.mjs).
// Kept separate from the smoke config so `npm run e2e` / CI never regenerates
// screenshots on every push. Usage:
//   PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --config=e2e/screenshots.config.mjs
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT || 4321);

export default defineConfig({
  testDir: '.',
  testMatch: 'screenshots.spec.mjs',
  timeout: 30000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    serviceWorkers: 'block',
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `node e2e/serve.mjs`,
    cwd: REPO_ROOT,
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: true,
    timeout: 30000,
    env: { PORT: String(PORT) },
  },
});
