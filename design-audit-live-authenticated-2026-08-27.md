# BricksVault Live Authenticated Design Audit

**Date:** 2026-08-27  
**Surface:** `https://bricksvault.app`  
**Modes:** authenticated admin account; 390×844 mobile and 1440×1000 desktop  
**Method:** live browser route inventory, rendered screenshots, computed layout/type/touch-target inspection, image-loading checks, keyboard-focus traversal, reduced-motion checks, 320px reflow checks, and non-destructive interaction inspection.  
**Design frameworks applied:** `design-taste-frontend`, `impeccable`, `make-interfaces-feel-better`, `mybricks-visual-qa`, `web-interface-guidelines`, and the design-relevant evidence rules from `production-application-audit`.  
**Source/test mapping:** [`design-audit-source-test-map-2026-08-27.md`](./design-audit-source-test-map-2026-08-27.md) maps Catalog plus global typography, touch-target, motion, and update-toast findings to owning source and current regression coverage.

> Security note: authentication credentials are intentionally omitted.

## Executive summary

BricksVault has a distinctive collector-focused visual identity, a broad and useful feature set, and a generally coherent navigation model. The live app is functional at both tested widths and did not show document-level horizontal overflow. The strongest surface is the scanner entry flow: its purpose and three identification paths are clear.

The dominant weakness is **information compression**. On data-dense routes, the interface often fits more labels, metadata, filters, and status text than a mobile user can comfortably scan. This is reinforced by a typography system that regularly drops to 8–10px and by controls that are commonly 31–40px tall. The result feels powerful but closer to an internal tool than a polished consumer collection app.

**Overall design grade: B−**

- Brand differentiation: **B+**
- Information architecture: **B**
- Visual hierarchy: **B−**
- Mobile ergonomics: **C+**
- Accessibility/readability: **C+**
- Desktop responsiveness: **B**
- Operational/admin UX: **C+**

## Scope observed

Authenticated routes inspected:

- Vault `/`
- Catalog `/add`
- Scanner `/pile`
- Minifigs `/minifigs`
- Wishlist `/wishlist`
- Build `/build`
- Leaderboard `/leaderboard`
- Profile `/me`
- Admin `/me/admin`
- Integrations `/me/integrations`
- Data `/me/data`

The session was confirmed as the authenticated admin profile before the audit. The app was inspected at 390×844 and 1440×1000.

## Finding-to-code-and-test map

This map separates live observations from implementation evidence. A source or
test link means the finding has a concrete owner and regression guard; it does
not turn a visual observation into proof of production behavior.

| Surface | Audit finding | Source owner | Regression coverage |
| --- | --- | --- | --- |
| Admin | Nine top-level destinations and dense service controls need progressive disclosure rather than one continuous mobile dashboard. | `public/js/views/me-admin-config.js` (`ADMIN_SECTIONS`); `public/js/views/me-admin.js` (`wireAdminShell`, `activateAdminSection`, service-category rendering); `public/app.css` (`.admin-section`, `.admin-segments-sticky`, `.admin-service-*`). | `e2e/audit-admin-integrations-data.spec.mjs` verifies one active panel at a time, section switching, and the 44px floor for the section nav and service summaries. Existing `e2e/smoke.spec.mjs` verifies admin gating and section activation. |
| Integrations | Discord's 31px webhook row and Brickset's 36–40px credentials/actions are undersized; long inline actions also crowd narrow screens. | `public/js/views/me-integrations.js` (`.integrations-page`, `.integration-control`, `.integration-action`, `.integration-inline-actions` hooks); `public/app.css` owns the 45px control floor and narrow-screen wrapping. | `e2e/audit-admin-integrations-data.spec.mjs` renders the real route at 390×844, measures every named webhook/Brickset control, and verifies webhook actions move below the long input. `e2e/i18n.spec.mjs` continues to cover dynamic integration copy. |
| Data | Restore buttons measured 31px and file actions were compact; the route needs full-size destructive/recovery and file-picker targets. | `public/js/views/me-data.js` (`.backup-row`, `.backup-restore`, `.csv-file-label` markup); `public/app.css` owns 44px restore and file-picker floors. | `e2e/audit-admin-integrations-data.spec.mjs` stubs a snapshot, renders the real route at 390×844, and measures restore plus both file-picker actions. |

