import { toast, setBtnLoading, escapeHtml } from '../utils.js';
import { _sbUrl, sbSignIn, sbSignUp, sbRecover, sbSetPassword, saveSession, snapshotGuestVault, migrateGuestVault, readRecoveryGrant, clearRecoveryGrant, installRecoverySession } from '../api.js';
import { state } from '../state.js';
import { go } from '../router.js';
import { promptSheet, showSheet, hideSheet } from '../components/sheet.js';
import { authRedirectUrlForPlatform, buildSupabaseProviderAuthUrl, isNativeCapacitor, openNativeAuthUrl } from '../lib/native-auth.js';
import { t, tPlural } from '../lib/i18n.js';

// First sign-in (or first guest start) continues into the Welcome flow; after
// that, straight to the Vault. bv_setup_v1 marks the first run as done.
function afterAuthHash() {
  try { return localStorage.getItem('bv_setup_v1') ? '#/' : '#/welcome'; } catch { return '#/'; }
}

// When auth can't run because _sbUrl is empty, distinguish "the API was
// blocked/unreachable" (state.configError, set during boot) from a genuine
// server misconfiguration, so the user gets an actionable message.
const authUnavailableMsg = () => state.configError
  ? "Can't reach the server — an ad-blocker or privacy extension may be blocking it. Disable it for this site, or try another browser."
  : "Auth not configured";

// Cloudflare Turnstile script loader (shared across repaints; loads once).
let _tsScriptReady = null;
function ensureTurnstileScript() {
  if (_tsScriptReady) return _tsScriptReady;
  _tsScriptReady = new Promise((resolve, reject) => {
    if (window.turnstile) return resolve();
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Turnstile failed to load"));
    document.head.appendChild(s);
  });
  return _tsScriptReady;
}

// Password recovery. The grant is parked by consumeOAuthHash (app.js) because a
// recovery link is not a sign-in transaction this tab started; nothing is
// installed and no guest vault is migrated until the user actually sets a
// password here. Returns silently when no valid grant is parked.
async function openRecoverySheet() {
  const grant = readRecoveryGrant();
  if (!grant) return;
  showSheet(`
    <h2 class="u-serif-h" style="margin:0 4px 10px;">Set a new password</h2>
    <p style="color:var(--ink-mute);font-size:13px;margin:0 4px 12px;">Opened from your reset link. Choose a new password for your account.</p>
    <label class="field-lbl" for="recPass">New password</label>
    <input class="field-input" id="recPass" type="password" autocomplete="new-password">
    <label class="field-lbl" for="recPass2" style="margin-top:10px;">Confirm password</label>
    <input class="field-input" id="recPass2" type="password" autocomplete="new-password">
    <div id="recErr" style="color:var(--ink-mute);font-size:13px;min-height:18px;margin-top:8px;"></div>
    <button class="btn-primary" id="recSave" style="margin-top:6px;">Save new password</button>
    <button class="btn-secondary" id="recCancel" style="margin-top:8px;">Cancel</button>`);
  const errEl = () => document.getElementById("recErr");
  const save = async () => {
    const p1 = document.getElementById("recPass")?.value || "";
    const p2 = document.getElementById("recPass2")?.value || "";
    const btn = document.getElementById("recSave");
    if (p1.length < 6) { if (errEl()) errEl().textContent = "Use at least 6 characters."; return; }
    if (p1 !== p2) { if (errEl()) errEl().textContent = "Those passwords don't match."; return; }
    setBtnLoading(btn, true);
    try {
      await sbSetPassword(grant.access_token, p1);
      clearRecoveryGrant();
      installRecoverySession(grant);
      hideSheet();
      toast("Password updated — you're signed in", "success");
      const nav = document.getElementById("nav");
      if (nav) nav.style.display = "";
      document.body.classList.remove("nav-hidden");
      go("#/");
    } catch (e) {
      setBtnLoading(btn, false);
      if (errEl()) errEl().textContent = e?.message || "Couldn't set the new password";
    }
  };
  document.getElementById("recSave")?.addEventListener("click", save);
  document.getElementById("recPass2")?.addEventListener("keydown", e => { if (e.key === "Enter") save(); });
  document.getElementById("recCancel")?.addEventListener("click", hideSheet);
}

