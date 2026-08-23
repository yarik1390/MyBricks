import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT || 4322);

export default defineConfig({
  testDir: '.',
  testMatch: 'axe.spec.mjs',
  timeout: 60000,
  retries: 1,
  workers: 1,
  reporter: 'list',
  use: {
    headless: true,
    baseURL: `http://localhost:${PORT}`,
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: process.env.A11Y_BASE ? undefined : {
    command: 'node e2e/serve.mjs',
    cwd: REPO_ROOT,
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    env: { PORT: String(PORT) },
  },
});