The dedicated audit regression file is included by `e2e/playwright.config.mjs`,
so these checks run with the normal hermetic frontend suite.

## Priority findings

### P0 — None

No design defect observed during this audit made the app unusable across the inspected routes.

### P1 — Mobile typography is materially too small on core routes

**Evidence**

- Vault contained visible text at **8px**, with **39 of 69** measured leaf-text nodes below 12px.
- Catalog contained **212 of 301** measured leaf-text nodes below 12px.
- Minifigs contained **85 of 187** below 12px.
- Build contained **249 of 511** below 12px.
- The most common catalog sizes were 10px and 9px for substantial quantities of content.

**Impact**

Set metadata, price confidence, badges, supporting labels, and operational statuses require effort to parse on a phone. The tiny type also makes the visual hierarchy flatter: many tertiary labels become texture rather than usable information.

**Recommendation**

Adopt a hard mobile floor:

- 12px only for truly tertiary metadata and badges.
- 13–14px for card metadata and field help.
- 15–16px for primary body and input text.
- 17–20px for card titles and section-level headings.

Reduce the amount of simultaneously visible metadata instead of preserving density by shrinking text. Put secondary investment, forecast, and confidence data into a second line, disclosure, or detail screen.

### P1 — Touch targets are consistently below a comfortable mobile standard

**Evidence**

Observed mobile controls include:

- Vault header icons: **39×39px**.
- Vault range buttons: **55×40px**.
- Vault content tabs: **166×38px**.
- Wishlist marketplace action: **88×40px**; BrickLink icon action **44×40px**.
- Admin back control: **39×39px**.
- Admin service toggles: **24×24px**.
- Integration webhook input and Save action: **31px** tall.
- Brickset fields: **36px** tall; connect action **40px** tall.
- Data restore actions: **71×31px**.

**Impact**

High-frequency controls are harder to acquire reliably, particularly in the catalog and admin interfaces where many targets sit close together. A small visible checkbox can still have a larger hit area, but the observed geometry gives no visual indication that this is consistently true.

**Recommendation**

Use a **44×44px minimum interaction box**, even when the visible icon remains 20–24px. Raise form controls and buttons to at least 44px. Keep chip rows horizontally scrollable, but make every chip 44px tall and provide clear edge fade or partial-card affordance.

### P1 — Catalog and collection screens overload the first viewport

**Evidence**

The mobile catalog exposes a large number of controls and cards immediately. Its live DOM contained 77 visible interactive elements overall and many simultaneous filter/sort/theme controls. On desktop, the catalog’s search, filter, sort, status, and view controls form a dense band with similar visual weight. Catalog cards also carry numerous title, theme, set-number, status, value, and wishlist signals.

**Impact**

The user’s primary job—finding and adding a set—competes with browsing, sorting, pricing, status, layout, and wishlist functions. On mobile, the screen reads as a control panel followed by a database grid.

**Recommendation**

Restructure catalog controls into three layers:

1. Persistent primary search.
2. One compact row: **Filters**, **Sort**, **View**.
3. Applied-filter chips only when filters are active.

Move theme/status/price filters into a bottom sheet with result counts and a clear Apply action. Preserve only the two highest-value card actions. Make card content progressive: title + set number + one key market fact first; reveal the rest on detail/open.

### P1 — Admin mobile navigation and service rows are too dense

**Evidence**

