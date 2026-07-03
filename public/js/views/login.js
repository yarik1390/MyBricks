import { toast, setBtnLoading } from '../utils.js';
import { _sbUrl, sbSignIn, sbSignUp, sbRecover, saveSession, snapshotGuestVault, migrateGuestVault } from '../api.js';
import { state } from '../state.js';
import { go } from '../router.js';
import { promptSheet } from '../components/sheet.js';

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

export function renderLogin() {
  let mode = "signin";
  const nav = document.getElementById("nav");
  if (nav) nav.style.display = "none";
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

  const paint = () => {
    document.getElementById("root").innerHTML = `
      <div class="page" style="max-width:420px;margin:0 auto;padding-top:48px;">
        <div style="text-align:center;margin-bottom:32px;">
          <div style="font-family:var(--serif);font-size:30px;font-weight:600;margin-bottom:6px;">BricksVault</div>
          <div style="color:var(--ink-mute);font-size:14px;">Your brick portfolio, always in hand.</div>
        </div>
        <div class="card" style="padding:24px;">
          <div class="section-title" style="margin-bottom:16px;">${mode === "signin" ? "Sign in" : "Create account"}</div>
          <div style="display:flex;flex-direction:column;gap:12px;">
            <input type="email" id="authEmail" placeholder="Email address" autocomplete="email"
              style="padding:12px;border:1.5px solid var(--line);border-radius:var(--r-2);background:var(--surface-2);color:var(--ink);font-size:15px;outline:none;font-family:var(--sans);">
            <input type="password" id="authPass" placeholder="Password"
              autocomplete="${mode === "signin" ? "current-password" : "new-password"}"
              style="padding:12px;border:1.5px solid var(--line);border-radius:var(--r-2);background:var(--surface-2);color:var(--ink);font-size:15px;outline:none;font-family:var(--sans);">
            ${siteKey ? `<div id="authTurnstile" style="display:flex;justify-content:center;margin-top:4px;min-height:65px;"></div>` : ""}
            <button class="btn-primary" id="authSubmit" style="margin-top:4px;">
              <span>${mode === "signin" ? "Sign in" : "Create account"}</span>
            </button>
            <div id="authErr" role="alert" aria-live="assertive" style="color:var(--down);font-size:13px;text-align:center;min-height:18px;font-family:var(--mono);"></div>
            ${mode === "signin" ? `
            <button id="authForgot" style="color:var(--ink-mute);background:none;border:none;font-size:12px;cursor:pointer;text-decoration:underline;align-self:center;padding:10px 8px;min-height:44px;">Forgot password?</button>` : ""}
            <div style="display:flex;align-items:center;gap:10px;margin-top:4px;">
              <div style="flex:1;height:1px;background:var(--line);"></div>
              <div style="font-size:12px;color:var(--ink-mute);white-space:nowrap;">or</div>
              <div style="flex:1;height:1px;background:var(--line);"></div>
            </div>
            <button id="googleSignIn" class="btn-secondary" style="width:100%;gap:10px;justify-content:center;">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              <span>Continue with Google</span>
            </button>
            ${appleOn ? `
            <button id="appleSignIn" class="btn-secondary" style="width:100%;gap:10px;justify-content:center;">
              <svg width="16" height="18" viewBox="0 0 16 18" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M13.09 9.55c-.02-1.9 1.55-2.81 1.62-2.86-.88-1.29-2.26-1.47-2.75-1.49-1.17-.12-2.28.69-2.87.69-.59 0-1.5-.67-2.47-.66-1.27.02-2.44.74-3.09 1.88-1.32 2.29-.34 5.68.95 7.54.63.91 1.38 1.93 2.36 1.9.95-.04 1.31-.61 2.46-.61 1.14 0 1.47.61 2.47.59 1.02-.02 1.67-.93 2.29-1.85.72-1.06 1.02-2.09 1.04-2.14-.02-.01-1.99-.76-2.01-3.02zM11.2 3.86c.52-.63.87-1.51.78-2.39-.75.03-1.66.5-2.2 1.13-.48.56-.9 1.45-.79 2.31.84.06 1.69-.42 2.21-1.05z"/>
              </svg>
              <span>Continue with Apple</span>
            </button>` : ""}
            <button id="authGuest" class="btn-secondary" style="width:100%;gap:10px;justify-content:center;">
              <span>Continue as guest</span>
            </button>
            <div style="font-size:11px;color:var(--ink-mute);line-height:1.45;text-align:center;">
              Guest data stays on this device. Sign in later to sync your vault and wishlist.
            </div>
          </div>
        </div>
        <div style="text-align:center;margin-top:16px;font-size:13px;color:var(--ink-mute);">
          ${mode === "signin" ? "Don't have an account?" : "Already have an account?"}
          <button id="authSwitch" style="color:var(--accent);background:none;border:none;font-size:13px;font-weight:600;cursor:pointer;padding:0 4px;">
            ${mode === "signin" ? "Sign up" : "Sign in"}
          </button>
        </div>
      </div>`;

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

    document.getElementById("googleSignIn")?.addEventListener("click", () => {
      if (!_sbUrl) { toast(authUnavailableMsg(), "error"); return; }
      const guestSnapshot = snapshotGuestVault();
      if (guestSnapshot.collection?.length || guestSnapshot.wishlist?.length || guestSnapshot.ownedFigs?.length) {
        try { sessionStorage.setItem("bv_pending_guest_migration", JSON.stringify(guestSnapshot)); } catch {}
      }
      const redirectTo = encodeURIComponent(location.origin + location.pathname);
      location.href = `${_sbUrl}/auth/v1/authorize?provider=google&redirect_to=${redirectTo}&prompt=select_account`;
    });
    document.getElementById("appleSignIn")?.addEventListener("click", () => {
      if (!_sbUrl) { toast(authUnavailableMsg(), "error"); return; }
      const guestSnapshot = snapshotGuestVault();
      if (guestSnapshot.collection?.length || guestSnapshot.wishlist?.length || guestSnapshot.ownedFigs?.length) {
        try { sessionStorage.setItem("bv_pending_guest_migration", JSON.stringify(guestSnapshot)); } catch {}
      }
      const redirectTo = encodeURIComponent(location.origin + location.pathname);
      location.href = `${_sbUrl}/auth/v1/authorize?provider=apple&redirect_to=${redirectTo}`;
    });
    document.getElementById("authGuest")?.addEventListener("click", () => {
      saveSession(null, { preserveGuestFigs: true });
      if (nav) nav.style.display = "";
      go("#/");
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
            const card = btn?.closest(".card");
            if (card) {
              card.innerHTML = `
                <div style="text-align:center;padding:8px 4px;">
                  <div style="font-size:15px;font-weight:600;color:var(--up);margin-bottom:8px;">Account created ✓</div>
                  <div style="font-size:13px;color:var(--ink-mute);line-height:1.5;margin-bottom:16px;">
                    We sent a confirmation link to <strong>${email.replace(/</g, "&lt;")}</strong>.
                    Confirm your email, then sign in.
                  </div>
                  <button class="btn-primary" id="gotoSignin" style="width:100%;">Go to sign in</button>
                </div>`;
              document.getElementById("gotoSignin")?.addEventListener("click", () => { mode = "signin"; paint(); });
            }
            return;
          }
        }
        saveSession(session, { preserveGuestFigs: true });
        const migrated = await migrateGuestVault(guestSnapshot);
        if (migrated.migrated) toast(`Synced ${migrated.migrated} local item${migrated.migrated === 1 ? "" : "s"}`, "success");
        if (migrated.errors?.length) toast("Some local items couldn't sync", "error");
        if (nav) nav.style.display = "";
        go("#/");
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
}
