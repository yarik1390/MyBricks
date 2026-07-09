# BricksVault — App Store packaging

BricksVault is a PWA (Cloudflare Pages + Workers). This folder holds everything needed to
package it for **Google Play** (as a Trusted Web Activity) and the **Apple App Store**
(as a Capacitor native wrapper), plus the store paperwork.

See **CHECKLIST.md** for the full ordered submission checklist. This file covers the
two build paths.

---

## ⚠️ The Expo/EAS wrapper is PREVIEW-ONLY — do not submit it

The **`expo-preview/`** directory contains an Expo remote-WebView shell (`App.js`,
`app.json`, `eas.json`, `.eas/workflows/`) that loads the live site in a
`react-native-webview`. (It was moved out of the repo root so the root can host
the real Capacitor project — `capacitor.config.json` + `android/`.)
It exists so iOS builds can be produced in the cloud (EAS) without a Mac — useful for
**seeing BricksVault on a device**, nothing more. It must NOT become the store
submission, because:

1. **Billing breaks / gets rejected (Apple 3.1.1, Play Billing policy):** the
   RevenueCat bridge in `revenuecat-native.js` detects `window.Capacitor` — absent in
   the Expo WebView — so `isNativeBilling()` is false and Pro falls back to the
   Patreon link. Selling a digital subscription via an external link in-app is a
   rejection on iOS and a policy violation on Play.
2. **Apple 4.2 (minimum functionality):** a plain remote-WebView wrapper with no
   native capability is the most-rejected app category on iOS.
3. **Feature degradation in WKWebView:** no service workers (offline mode dies
   without App-Bound Domains entitlements), and camera `getUserMedia` needs
   `mediaCapturePermissionGrantType` config the wrapper doesn't set — the scanner is
   untested there.

The path that ships is **Capacitor** (below) for BOTH stores: billing works through
the native bridge and the camera/offline/push capabilities answer Guideline 4.2.
Use the Expo `preview` profile for internal device checks only.

---

## What's already done in the repo

- **In-app account deletion** — `DELETE /api/me` purges every user-scoped table + the
  user's R2 photos, and (when `SUPABASE_SERVICE_ROLE_KEY` is set) deletes the Supabase
  auth identity. UI lives in the Me tab ("Delete account"). *Required by both stores.*
- **Sign in with Apple** — button is in the login screen, gated behind the server flag
  `apple_signin` (set env `APPLE_SIGNIN_ENABLED=1` once Apple is configured in Supabase).
  *Required by Apple when Google sign-in is offered (Guideline 4.8).*
- **Privacy Policy & Terms** — `public/privacy.html`, `public/terms.html`, linked from the
  Me tab footer. Review the contact email / owner name / dates before publishing.
- **Digital Asset Links** — `public/.well-known/assetlinks.json` (placeholder fingerprint).
- **PWA manifest** — installable: standalone display, 192/512 + maskable icons, shortcuts.

## What only you can do (needs accounts / a Mac / secrets)

- Create a **Google Play Console** account ($25 one-time) and an **Apple Developer**
  account ($99/year).
- Build & submit the iOS app on a **Mac + Xcode** (or a macOS CI such as Codemagic).
- Provide the **app-signing SHA-256 fingerprint** (from Bubblewrap/Play) for assetlinks.
- Configure **Apple sign-in in Supabase** (Service ID + key) and set `APPLE_SIGNIN_ENABLED=1`.
- Decide the **payments model** for the supporter tier (see CHECKLIST → Payments).
- Capture **store screenshots** and write final listing text (draft in `listing.md`).

---

## Google Play — Capacitor + Play Billing (RevenueCat)

> ⚠️ **Capacitor, not a TWA.** A Trusted Web Activity can't use Google Play Billing, and
> BricksVault sells a supporter tier ("BricksVault Pro") in-app — Play policy requires that
> to go through Play Billing. Capacitor wraps the same PWA *and* exposes native Play
> Billing via the RevenueCat plugin. (`twa-manifest.json` is kept only for reference.)
> One Capacitor project also serves the iOS build later.

**Billing is already wired in the repo:**
- Server webhook `POST /api/revenuecat/webhook` — authoritative, flips `is_supporter`.
  Set GitHub secret `REVENUECAT_WEBHOOK_AUTH` and point RevenueCat's webhook at it.
- Client `public/js/lib/revenuecat-native.js` + Me-tab "Upgrade to Pro" / "Restore" /
  "Manage subscription" (shown only on the native build; web keeps Patreon).
- Set the RevenueCat **Google** public key (`goog_…`) as `window.RC_PLAY_BILLING_KEY` in
  `public/env.js`. (A `test_…` key is a *Web Billing* key and will NOT work here.)

### Build steps
1. Add Capacitor + the RevenueCat plugins (web assets are static, so `webDir` = `public`):
   ```
   npm i @capacitor/core @capacitor/cli @capacitor/android
   npm i @revenuecat/purchases-capacitor @revenuecat/purchases-capacitor-ui
   cp store/capacitor.config.json ./capacitor.config.json   # appId app.brickvault, webDir public
   npx cap add android
   npx cap sync android
   ```
   `cap sync` links RevenueCat's native code so the bridge in `revenuecat-native.js`
   resolves. **Verify the plugin names** (`Purchases`, `RevenueCatUI`) in
   `node_modules/@revenuecat/purchases-capacitor*/dist/esm/index.js` and fix the two
   constants at the top of `revenuecat-native.js` if they differ.
2. Play Console → create products: `lifetime` (one-time), `yearly` + `monthly`
   (auto-renewing subscriptions); set prices; activate.
3. RevenueCat → add the **Google Play app** (Play service-account JSON), create entitlement
   **`BricksVault Pro`**, attach the 3 products, build a `default` **Offering**, design the
   **Paywall**, set the webhook + copy the `goog_` key into `env.js`.
4. `npx cap open android` → Android Studio → set app id / signing → **Build → Generate
   Signed Bundle (.aab)**. Test with a Play **license-tester** account (no real charge).
5. Play Console: upload the `.aab`, complete the listing / Data Safety / content rating →
   Internal testing → Production.

> **assetlinks.json** is only needed for deep-link verification, not billing. If you keep
> it, paste the Play App Signing SHA-256 (Play Console → *Setup → App signing*) into
> `public/.well-known/assetlinks.json` and redeploy.

The camera scan + offline PWA + push give the app real native capability — a genuine app,
not a thin wrapper.

## Apple App Store — Capacitor wrapper

Apple does not accept TWAs. Wrap the PWA with Capacitor. Uses `store/capacitor.config.json`.

1. On a Mac with Xcode: `npm i @capacitor/core @capacitor/cli @capacitor/ios`
2. Copy `store/capacitor.config.json` to the repo root as `capacitor.config.json`.
3. `npx cap add ios` then `npx cap open ios` (opens Xcode).
4. Add `NSCameraUsageDescription` to `ios/App/App/Info.plist` (for the scanner), set the
   Bundle ID to match `appId`, and add your Apple Developer team for signing.
5. Archive in Xcode → upload to App Store Connect → submit for review.

> **Guideline 4.2 (minimum functionality):** Apple can reject a plain "website in a
> webview." BricksVault's camera scan, offline PWA, and push are the native-feeling
> capabilities that satisfy this — lean into them. Prefer bundling the web assets locally
> (config mode B) and wiring real Capacitor plugins (Camera, Push, Haptics) over just
> loading the remote URL. See notes in `capacitor.config.json`.

Alternative: **PWABuilder.com** iOS package generates a similar WKWebView Swift project.
