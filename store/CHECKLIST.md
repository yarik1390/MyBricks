# Brickvault — App Store submission checklist

Ordered, end-to-end. Legend: **[DONE]** shipped in the repo · **[YOU]** needs your
account / Mac / decision · **[REVIEW]** drafted, review before publishing.

---

## 0. Prerequisites (do first)
- [ ] **[YOU]** Create a **Google Play Console** account — $25 one-time.
- [ ] **[YOU]** Create an **Apple Developer Program** account — $99/year.
- [ ] **[YOU]** Have a **Mac with Xcode** available (or a macOS CI: Codemagic, Xcode Cloud, EAS).
- [ ] **[YOU]** Decide the reverse-DNS **app id**. Repo scaffolds use `app.brickvault` — keep or change consistently across `assetlinks.json`, `twa-manifest.json`, `capacitor.config.json`.

## 1. Hard store blockers
- [x] **[DONE]** In-app **account deletion** — `DELETE /api/me` + Me-tab "Delete account" (both stores require this).
- [ ] **[YOU]** Set `SUPABASE_SERVICE_ROLE_KEY` as a Worker secret so deletion also removes the Supabase auth identity (not just data). `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`
- [x] **[DONE]** **Sign in with Apple** button (gated behind `apple_signin`).
- [ ] **[YOU]** Configure the **Apple provider in Supabase** (Apple Developer Service ID + key + return URL), then set Worker env `APPLE_SIGNIN_ENABLED=1` to reveal the button. Required for iOS (Guideline 4.8).

## 2. Legal & privacy
- [ ] **[REVIEW]** `public/privacy.html` — confirm contact email (`support@brickvault.app` placeholder), owner name, and date.
- [ ] **[REVIEW]** `public/terms.html` — confirm contact, governing-law section, date.
- [x] **[DONE]** Both linked from the Me-tab footer.
- [ ] **[YOU]** Host the privacy policy at a stable public URL (already will be `https://brickvault-5ub.pages.dev/privacy.html`) — you'll paste this into both store listings.
- [ ] **[YOU]** Complete **Google Play Data Safety** and **Apple App Privacy** forms — answers drafted in `listing.md`.

## 3. Payments decision (before you submit)
- [ ] **[YOU]** Decide how the **supporter tier** is offered:
  - If a digital benefit is **purchased inside the app** → Apple requires **In-App Purchase** (StoreKit, ~30%) and Google requires **Play Billing**.
  - If it stays **fully external** (Patreon on the web, no in-app upgrade prompt/link that unlocks features) → allowed, but do not show in-app buttons that lead to external digital purchase on iOS. Reader/external-link rules are strict.
  - Simplest path to approval: keep supporter status out of the app-store builds, or gate the Patreon card off on native.

## 4. Assets
- [x] **[DONE]** App icons: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `icon.svg`.
- [ ] **[YOU]** **Screenshots** (real device or emulator, with your data):
  - Google Play: 2–8 phone screenshots (min 320px, 16:9 or 9:16); optional 7"/10" tablet; **feature graphic 1024×500**.
  - Apple: 6.7" (1290×2796) and 6.5" (1242×2688) iPhone sets; 12.9" iPad if you support iPad.
- [ ] **[YOU]** Short & full descriptions, keywords — draft in `listing.md`.
- [ ] **[YOU]** Content/age rating questionnaire (Play IARC; Apple age rating).

## 5. Google Play — build & submit (TWA)
- [ ] **[YOU]** `bubblewrap init --manifest https://brickvault-5ub.pages.dev/manifest.json` (see README).
- [ ] **[YOU]** Paste the printed **SHA-256 fingerprint** into `public/.well-known/assetlinks.json` and deploy; verify it's live.
- [ ] **[YOU]** `bubblewrap build` → upload the `.aab` to Play Console.
- [ ] **[YOU]** Fill listing + Data Safety + rating → internal testing → production.

## 6. Apple App Store — build & submit (Capacitor)
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
