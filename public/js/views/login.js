import { $, toast, setBtnLoading } from '../utils.js';
import { _sbUrl, sbSignIn, sbSignUp, saveSession } from '../api.js';

export function renderLogin() {
  let mode = "signin";
  const nav = document.getElementById("nav");
  if (nav) nav.style.display = "none";

  const paint = () => {
    document.getElementById("root").innerHTML = `
      <div class="page" style="max-width:420px;margin:0 auto;padding-top:48px;">
        <div style="text-align:center;margin-bottom:32px;">
          <div style="font-family:var(--serif);font-size:30px;font-weight:600;margin-bottom:6px;">Brickvault</div>
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
            <button class="btn-primary" id="authSubmit" style="margin-top:4px;">
              <span>${mode === "signin" ? "Sign in" : "Create account"}</span>
            </button>
            <div id="authErr" style="color:var(--down);font-size:13px;text-align:center;min-height:18px;font-family:var(--mono);"></div>
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
          </div>
        </div>
        <div style="text-align:center;margin-top:16px;font-size:13px;color:var(--ink-mute);">
          ${mode === "signin" ? "Don't have an account?" : "Already have an account?"}
          <button id="authSwitch" style="color:var(--accent);background:none;border:none;font-size:13px;font-weight:600;cursor:pointer;padding:0 4px;">
            ${mode === "signin" ? "Sign up" : "Sign in"}
          </button>
        </div>
      </div>`;

    document.getElementById("authSwitch").addEventListener("click", () => {
      mode = mode === "signin" ? "signup" : "signin";
      paint();
    });

    document.getElementById("googleSignIn")?.addEventListener("click", () => {
      if (!_sbUrl) { toast("Auth not configured", "error"); return; }
      const redirectTo = encodeURIComponent(location.origin + location.pathname);
      location.href = `${_sbUrl}/auth/v1/authorize?provider=google&redirect_to=${redirectTo}&prompt=select_account`;
    });

    const submit = async () => {
      const email = document.getElementById("authEmail")?.value.trim() || "";
      const pass = document.getElementById("authPass")?.value || "";
      const btn = document.getElementById("authSubmit");
      const errEl = document.getElementById("authErr");
      if (!email || !pass) { if (errEl) errEl.textContent = "Email and password required."; return; }
      setBtnLoading(btn, true);
      if (errEl) errEl.textContent = "";
      try {
        let session;
        if (mode === "signin") {
          session = await sbSignIn(email, pass);
        } else {
          session = await sbSignUp(email, pass);
          if (!session.access_token) {
            if (errEl) errEl.textContent = "Account created! Check your email to confirm, then sign in.";
            setBtnLoading(btn, false);
            setTimeout(() => { mode = "signin"; paint(); }, 2000);
            return;
          }
        }
        saveSession(session);
        if (nav) nav.style.display = "";
        location.hash = "#/";
      } catch (e) {
        if (errEl) errEl.textContent = e.message;
        setBtnLoading(btn, false);
      }
    };

    document.getElementById("authSubmit")?.addEventListener("click", submit);
    document.getElementById("authPass")?.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
  };

  paint();
}