The admin route presents nine top-level sections—Services, Populate, Activity, Catalog Quality, Pricing, LLM Routing, Users, Contributions, and Tools—followed by service category filters and individual status rows. At 390px, some category items extend beyond the right edge as a horizontal strip, and service rows use compact 10–11px type and 24px toggles. Labels such as “INPUT” were found without an accessible name on visible service controls.

**Impact**

The operational surface is hard to scan, risks accidental state changes, and does not make severity or action priority obvious enough. Horizontal tab systems nested inside another horizontal filter system create weak wayfinding.

**Recommendation**

- Replace the top tab strip on mobile with a section selector or two-level grouped menu.
- Make “Needs action” the default operational inbox with count badges.
- Present service cards with a stable anatomy: name, one-sentence purpose, state pill, last check, usage, primary action.
- Enlarge switches and give every icon-only/service control an explicit accessible name.
- Use a deliberate state scale: Healthy / Limited / Degraded / Disabled / Unknown with icon + text, not color alone.

### P1 — Form and integration actions are under-sized and too tightly composed

**Evidence**

The Integrations route combines compact 31–40px inputs and buttons, with some actions placed beside long fields. The Data route uses 31px Restore actions and compact file controls. Multiple credential/service blocks continue in one long column.

**Impact**

These settings are consequential, yet the interface visually treats them as low-stakes compact controls. Side-by-side field/action layouts are cramped on mobile, and destructive or account-linking operations do not receive enough separation.

**Recommendation**

- Stack inputs and actions on mobile.
- Use 44–48px fields and primary actions.
- Add connection state, last synced/checked time, and a clear disconnect/manage path.
- Separate credential entry from explanatory copy and mask keys consistently.
- For restore, use a detail/confirmation sheet showing snapshot date and consequences rather than a small inline action.

### P2 — Visual hierarchy is too label-heavy and uppercase-heavy

**Evidence**

Core pages repeatedly use small uppercase section labels such as “VAULT · LIVE,” “ROUGH ESTIMATE,” “RELIABLE PRICE,” “PUBLIC PROFILE,” “TROPHY SHELF,” and admin category/status labels. Many share similar letter spacing, size, and muted color.

**Impact**

The strong collector/terminal-like identity becomes visually noisy when nearly every metadata category is promoted to an uppercase badge or eyebrow. Users must decode labels instead of following a natural content hierarchy.

**Recommendation**

Reserve uppercase/letter-spaced styling for one level: page eyebrow or status pill, not both. Use sentence case for supporting labels and stronger size/weight contrast for primary numbers, titles, and actions.

### P2 — Navigation depth is broad but secondary destinations are not surfaced consistently

**Evidence**

Bottom navigation provides five stable primary destinations: Vault, Catalog, Scan, Minifigs, Me. Other high-value destinations—Wishlist, Build, Leaderboard, Integrations, and Data—sit behind back/secondary flows. Individual routes use different header patterns: some have a 39px Back action; primary routes use icon action clusters; Profile becomes a long settings hub.

**Impact**

Primary navigation is clear, but the secondary information architecture depends heavily on users discovering Profile or contextual entry points. The long Profile page mixes identity, valuation, public sharing, trophy shelf, subscriptions, preferences, and more.

**Recommendation**

Turn Profile into a concise account dashboard with grouped destination rows:

- Public profile
- Collection tools (Build, Wishlist, Data)
- Connected services
- Appearance and currency
- Support/account/admin

Keep personal stats and trophy shelf as content, but avoid making every setting part of the same continuous page.

### P2 — Update-ready banner collides with page-level header actions

**Evidence**

Before activating the newest service worker, the live fixed “Update ready / Refresh” banner occupied **x=97.5–292.5, y=12–71** at 390px. On Vault it overlapped the same top region as the 39px layout/search/action buttons around x=239–368 and y=26–65.

**Impact**

A system-level notification can obscure or compete with page controls exactly where users expect navigation and search.

**Recommendation**

