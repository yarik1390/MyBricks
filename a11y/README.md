# Accessibility checks (report-only)

axe-core (via Playwright) + Lighthouse CI run against the deployed Pages site on
each PR. They are **report-only** — findings are logged and uploaded, never block.

## Run locally
    npm i -D @playwright/test @axe-core/playwright @lhci/cli
    npx playwright install --with-deps chromium
    A11Y_BASE=https://brickvault-5ub.pages.dev npm run a11y
    npm run lhci

## Enable in CI
Copy `a11y/github-workflow.yml` to `.github/workflows/a11y.yml` (the API
integration can't write workflow files).

## Make it blocking (after clearing the baseline)
- axe: uncomment the `expect(...)` line in `a11y/axe.spec.mjs`.
- Lighthouse: change `"warn"` to `"error"` in `a11y/lighthouserc.json`.
- Workflow: remove `continue-on-error: true` from the axe/Lighthouse steps.

## Auth-gated routes
Coverage is the guest-reachable routes (vault, catalog, figs, build, You tab).
For authed screens, add a Playwright global-setup that logs in a dedicated CI
test account (store creds in GitHub Actions secrets; the login Turnstile may need
a test bypass).
