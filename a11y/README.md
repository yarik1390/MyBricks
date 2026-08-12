# Accessibility checks

axe-core (via Playwright) scans the checked-out frontend on each PR, while
Lighthouse CI also runs its configured checks. Serious and critical axe
findings block the job; Lighthouse findings remain informational.

## Run locally
    npm ci
    npx playwright install --with-deps chromium
    npm run a11y
    npm run lhci

Set `A11Y_BASE=https://bricksvault.app` to scan the deployed site
instead of the checked-out frontend.

## Enable in CI
Copy `a11y/github-workflow.yml` to `.github/workflows/a11y.yml` (the API
integration can't write workflow files).

## Tighten Lighthouse later

Change `"warn"` to `"error"` in `a11y/lighthouserc.json` and remove its
`continue-on-error` workflow setting after clearing that broader baseline.

## Auth-gated routes
Coverage is the guest-reachable routes (vault, catalog, figs, build, You tab).
For authed screens, add a Playwright global-setup that logs in a dedicated CI
test account (store creds in GitHub Actions secrets; the login Turnstile may need
a test bypass).