Move update readiness to a bottom toast above the tab bar, or reserve header space while it is visible. Use one clear action and a dismiss option; do not overlay interactive header controls.

### P2 — Some search fields are visually described but not programmatically labelled

**Evidence**

The live Minifigs search input (`figSearch`) and Build search input (`buildSearch`) were visible but had no associated label, `aria-label`, or `aria-labelledby` in the inspected DOM.

**Impact**

Placeholder-only search creates ambiguity for assistive technology and loses context once text is entered.

**Recommendation**

Add stable accessible names and preserve visible labels where space allows. For example: `aria-label="Search minifigures"` and `aria-label="Search buildable sets"`.

### P2 — Admin and integration forms have broader accessible-name and form-metadata gaps

**Evidence**

- Seven visible Admin action buttons were present without text, `aria-label`, or `title`.
- Admin checkboxes and pricing/usage inputs lacked associated labels; several also had no `name` or autocomplete metadata.
- Eight visible Integrations fields or controls were detected without stable programmatic labels, including webhook, credential, AI-provider, and model-file inputs.
- The manual scanner input, Minifigs search, and Build search had no `name`; the two search inputs also lacked accessible names.

**Impact**

This affects screen-reader navigation, voice control, form understanding, and reliable automation. In a high-consequence admin surface, an unlabeled Test, Save, switch, or pricing field is particularly risky.

**Recommendation**

Give every form control a visible `<label>` where practical and otherwise a specific `aria-label`. Add stable `name`, correct `type`, `inputmode`, and `autocomplete` values. Label service actions with their object and verb—for example, “Test Brickognize connection” rather than a generic icon-only control.

### P2 — Broad `transition: all` usage weakens motion precision

**Evidence**

Computed styles reported large numbers of elements using `transition-property: all`: 138 on Vault, 538 on Catalog, 859 on Minifigs, and 1,245 on Build. The app does correctly collapse sampled durations to approximately zero when `prefers-reduced-motion: reduce` is enabled.

**Impact**

`transition: all` can animate unintended layout, color, or size changes and makes interaction behavior harder to reason about. On dense lists it can also add avoidable paint and compositing work.

**Recommendation**

Keep the good reduced-motion behavior, but replace broad transitions with explicit properties such as `color`, `background-color`, `border-color`, `box-shadow`, `opacity`, and `transform`. Prefer 120–180ms for direct manipulation and 180–240ms for disclosure surfaces.

### P3 — Polish should come from hierarchy and state clarity, not additional decoration

**Evidence**

The existing interface already uses rounded cards, pills, shadows, badges, uppercase eyebrows, accent colors, and floating controls. Catalog and Profile contain several nested surface treatments, while the visual audit’s dominant problem is density rather than lack of ornament.

**Recommendation**

Do not solve the audit by adding gradients, glass effects, more card borders, or more badges. Preserve the collector identity while reducing container nesting, consolidating radii, and using spacing and typography as the primary hierarchy tools.

### P2 — Account performance semantics are potentially confusing

**Evidence**

The Profile summary showed **GAIN −$45** alongside a down indicator and **+1.1%**. Regardless of the underlying financial convention, the sign combination reads inconsistently at a glance.

**Impact**

Users may misread portfolio performance because value direction, percentage sign, color, and arrow are not semantically aligned.

**Recommendation**

Normalize one explicit model:

- `Loss −$45 (−1.1%)`, red/down; or
- `Gain +$45 (+1.1%)`, green/up.

Do not rely on an arrow to reconcile contradictory signs.

### P3 — Empty and educational states need more task-oriented hierarchy

**Evidence**

Profile’s empty trophy shelf explains the feature and offers “Add to shelf,” which is good, but it sits inside an already long page. Scanner’s introductory page clearly offers barcode, photo, and manual entry; this was the strongest empty/entry state observed. Other list routes emphasize explanatory copy and broad feature controls rather than one next action.

**Recommendation**

