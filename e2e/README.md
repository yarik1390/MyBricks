# Frontend smoke suite (Playwright)

Hermetic end-to-end smoke tests for the BricksVault SPA. They run against the **real
`public/` bundle** but need **no live services**: a tiny zero-dependency static
server (`serve.mjs`) serves the app, and each test **stubs Supabase auth + every
`/api/*` call** in the browser (`fixtures.mjs`), so the suite is deterministic,
secret-free, and never mutates production data (important — it exercises the
wishlist toggle, which writes).

## What it covers
- App boots into the **authed** app (not the login screen) and loads the profile.
- **Portfolio** renders the collection.
- **Catalog** ("Find a set") renders search results.
- **Set detail** renders with its action bar.
- **Wishlist toggle** removes a set and flips the button (asserts the `DELETE` fired).

## Run locally
```bash
npm i -D @playwright/test          # once (mirrors the a11y setup; not in package.json)
npx playwright install chromium    # once — downloads the browser
npm run e2e                        # or: npx playwright test --config=e2e/playwright.config.mjs
```
The config starts `serve.mjs` on port 4321 automatically (override with `PORT`).

## How the stubbing works
- **Auth:** `addInitScript` writes a fake signed-in session to `localStorage["bv_session"]`
  before any page script runs. The app only base64-decodes the JWT `sub` on the client
  (the Worker verifies the signature in prod), so an unsigned token is accepted locally.
- **API:** `page.route('**/api/**')` returns fixed JSON for the endpoints the covered
  views hit (`/api/config`, `/api/me`, `/api/collection`, `/api/wishlist`,
  `/api/sets/search`, `/api/sets/:num`, …) with a benign `{}` fallback for anything else.
- The service worker is blocked in the config so its caching can't cause cross-test races.

## CI
See `smoke-workflow.yml` in this folder — copy it to `.github/workflows/e2e-smoke.yml`
and commit it (the GitHub App lacks the `workflows` permission, so it can't be pushed
automatically). It installs Chromium and runs the suite on PRs and on pushes to the
default branch.

## Adding tests
Import `{ test, expect }` from `./fixtures.mjs` (not `@playwright/test`) so your test
gets the auth + API stubs automatically. Extend the endpoint map in `fixtures.mjs` when
a new view calls something new; keep the `SET` fixture in sync with real response shapes.
