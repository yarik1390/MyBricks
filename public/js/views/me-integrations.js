import { $, haptic, escapeHtml, toast, setBtnLoading } from '../utils.js';
import { state, invalidatePortfolio } from '../state.js';
import { api, isGuestMode } from '../api.js';
import { I } from '../icons.js';
import { confirmSheet } from '../components/sheet.js';
import { go } from '../router.js';
import { subpageTopbarHTML, loadMe } from './me-shared.js';
import { skelPage, skelSettingRows } from '../components/skeleton.js';

export async function renderMeIntegrations() {
  // OAuth return from Google lands here with a query param.
  if (location.hash.includes("google_sync=success")) {
    toast("Google Sheets connected successfully!", "success");
    history.replaceState(null, "", "#/me/integrations");
  } else if (location.hash.includes("google_sync=error")) {
    toast("Failed to connect Google Sheets", "error");
    history.replaceState(null, "", "#/me/integrations");
  }

  if (!state.me) $("#root").innerHTML = skelPage(skelSettingRows(5));
  const me = await loadMe();
  const guest = isGuestMode();
  const googleStatus = await api("/api/google/status").catch(() => ({ connected: false, spreadsheet_id: null }));
  const googleConfigured = googleStatus.configured ?? false;
  const googleSetup = state.config?.setup?.google || {};
  const googleMissing = Array.isArray(googleSetup.missing_secrets) ? googleSetup.missing_secrets : ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
  const googleSetupMessage = googleSetup.recommended_action
    || `Missing Worker secrets: ${googleMissing.join(", ")}. Add them as GitHub Actions secrets and redeploy to enable account linking.`;
  const savedGeminiKey = localStorage.getItem('bv_gemini_key') || '';
  const savedOpenAIKey = localStorage.getItem('bv_openai_key') || '';

  $("#root").innerHTML = `
    <div class="page">
      ${subpageTopbarHTML("Connected services", "Integrations")}

      <div class="section-title">Google Sheets Sync</div>
      <div>
        <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
          <div class="lbl-wrap">
            <div class="lbl">Google Sheets Auto-Sync</div>
            <div class="desc">Keep your spreadsheet "MyBricks Vault" in sync in the background.</div>
          </div>
          ${googleStatus.connected ? `
            <div class="u-col u-wfull">
              <div class="u-row u-fs-sm u-up" style="font-weight:600;">
                <span style="display:inline-block;width:8px;height:8px;background:var(--up);border-radius:50%;"></span>
                Connected to Google Sheets
              </div>
              ${googleStatus.spreadsheet_id ? `
                <div class="u-fs-xs u-mute">
                  Spreadsheet ID: <a href="https://docs.google.com/spreadsheets/d/${googleStatus.spreadsheet_id}" target="_blank" rel="noopener" style="text-decoration:underline;color:var(--ink);">${googleStatus.spreadsheet_id.slice(0, 16)}...</a>
                </div>
              ` : ''}
              <div class="u-row u-wfull u-mt-1">
                <button class="btn-secondary u-flex1" id="syncGoogleNowBtn" style="font-size:12px;padding:8px 12px;">Sync Now</button>
                <button class="btn-secondary" id="disconnectGoogleBtn" style="color:var(--bv-red);font-size:12px;padding:8px 12px;">Disconnect</button>
              </div>
            </div>
          ` : !googleConfigured ? `
            <div class="u-wfull u-fs-sm u-mute" style="border:var(--bw-thin) solid var(--border-soft-c);border-radius:var(--r-2);background:var(--surface-2);padding:10px 12px;line-height:1.45;">
              Google Sheets is disabled until OAuth is configured. ${escapeHtml(googleSetupMessage)}
            </div>
          ` : `
            <button class="btn-primary u-wfull" id="connectGoogleBtn" style="font-size:13px;padding:10px 14px;background:#4285F4;border-color:#4285F4;color:#fff;">
              ${I.extLink()} <span>Connect Google Sheets</span>
            </button>
          `}
        </div>
      </div>

      <div class="section-title">Discord Alerts</div>
      <div>
        <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
          <div class="lbl-wrap"><div class="lbl">Discord webhook</div><div class="desc">Post price-drop and spike alerts to a Discord channel.</div></div>
          <div class="u-row u-wfull">
            <input id="discordWebhook" type="url" placeholder="https://discord.com/api/webhooks/…" value="${me.discord_webhook_url ? escapeHtml(me.discord_webhook_url) : ""}" class="u-flex1 u-fs-sm" style="font-family:var(--mono);border:1px solid var(--border-c);border-radius:var(--r-1);padding:6px 10px;background:var(--surface-2);color:var(--ink);outline:none;" autocomplete="off" spellcheck="false" />
            <button id="discordWebhookSave" class="btn-secondary u-fs-sm" style="padding:6px 12px;white-space:nowrap;">Save</button>
            ${me.discord_webhook_url ? `<button id="discordWebhookClear" class="btn-secondary u-fs-sm" style="padding:6px 12px;color:var(--down);">Clear</button>` : ""}
          </div>
        </div>
      </div>

      <div class="section-title">Push Notifications</div>
      <div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Push notifications</div><div class="desc">Receive price alerts on your device even when the app is closed.</div></div>
          <button class="btn-secondary u-fs-sm" id="pushNotifBtn" style="padding:6px 12px;" data-push-state="unknown">Enable</button>
        </div>
      </div>

      <div class="section-title">Brickset Collection Sync</div>
      <div>
        <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
          <div class="lbl-wrap">
            <div class="lbl">Import from Brickset</div>
            <div class="desc">Sync sets you've marked as owned on Brickset.com into your vault.</div>
          </div>
          ${me.brickset_connected ? `
            <div class="u-col u-wfull">
              <div class="u-row u-fs-sm u-up" style="font-weight:600;">
                <span style="display:inline-block;width:8px;height:8px;background:var(--up);border-radius:50%;"></span>
                Brickset account connected
              </div>
              <div class="u-row u-wfull">
                <button id="bricksetSyncBtn" class="btn-secondary u-flex1 u-fs-sm" style="padding:8px 12px;">Sync Now</button>
                <button id="bricksetDisconnectBtn" class="btn-secondary u-fs-sm" style="padding:8px 12px;color:var(--down);">Disconnect</button>
              </div>
              <div id="bricksetSyncResult" class="u-fs-xs u-mute"></div>
            </div>
          ` : `
            <div class="u-col u-wfull">
              <input id="bricksetUsername" type="text" placeholder="Brickset username" autocomplete="username" class="u-wfull u-fs-base" style="border:1px solid var(--border-c);border-radius:var(--r-1);padding:8px 10px;background:var(--surface-2);color:var(--ink);outline:none;box-sizing:border-box;" />
              <input id="bricksetPassword" type="password" placeholder="Brickset password" autocomplete="current-password" class="u-wfull u-fs-base" style="border:1px solid var(--border-c);border-radius:var(--r-1);padding:8px 10px;background:var(--surface-2);color:var(--ink);outline:none;box-sizing:border-box;" />
              <button id="bricksetConnectBtn" class="btn-primary u-wfull" style="font-size:13px;padding:10px 14px;">Connect Brickset Account</button>
              <div id="bricksetConnectError" class="u-fs-xs u-down" style="display:none;"></div>
            </div>
          `}
        </div>
      </div>

      <div class="section-title">AI Scanning</div>
      <div>
        <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
          <div class="lbl-wrap">
            <div class="lbl">Gemini API key (free)</div>
            <div class="desc">${savedGeminiKey ? "Active - powers scans, advisor, listings, and valuation fallback on your Google quota" : 'Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="color:var(--bv-red);font-weight:600;text-decoration:underline;">aistudio.google.com/apikey</a> - bypasses shared AI limits'}</div>
          </div>
          <div class="u-row u-wfull">
            <input type="password" id="geminiKeyInput" value="${escapeHtml(savedGeminiKey)}" placeholder="AIza..."
              class="u-flex1 u-fs-base" style="padding:10px;border:var(--bw-thin) solid var(--border-c);border-radius:var(--r-2);background:var(--surface-2);color:var(--ink);font-family:var(--mono);outline:none;">
            <button class="btn-secondary" id="saveGeminiKey" style="white-space:nowrap;">Save</button>
          </div>
        </div>
        <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
          <div class="lbl-wrap">
            <div class="lbl">OpenAI key (optional)</div>
            <div class="desc">${savedOpenAIKey ? "Active - powers scans, advisor, and listing drafts with your key" : "Optional: use your own OpenAI key for scans, advisor, and listing drafts"}</div>
          </div>
          <div class="u-row u-wfull">
            <input type="password" id="openaiKeyInput" value="${escapeHtml(savedOpenAIKey)}" placeholder="sk-..."
              class="u-flex1 u-fs-base" style="padding:10px;border:var(--bw-thin) solid var(--border-c);border-radius:var(--r-2);background:var(--surface-2);color:var(--ink);font-family:var(--mono);outline:none;">
            <button class="btn-secondary" id="saveOpenAIKey" style="white-space:nowrap;">Save</button>
          </div>
        </div>
      </div>
    </div>`;

  // --- Google Sheets hooks (secure code-flow redirect) ---
  $("#connectGoogleBtn")?.addEventListener("click", async () => {
    haptic("light");
    if (guest) { go("#/login"); return; }
    try {
      const r = await api("/api/google/auth-init", { method: "POST" });
      if (r && r.code) {
        location.href = (window.WORKER_BASE || "") + "/api/google/auth?code=" + encodeURIComponent(r.code);
      } else {
        toast("Failed to initiate sync session", "error");
      }
    } catch (e) {
      toast("Error initiating sync: " + e.message, "error");
    }
  });

  $("#syncGoogleNowBtn")?.addEventListener("click", async () => {
    haptic("medium");
    const btn = $("#syncGoogleNowBtn");
    btn.disabled = true;
    btn.textContent = "Syncing...";
    try {
      await api("/api/google/sync", { method: "POST" });
      toast("Sync started in the background", "success");
      btn.textContent = "Sync Started";
    } catch (e) {
      toast("Error: " + e.message, "error");
      btn.textContent = "Sync Now";
      btn.disabled = false;
    }
  });

  $("#disconnectGoogleBtn")?.addEventListener("click", async () => {
    if (!(await confirmSheet({ title: "Disconnect Google Sheets?", message: "This stops auto-syncing. Your spreadsheet won't be deleted.", confirmLabel: "Disconnect", danger: true }))) return;
    try {
      await api("/api/google/disconnect", { method: "POST" });
      toast("Disconnected Google Sheets", "success");
      await renderMeIntegrations();
    } catch (e) {
      toast("Error: " + e.message, "error");
    }
  });

  // --- Discord hooks ---
  $("#discordWebhookSave")?.addEventListener("click", async () => {
    const val = ($("#discordWebhook")?.value || "").trim();
    if (val && !/^https:\/\/discord(app)?\.com\/api\/webhooks\//.test(val)) {
      toast("Enter a valid Discord webhook URL", "error"); return;
    }
    haptic("medium");
    try {
      await api("/api/me", { method: "PATCH", body: { discord_webhook_url: val || null } });
      state.me = null;
      toast(val ? "Discord alerts enabled" : "Discord alerts cleared", "success");
      await renderMeIntegrations();
    } catch (e) { toast("Error: " + e.message, "error"); }
  });

  $("#discordWebhookClear")?.addEventListener("click", async () => {
    haptic("medium");
    try {
      await api("/api/me", { method: "PATCH", body: { discord_webhook_url: null } });
      state.me = null;
      toast("Discord alerts cleared", "info");
      await renderMeIntegrations();
    } catch (e) { toast("Error: " + e.message, "error"); }
  });

  // --- Brickset hooks ---
  $("#bricksetConnectBtn")?.addEventListener("click", async () => {
    const user = ($("#bricksetUsername")?.value || "").trim();
    const pass = ($("#bricksetPassword")?.value || "").trim();
    if (!user || !pass) { toast("Enter Brickset username and password", "error"); return; }
    const errEl = $("#bricksetConnectError");
    if (errEl) errEl.style.display = "none";
    haptic("medium");
    const btn = $("#bricksetConnectBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Connecting…"; }
    try {
      await api("/api/brickset/login", { method: "POST", body: { username: user, password: pass } });
      state.me = null;
      toast("Brickset account connected", "success");
      await renderMeIntegrations();
    } catch (e) {
      if (errEl) { errEl.textContent = e.message; errEl.style.display = "block"; }
      toast("Brickset connect failed: " + e.message, "error");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Connect Brickset Account"; }
    }
  });

  $("#bricksetDisconnectBtn")?.addEventListener("click", async () => {
    haptic("medium");
    try {
      await api("/api/brickset/connect", { method: "DELETE" });
      state.me = null;
      toast("Brickset disconnected", "info");
      await renderMeIntegrations();
    } catch (e) { toast("Error: " + e.message, "error"); }
  });

  $("#bricksetSyncBtn")?.addEventListener("click", async () => {
    const btn = $("#bricksetSyncBtn");
    const resultEl = $("#bricksetSyncResult");
    if (btn) { btn.disabled = true; btn.textContent = "Syncing…"; }
    haptic("medium");
    try {
      const res = await api("/api/brickset/sync", { method: "POST" });
      if (resultEl) resultEl.textContent = `Imported ${res.added} sets (${res.skipped} not in catalog, ${res.total} total on Brickset).`;
      toast(`Brickset sync: ${res.added} sets added`, "success");
      invalidatePortfolio();
    } catch (e) {
      if (resultEl) resultEl.textContent = "Sync failed: " + e.message;
      toast("Brickset sync failed: " + e.message, "error");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Sync Now"; }
    }
  });

  // --- Push notification hooks ---
  const pushBtn = $("#pushNotifBtn");
  if (pushBtn && 'serviceWorker' in navigator && 'PushManager' in window) {
    (async () => {
      const perm = Notification.permission;
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
      if (perm === 'denied') {
        pushBtn.textContent = "Blocked";
        pushBtn.disabled = true;
      } else if (sub) {
        pushBtn.textContent = "Disable";
        pushBtn.dataset.pushState = "enabled";
      } else {
        pushBtn.textContent = "Enable";
        pushBtn.dataset.pushState = "disabled";
      }
    })();

    pushBtn.addEventListener("click", async () => {
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      if (!reg) { toast("Service worker not available", "error"); return; }
      const current = await reg.pushManager.getSubscription().catch(() => null);
      if (current || pushBtn.dataset.pushState === "enabled") {
        await current?.unsubscribe().catch(() => {});
        await api("/api/push/subscribe", { method: "DELETE", body: {} }).catch(() => {});
        pushBtn.textContent = "Enable";
        pushBtn.dataset.pushState = "disabled";
        toast("Push notifications disabled", "info");
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { toast("Notification permission denied", "error"); return; }
      try {
        const { publicKey } = await api("/api/push/vapid-key");
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKey,
        });
        const j = sub.toJSON();
        await api("/api/push/subscribe", {
          method: "POST",
          body: { endpoint: sub.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth },
        });
        pushBtn.textContent = "Disable";
        pushBtn.dataset.pushState = "enabled";
        haptic("medium");
        toast("Push notifications enabled", "success");
      } catch (e) { toast("Failed to enable push: " + e.message, "error"); }
    });
  } else if (pushBtn) {
    pushBtn.textContent = "Not supported";
    pushBtn.disabled = true;
  }

  // --- API key hooks — validate with a minimal live call before saving so a
  // bad or quota-exhausted key fails loudly here, not silently in the scanner.
  const validateApiKey = async (provider, key) => {
    const url = provider === 'gemini'
      ? `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=1`
      : 'https://api.openai.com/v1/models';
    const init = provider === 'gemini' ? {} : { headers: { Authorization: `Bearer ${key}` } };
    const r = await fetch(url, init);
    if (!r.ok) {
      throw new Error(r.status === 401 || r.status === 403 ? 'Key rejected — check it and try again'
        : r.status === 429 ? 'Key works but its quota is exhausted'
        : `Validation failed (HTTP ${r.status})`);
    }
  };

  const wireKeySave = (btnSel, inputSel, storageKey, provider, label) => {
    $(btnSel)?.addEventListener("click", async () => {
      haptic("medium");
      const btn = $(btnSel);
      const val = $(inputSel).value.trim();
      if (!val) {
        localStorage.removeItem(storageKey);
        state.me = null;
        toast(`${label} key removed`, "success");
        renderMeIntegrations();
        return;
      }
      setBtnLoading(btn, true);
      try {
        await validateApiKey(provider, val);
        localStorage.setItem(storageKey, val);
        state.me = null;
        toast(`${label} key verified and saved`, "success");
        renderMeIntegrations();
      } catch (e) {
        toast(`${label}: ${e.message}`, "error");
      } finally {
        setBtnLoading(btn, false);
      }
    });
  };
  wireKeySave("#saveGeminiKey", "#geminiKeyInput", "bv_gemini_key", "gemini", "Gemini");
  wireKeySave("#saveOpenAIKey", "#openaiKeyInput", "bv_openai_key", "openai", "OpenAI");
}
