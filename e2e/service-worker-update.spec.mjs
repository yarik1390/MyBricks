import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

// Real HTTP cache + real service worker, on an isolated local origin. Route
// mocks disable Chromium's HTTP cache and would miss this production bug.
test.use({ serviceWorkers: 'allow' });
test('updating the service worker replaces fresh HTTP-cached assets and keeps offline support', async ({ page, context }) => {
  const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  let release = 1;
  const color = () => `rgb(${release * 30}, 20, 10)`;
  const server = createServer((req, res) => {
    const send = (type, body, cache = 'no-store') => {
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache });
      res.end(body);
    };
    if (req.url === '/sw.js') {
      let worker = source.replace(/const VERSION = .*?;/, `const VERSION = "test-${release}";`)
        .replace(/const STATIC_ASSETS = \[[\s\S]*?\];/, "const STATIC_ASSETS = ['/', '/app.css', '/js/app.js'];");
      // Simulate a client on the previous implementation, then upgrade using
      // the actual current worker with its new release cache policy.
      if (release === 1) worker = worker.replace("c.add(new Request(url, { cache: 'reload' }))", 'c.add(url)');
      return send('text/javascript', worker);
    }
    if (req.url === '/app.css') return send('text/css', `body { color: ${color()}; }`, 'public, max-age=14400');
    if (req.url === '/js/app.js') return send('text/javascript', `document.querySelector('h1').textContent = 'release-${release}';`, 'public, max-age=14400');
    if (req.url === '/') return send('text/html', '<!doctype html><link rel="stylesheet" href="/app.css"><h1>Loading</h1><script src="/js/app.js"></script>');
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    });
    await expect(page.locator('h1')).toHaveText('release-1');
    await expect(page.locator('body')).toHaveCSS('color', 'rgb(30, 20, 10)');
    release = 2;
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration.update();
      if (!registration.waiting) await new Promise(resolve => registration.installing.addEventListener('statechange', function changed() {
        if (this.state === 'installed') resolve();
      }));
      const changed = new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      registration.waiting.postMessage('SKIP_WAITING');
      await changed;
    });
    await page.reload();
    await expect(page.locator('h1')).toHaveText('release-2');
    await expect(page.locator('body')).toHaveCSS('color', 'rgb(60, 20, 10)');
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('h1')).toHaveText('release-2');
    await expect(page.locator('body')).toHaveCSS('color', 'rgb(60, 20, 10)');
  } finally {
    await context.setOffline(false);
    await page.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