Reuse the scanner pattern across empty states: concise title, one sentence, one primary action, optional secondary route. For Trophy Shelf, show a compact preview and surface it near public-profile setup rather than deep in the profile stream.

## What is working well

1. **Distinct identity.** The dark warm-neutral palette, cream text, gold accent, collector terminology, and restrained retro cues are recognizable and avoid generic blue SaaS styling.
2. **Stable primary navigation.** Five bottom destinations on mobile and a persistent desktop rail create a learnable top-level model.
3. **Scanner entry clarity.** Barcode, photo, and set-number paths are explicit, with supporting text that explains when to use each.
4. **No document-level overflow in tested routes.** At 390px, inspected routes reported zero document-width overflow. Horizontal chip/tab strips can extend internally, but the page itself remained contained.
5. **Responsive desktop shell.** At 1440px, the application uses a 240px navigation rail and a 1200px content area; profile/admin/settings use a slightly narrower 1120px main frame. The shell scales rather than simply stretching a mobile column.
6. **Images recovered after load.** Initial checks during rapid route switching showed unloaded images; after allowing routes to settle, Vault, Catalog, and Minifigs had no visible broken images. This was not treated as a confirmed defect.
7. **Authenticated feature breadth is coherent.** Vault, catalog, scanner, minifigs, buildability, public profile, sync/integration, import/export, and admin operations belong to the same collection-management story.
8. **Keyboard focus is visibly implemented.** Live Tab traversal showed a consistent 3px focus outline on sampled Vault, Catalog, Scanner, Admin, and Integrations controls.
9. **Reduced-motion support is implemented.** With `prefers-reduced-motion: reduce`, sampled animations and transitions collapsed to approximately `0.00001s`.
10. **Narrow reflow is robust.** Vault, Catalog, Scanner, Profile, Admin, and Integrations all remained within a 320px CSS viewport without document-level horizontal overflow.

## Recommended redesign sequence

### Phase 1 — Readability and ergonomics

1. Establish mobile type tokens with a 12px minimum and 15–16px body.
2. Establish 44px minimum control hit boxes.
3. Increase input/button heights to 44–48px.
4. Fix accessible names and metadata across Scanner, Build, Minifigs, Admin, Integrations, and Data forms.
5. Normalize gain/loss semantics.
6. Relocate the service-worker update prompt.
7. Replace `transition: all` with explicit properties while preserving reduced-motion behavior.

### Phase 2 — Density reduction

1. Simplify Catalog controls into Search / Filters / Sort / View.
2. Reduce card metadata shown by default.
3. Redesign Admin into an action inbox plus grouped service cards.
4. Break Profile into a dashboard and grouped destination pages.
5. Stack integration fields/actions on mobile.

### Phase 3 — System polish

1. Consolidate uppercase labels and badge styles.
2. Normalize route headers and back/action placement.
3. Define one status system across pricing confidence, service health, subscription gating, and sync states.
4. Add screenshot-based visual regression coverage for 390px and 1440px on Vault, Catalog, Scanner, Profile, and Admin.

## Suggested acceptance criteria

- No meaningful text below 12px at 390px.
- All interactive controls have a 44×44px hit area.
- Core forms use at least 16px input text and 44px height.
- Catalog’s first viewport presents one dominant search and no more than three secondary control groups.
- Admin service status and primary action are understandable without opening a detail view.
- Every visible input and icon-only action has an accessible name.
- Update prompts do not overlap route headers or bottom navigation.
- Positive/negative financial changes use consistent signs, labels, arrows, and colors.
- Screenshot baselines exist for core routes at mobile and desktop widths.

## Evidence notes

This was an observed live-browser audit, not a source-only critique. Measurements came from computed DOM geometry and styles in the production app. Screenshots and JSON inventories were stored in the browser audit workspace for the session. No account settings, collection entries, integrations, service toggles, or admin configuration were intentionally changed.
