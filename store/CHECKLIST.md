# BricksVault — App Store submission checklist

Ordered, end-to-end. Legend: **[DONE]** shipped in the repo · **[YOU]** needs your
account / Mac / decision · **[REVIEW]** drafted, review before publishing.

---

> **Current round (decided 2026-07): ANDROID FIRST, iOS DEFERRED.** Sections 1–5 +
> 7 are the active path; §6 (Apple) waits for the iOS round. The Expo wrapper in
> `expo-preview/` is preview-only (see README) and is NOT part of this checklist.

## 0. Prerequisites (do first)
- [ ] **[YOU]** Create a **Google Play Console** account — $25 one-time.
- [ ] **[YOU — iOS round]** Create an **Apple Developer Program** account — $99/year.
- [ ] **[YOU — iOS round]** Have a **Mac with Xcode** available (or a macOS CI: Codemagic, Xcode Cloud, EAS).
- [x] **[DONE]** App id decided: `app.bricksvault` (matches the Play Console app) — consistent across `capacitor.config.json`, `android/app/build.gradle`, `assetlinks.json`, `twa-manifest.json`, `expo-preview/app.json`.

## 1. Hard store blockers
- [x] **[DONE]** In-app **account deletion** — `DELETE /api/me` + Me-tab "Delete account" (both stores require this).
- [ ] **[YOU]** Set `SUPABASE_SERVICE_ROLE_KEY` as a Worker secret so deletion also removes the Supabase auth identity (not just data). `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`
- [x] **[DONE]** **Sign in with Apple** button (gated behind `apple_signin`).
- [ ] **[YOU — iOS round]** Configure the **Apple provider in Supabase** (Apple Developer Service ID + key + return URL), then set Worker env `APPLE_SIGNIN_ENABLED=1` to reveal the button. Required for iOS (Guideline 4.8).

## 2. Legal & privacy
- [ ] **[REVIEW]** `public/privacy.html` — confirm contact email (`support@brickvault.app` placeholder), owner name, and date.
- [ ] **[REVIEW]** `public/terms.html` — confirm contact, governing-law section, date.
- [x] **[DONE]** Both linked from the Me-tab footer.
- [ ] **[YOU]** Host the privacy policy at a stable public URL (already will be `https://bricksvault.app/privacy.html`) — you'll paste this into both store listings.
- [ ] **[YOU]** Complete **Google Play Data Safety** and **Apple App Privacy** forms — answers drafted in `listing.md`.

## 3. Payments — Play Billing via RevenueCat (DECIDED)
Supporter tier ("BricksVault Pro") is sold in-app through **Google Play Billing**, wired
with **RevenueCat**. Patreon stays on **web only**; it's auto-hidden in the native build.
- [x] **[DONE]** Server webhook `POST /api/revenuecat/webhook` — flips `is_supporter` from
  Play events (source of truth). Reuses the existing supporter-flip SQL. Tests pass.
- [x] **[DONE]** Client `public/js/lib/revenuecat-native.js` + Me-tab Upgrade / Restore /
  Manage subscription buttons (native only; web keeps Patreon).
- [ ] **[YOU]** Set GitHub secret `REVENUECAT_WEBHOOK_AUTH`; add the webhook in RevenueCat
  (Integrations → Webhooks) pointing at the Worker URL with that Authorization value.
- [ ] **[YOU]** Play Console products: `lifetime` (one-time), `yearly` + `monthly` (subs).
- [ ] **[YOU]** RevenueCat: add the Play app (service-account JSON), entitlement
  `BricksVault Pro`, attach products, build the `default` Offering, design the Paywall,
  copy the **`goog_`** public key into `public/env.js` as `window.RC_PLAY_BILLING_KEY`.
- [x] **[DONE]** Plugin registration names verified against
  `@revenuecat/purchases-capacitor@13.2.2` — `Purchases` / `RevenueCatUI` match the
  constants in `revenuecat-native.js` exactly. (Method shapes: confirm once during
  the on-device license-tester purchase.)
- [ ] **[YOU]** Set GitHub secret `RC_PLAY_BILLING_KEY` (the `goog_` key) — CI injects it
  into the deployed `env.js` automatically (deploy-worker.yml).

## 4. Assets
- [x] **[DONE]** App icons: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `icon.svg`.
- [x] **[DONE]** Play screenshots (4× 1080×1920) + **feature graphic 1024×500** in
  `store/play/` — regenerate with `npx playwright test --config=e2e/screenshots.config.mjs`.
  Optionally re-shoot on a real device with your own vault for more authentic data.
- [ ] **[YOU — iOS round]** Apple: 6.7" (1290×2796) and 6.5" (1242×2688) iPhone sets; 12.9" iPad if you support iPad.
- [ ] **[REVIEW]** Short & full descriptions, keywords — finalized draft in `listing.md`.
- [ ] **[YOU]** Content/age rating questionnaire (Play IARC; Apple age rating).

## 5. Google Play — build & submit (Capacitor + Play Billing)
- [x] **[DONE]** Capacitor installed at repo root; `android/` project committed
  (appId `app.bricksvault`, versionName 1.0.0/versionCode 1 in
  `android/app/build.gradle` — bump both on every upload); CAMERA permission wired.
- [x] **[DONE]** CI build: `.github/workflows/build-android.yml` produces the signed
  `.aab` on a plain ubuntu runner — **no Android Studio needed**. One-time setup:
  create the upload keystore (`keytool -genkeypair -v -keystore upload.jks -alias
  upload -keyalg RSA -keysize 2048 -validity 10000`) and add 4 GitHub secrets
  (`ANDROID_KEYSTORE_BASE64` = `base64 -w0 upload.jks`, `ANDROID_KEYSTORE_PASSWORD`,
  `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`). Dispatch needs the workflow on the
  default branch.
- [ ] **[YOU]** Create the keystore + secrets, dispatch **Build Android (.aab)**,
  download the artifact.
- [ ] **[YOU]** Test purchases with a Play **license-tester** account (no real charge) —
  this doubles as the on-device RevenueCat method-shape check.
- [ ] **[YOU]** Upload the `.aab` → fill listing + Data Safety + rating → internal testing → production.
- See README "Google Play — Capacitor + Play Billing" for the full sequence.

## 6. Apple App Store — build & submit (Capacitor) — **DEFERRED to the iOS round**
- [ ] **[YOU]** Copy `store/capacitor.config.json` to repo root; `npx cap add ios`; `npx cap open ios`.
- [ ] **[YOU]** Add `NSCameraUsageDescription` to Info.plist; set Bundle ID + signing team.
- [ ] **[YOU]** Prefer bundling assets locally + real native plugins (Camera/Push) to clear Guideline 4.2.
- [ ] **[YOU]** Archive → App Store Connect → App Privacy → submit for review.

## 7. Post-submission
- [ ] **[YOU]** Respond to any reviewer notes (4.2 minimum-functionality and 4.8 Sign in with Apple are the usual iOS snags — both are addressed above).
- [ ] **[YOU]** After approval, flip production rollout and monitor crash/vitals dashboards.

---

### Notes on what's NOT required
- You do **not** need to rewrite the app natively — the wrappers reuse the existing PWA.
- You do **not** need separate codebases — one PWA feeds both stores.
- Push works on Android via the TWA; on iOS it needs Capacitor Push (APNs) wiring if you want native push beyond web push.