export function renderLogin() {
  let mode = "signin";
  const nav = document.getElementById("nav");
  if (nav) nav.style.display = "none";
  // The body reserves bottom-nav space; without the nav that's a blank band.
  document.body.classList.add("nav-hidden");
  window.scrollTo(0, 0);
  try {
    const s = JSON.parse(localStorage.getItem("bv_session") || "null");
    if (s?.expires_at && !s.refresh_token && Date.now() / 1000 > Number(s.expires_at) + 60) {
      saveSession(null, { preserveGuestFigs: true });
    }
  } catch {
    saveSession(null, { preserveGuestFigs: true });
  }

  // Turnstile bot protection on the login form. Opt-in: only when the server
  // advertises a site key (/api/config). The token is passed to GoTrue and is
  // ignored unless Supabase CAPTCHA protection is enabled, so logins keep
  // working until that's switched on.
  const siteKey = state.config && state.config.turnstile_site_key;
  // Sign in with Apple — only shown when the server advertises it (Apple provider
  // configured in Supabase). Apple requires this alongside Google on iOS (4.8).
  const appleOn = !!(state.config && state.config.apple_signin);
  let captchaToken = null;
  let tsWidgetId = null;
  async function mountTurnstile() {
    if (!siteKey) return;
    const host = document.getElementById("authTurnstile");
    if (!host) return;
    try {
      await ensureTurnstileScript();
      if (!window.turnstile) return;
      captchaToken = null;
      tsWidgetId = window.turnstile.render(host, {
        sitekey: siteKey,
        callback: (tok) => { captchaToken = tok; },
        "expired-callback": () => { captchaToken = null; },
        "error-callback": () => { captchaToken = null; },
      });
    } catch {}
  }
  // Current token, briefly waiting for the managed widget to auto-solve.
  async function awaitCaptcha(maxMs = 6000) {
    if (!siteKey || captchaToken) return captchaToken;
    const start = Date.now();
    while (!captchaToken && Date.now() - start < maxMs) {
      await new Promise(r => setTimeout(r, 200));
    }
    return captchaToken;
  }
  // Tokens are single-use — refresh after each auth attempt so a retry works.
  const resetCaptcha = () => {
    captchaToken = null;
    try { if (tsWidgetId != null && window.turnstile) window.turnstile.reset(tsWidgetId); } catch {}
  };

  // Canvas: Login. Providers first, email on request, and a guest path that
  // says plainly where a guest vault lives.
  let emailOpen = false;
  const googleMark = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>`;
  const appleMark = `<svg width="16" height="18" viewBox="0 0 16 18" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M13.09 9.55c-.02-1.9 1.55-2.81 1.62-2.86-.88-1.29-2.26-1.47-2.75-1.49-1.17-.12-2.28.69-2.87.69-.59 0-1.5-.67-2.47-.66-1.27.02-2.44.74-3.09 1.88-1.32 2.29-.34 5.68.95 7.54.63.91 1.38 1.93 2.36 1.9.95-.04 1.31-.61 2.46-.61 1.14 0 1.47.61 2.47.59 1.02-.02 1.67-.93 2.29-1.85.72-1.06 1.02-2.09 1.04-2.14-.02-.01-1.99-.76-2.01-3.02zM11.2 3.86c.52-.63.87-1.51.78-2.39-.75.03-1.66.5-2.2 1.13-.48.56-.9 1.45-.79 2.31.84.06 1.69-.42 2.21-1.05z"/>
              </svg>`;
  const agreeHTML = () => {
    const raw = escapeHtml(t('bvFirst.loginAgree', { terms: '\u0001', privacy: '\u0002' }));
    return raw
      .replace('\u0001', `<button type="button" class="bv-login__legal" data-legal-sheet="terms">${escapeHtml(t('bvFirst.terms'))}</button>`)
      .replace('\u0002', `<button type="button" class="bv-login__legal" data-legal-sheet="privacy">${escapeHtml(t('bvFirst.privacy'))}</button>`);
  };
  const emailFormHTML = () => `
          <div class="bv-login__email" id="authEmailBox">
            <h2 class="bv-login__h2">${mode === "signin" ? "Sign in" : "Create account"}</h2>
            <div class="bv-field"><div class="bv-field__box"><input type="email" id="authEmail" placeholder="Email address" aria-label="Email address" autocomplete="email"></div></div>
            <div class="bv-field"><div class="bv-field__box"><input type="password" id="authPass" placeholder="Password" aria-label="Password"
              autocomplete="${mode === "signin" ? "current-password" : "new-password"}"></div></div>
            ${siteKey ? `<div id="authTurnstile" class="bv-login__captcha"></div>` : ""}
            <button type="button" class="bv-btn bv-btn--primary bv-btn--full bv-btn--lg" id="authSubmit">
              <span>${mode === "signin" ? "Sign in" : "Create account"}</span>
            </button>
            <div id="authErr" class="bv-login__err" role="alert" aria-live="assertive"></div>
            <div class="bv-login__emailfoot">
              ${mode === "signin" ? `<button type="button" id="authForgot" class="bv-login__link">Forgot password?</button>` : ""}
              <span>${mode === "signin" ? "Don't have an account?" : "Already have an account?"}
                <button type="button" id="authSwitch" class="bv-login__link bv-login__link--strong">${mode === "signin" ? "Sign up" : "Sign in"}</button></span>
            </div>
          </div>`;

  const paint = () => {
    document.getElementById("root").innerHTML = `
      <main class="bv-login login-view" aria-labelledby="loginTitle">
        <div class="bv-login__hero">
          <span class="bv-login__mark" aria-hidden="true"><svg viewBox="0 0 40 32" width="40" height="32"><rect x="7" y="0" width="9" height="7" rx="2" fill="#c8431f"/><rect x="24" y="0" width="9" height="7" rx="2" fill="#c8431f"/><rect x="0" y="5" width="40" height="27" rx="4" fill="#c8431f"/></svg></span>
          <h1 class="bv-login__title" id="loginTitle">${escapeHtml(t('bvFirst.loginTitle'))}</h1>
          <p class="bv-login__sub">${escapeHtml(t('bvFirst.loginSub'))}</p>
        </div>
        <div class="bv-login__actions">
          <button type="button" id="googleSignIn" class="bv-btn bv-btn--ink bv-btn--full bv-btn--lg bv-login__provider">${googleMark}<span>${escapeHtml(t('bvFirst.loginGoogle'))}</span></button>
          ${appleOn ? `<button type="button" id="appleSignIn" class="bv-btn bv-btn--outline bv-btn--full bv-btn--lg bv-login__provider">${appleMark}<span>${escapeHtml(t('bvFirst.loginApple'))}</span></button>` : ""}
          ${emailOpen ? emailFormHTML() : `<button type="button" id="authEmailToggle" class="bv-btn bv-btn--outline bv-btn--full bv-btn--lg" aria-expanded="false" aria-controls="authEmailBox"><span>${escapeHtml(t('bvFirst.loginEmail'))}</span></button>`}
          <button type="button" id="authGuest" class="bv-btn bv-btn--text bv-btn--full bv-login__guest"><span>${escapeHtml(t('bvFirst.loginGuest'))}</span></button>
          <p class="bv-login__note">${escapeHtml(t('bvFirst.loginGuestNote'))} ${agreeHTML()}</p>
        </div>
      </main>`;

    document.getElementById("authEmailToggle")?.addEventListener("click", () => {
      emailOpen = true;
      paint();
      document.getElementById("authEmail")?.focus();
    });
    document.querySelectorAll("#root [data-legal-sheet]").forEach((el) => el.addEventListener("click", async () => {
      const { openLegalSheet } = await import("../components/legal-sheet.js");
      openLegalSheet(el.dataset.legalSheet);
    }));

    document.getElementById("authSwitch")?.addEventListener("click", () => {
      mode = mode === "signin" ? "signup" : "signin";
      paint();
    });

    document.getElementById("authForgot")?.addEventListener("click", async () => {
      if (!_sbUrl) { toast(authUnavailableMsg(), "error"); return; }
      const prefill = document.getElementById("authEmail")?.value.trim() || "";
      const email = await promptSheet({ title: "Reset password", label: "Email address", value: prefill, placeholder: "you@example.com", confirmLabel: "Send reset link" });
      if (!email) return;
      try {
        await sbRecover(email, await awaitCaptcha());
        toast("Reset link sent — check your email", "success");
        resetCaptcha();
      } catch (e) {
        toast(e.message, "error");
      }
    });

    async function startProviderSignIn(provider) {
      if (!_sbUrl) { toast(authUnavailableMsg(), "error"); return; }
      const guestSnapshot = snapshotGuestVault();
      if (guestSnapshot.collection?.length || guestSnapshot.wishlist?.length || guestSnapshot.ownedFigs?.length) {
        try { sessionStorage.setItem("bv_pending_guest_migration", JSON.stringify(guestSnapshot)); } catch {}
      }
      // Bind the returned credentials to this specific authorization request.
      // A timestamp alone does not stop an attacker from substituting a token
      // while a legitimate provider sign-in is pending.
      let nonce;
      try {
        nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
        sessionStorage.setItem("bv_pending_signin", JSON.stringify({ provider, startedAt: Date.now(), nonce }));
      } catch {
        toast("Secure sign-in is unavailable in this browser", "error");
        return;
      }
      const redirect = new URL(authRedirectUrlForPlatform());
      redirect.searchParams.set('auth_state', nonce);
      const authUrl = buildSupabaseProviderAuthUrl(_sbUrl, provider, redirect.toString());
      if (isNativeCapacitor()) {
        try {
          if (await openNativeAuthUrl(authUrl)) return;
        } catch (e) {
          toast(e?.message || "Could not open secure sign-in", "error");
        }
      }
      location.href = authUrl;
    }
    document.getElementById("googleSignIn")?.addEventListener("click", () => { startProviderSignIn("google"); });
    document.getElementById("appleSignIn")?.addEventListener("click", () => { startProviderSignIn("apple"); });
    document.getElementById("authGuest")?.addEventListener("click", () => {
      saveSession(null, { preserveGuestFigs: true });
      if (nav) nav.style.display = "";
      document.body.classList.remove("nav-hidden");
      go(afterAuthHash());
    });

    const submit = async () => {
      const email = document.getElementById("authEmail")?.value.trim() || "";
      const pass = document.getElementById("authPass")?.value || "";
      const btn = document.getElementById("authSubmit");
      const errEl = document.getElementById("authErr");
      if (!email || !pass) { if (errEl) errEl.textContent = "Email and password required."; return; }
      if (!_sbUrl) { if (errEl) errEl.textContent = authUnavailableMsg(); return; }
      setBtnLoading(btn, true);
      if (errEl) errEl.textContent = "";
      try {
        const guestSnapshot = snapshotGuestVault();
        const captcha = await awaitCaptcha();
        let session;
        if (mode === "signin") {
          session = await sbSignIn(email, pass, captcha);
        } else {
          session = await sbSignUp(email, pass, captcha);
          if (!session.access_token) {
            // Persistent success panel — no disorienting auto-switch.
            setBtnLoading(btn, false);
            const card = btn?.closest(".bv-login__email");
            if (card) {
              card.innerHTML = `
                <div class="bv-login__done">
                  <div class="bv-login__donetitle">Account created ✓</div>
                  <div class="bv-login__donebody">
                    We sent a confirmation link to <strong>${email.replace(/</g, "&lt;")}</strong>.
                    Confirm your email, then sign in.
                  </div>
                  <button type="button" class="bv-btn bv-btn--primary bv-btn--full" id="gotoSignin">Go to sign in</button>
                </div>`;
              document.getElementById("gotoSignin")?.addEventListener("click", () => { mode = "signin"; paint(); });
            }
            return;
          }
        }
        saveSession(session, { preserveGuestFigs: true });
        const migrated = await migrateGuestVault(guestSnapshot);
        if (migrated.migrated) toast(tPlural('common.localItemsSynced', migrated.migrated), "success");
        if (migrated.errors?.length) {
          // Keep the snapshot so the user can retry from You → Data instead of
          // silently losing whichever local items didn't make it across.
          try { localStorage.setItem("bv_failed_guest_migration", JSON.stringify(guestSnapshot)); } catch {}
          toast("Some local items couldn't sync — retry from You → Data", "error");
        }
        if (nav) nav.style.display = "";
        document.body.classList.remove("nav-hidden");
        go(afterAuthHash());
      } catch (e) {
        if (errEl) errEl.textContent = e.message;
        setBtnLoading(btn, false);
        resetCaptcha(); // single-use token — refresh for the next attempt
      }
    };

    document.getElementById("authSubmit")?.addEventListener("click", submit);
    document.getElementById("authPass")?.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
    mountTurnstile();
  };

  paint();

  // A password-recovery link parked a grant (consumeOAuthHash in app.js) — offer
  // to set a new password instead of leaving the user on a bare sign-in form.
  if (readRecoveryGrant()) setTimeout(() => { openRecoverySheet(); }, 0);
}
