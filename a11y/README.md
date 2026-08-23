# Accessibility checks

axe-core (via Playwright) scans the checked-out frontend on each PR, while
Lighthouse CI also runs its configured checks. Serious and critical axe
findings block the job; Lighthouse findings remain informational.

## Run locally
    npm ci
    npx playwright install --with-deps chromium
    npm run a11y
    npm run lhci

Lighthouse starts the repository's local static server on port 4322 by default,
so local and PR results measure the checked-out candidate. Set
`A11Y_BASE=https://bricksvault.app` to scan the deployed site instead.

## Enable in CI
Copy `a11y/github-workflow.yml` to `.github/workflows/a11y.yml` (the API
integration can't write workflow files).

## Tighten Lighthouse later

Change `"warn"` to `"error"` in `a11y/lighthouserc.cjs` and remove its
`continue-on-error` workflow setting after clearing that broader baseline.
The config keeps Chrome sandboxing enabled by default; restricted runners can
set `LHCI_NO_SANDBOX=1` to opt into the sandbox workaround.

## Auth-gated routes
Coverage is the guest-reachable routes (vault, catalog, figs, build, You tab).
For authed screens, add a Playwright global-setup that logs in a dedicated CI
test account (store creds in GitHub Actions secrets; the login Turnstile may need
a test bypass).
