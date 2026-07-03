# Brickvault — App Store packaging

Brickvault is a PWA (Cloudflare Pages + Workers). This folder holds everything needed to
package it for **Google Play** (as a Trusted Web Activity) and the **Apple App Store**
(as a Capacitor native wrapper), plus the store paperwork.

See **CHECKLIST.md** for the full ordered submission checklist. This file covers the
two build paths.

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

## Google Play — Trusted Web Activity (TWA)

The recommended, Google-blessed way to put a PWA on Play. Uses `store/twa-manifest.json`.

1. Install Bubblewrap: `npm i -g @bubblewrap/cli`
2. Initialize (generates the keystore and Android project):
   ```
   bubblewrap init --manifest https://brickvault-5ub.pages.dev/manifest.json
   ```
   (You can seed answers from `store/twa-manifest.json`.)
3. Bubblewrap prints your **SHA-256 signing fingerprint**. Paste it into
   `public/.well-known/assetlinks.json`, replacing `REPLACE_WITH_YOUR_APP_SIGNING_SHA256_FINGERPRINT`,
   and deploy so it's live at `https://brickvault-5ub.pages.dev/.well-known/assetlinks.json`.
   Verify: `curl -s https://brickvault-5ub.pages.dev/.well-known/assetlinks.json`
4. Build the release bundle: `bubblewrap build` → produces `app-release-bundle.aab`.
5. In Play Console: create the app, upload the `.aab`, complete the store listing,
   Data Safety form, and content rating, then roll out to internal testing → production.

> If you use **Play App Signing** (recommended), the fingerprint that must go in
> `assetlinks.json` is the one Play shows under *Setup → App signing*, not only your
> upload key. Add both the upload and the Play-managed fingerprints to be safe.

Alternative: **PWABuilder.com** → enter the manifest URL → download the Android package.
It wraps the same TWA flow with a UI.

## Apple App Store — Capacitor wrapper

Apple does not accept TWAs. Wrap the PWA with Capacitor. Uses `store/capacitor.config.json`.

1. On a Mac with Xcode: `npm i @capacitor/core @capacitor/cli @capacitor/ios`
2. Copy `store/capacitor.config.json` to the repo root as `capacitor.config.json`.
3. `npx cap add ios` then `npx cap open ios` (opens Xcode).
4. Add `NSCameraUsageDescription` to `ios/App/App/Info.plist` (for the scanner), set the
   Bundle ID to match `appId`, and add your Apple Developer team for signing.
5. Archive in Xcode → upload to App Store Connect → submit for review.

> **Guideline 4.2 (minimum functionality):** Apple can reject a plain "website in a
> webview." Brickvault's camera scan, offline PWA, and push are the native-feeling
> capabilities that satisfy this — lean into them. Prefer bundling the web assets locally
> (config mode B) and wiring real Capacitor plugins (Camera, Push, Haptics) over just
> loading the remote URL. See notes in `capacitor.config.json`.

Alternative: **PWABuilder.com** iOS package generates a similar WKWebView Swift project.
