import { $, haptic, escapeHtml, toast, setBtnLoading } from '../utils.js';
import { state, invalidatePortfolio } from '../state.js';
import { api, isGuestMode } from '../api.js';
import { checkGemma3Downloaded, downloadGemma3Model, importGemma3ModelFile, deleteGemma3Model, getLocalAiAvailability, getDownloadMetadata, checkStoragePersisted, DEFAULT_MODEL_URL, MODEL_LICENSE_PAGE } from '../lib/local-ai.js';
import { I } from '../icons.js';
import { confirmSheet, showSheet, hideSheet } from '../components/sheet.js';
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
  // Earlier builds shipped (and persisted) a dead model URL — drop it so the
  // input falls back to the working default.
  if ((localStorage.getItem('bv_gemma_model_url') || '').includes('jardpound')) {
    localStorage.removeItem('bv_gemma_model_url');
  }
  const gemmaDescDefault = `Requires the model weights (~3GB) to run set photo scanning 100% on-device for free. Official Gemma weights are license-gated: <a href="${MODEL_LICENSE_PAGE}" target="_blank" rel="noopener" style="color:var(--bv-red);font-weight:600;text-decoration:underline;">accept the license</a>, then download with a Hugging Face token — or download the file in your browser and import it below.`;

  $("#root").innerHTML = `
    <div class="page">
      ${subpageTopbarHTML("Connected services", "Integrations")}

      <h2 class="section-title">Google Sheets Sync</h2>
      <div>
        <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
          <div class="lbl-wrap">
            <div class="lbl">Google Sheets Auto-Sync</div>
            <div class="desc">Keep your spreadsheet "BricksVault Vault" in sync in the background.</div>
          </div>
          ${googleStatus.connected ? `
            <div class="u-col u-wfull">
              <div class="u-row u-fs-sm u-up" style="font-weight:600;">
                <span aria-hidden="true" style="display:inline-block;width:8px;height:8px;background:var(--up);border-radius:50%;"></span>
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

      <h2 class="section-title">Discord Alerts</h2>
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

      <h2 class="section-title">Push Notifications</h2>
      <div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Push notifications</div><div class="desc">Receive price alerts on your device even when the app is closed.</div></div>
          <button class="btn-secondary u-fs-sm" id="pushNotifBtn" style="padding:6px 12px;" data-push-state="unknown">Enable</button>
        </div>
      </div>

      <h2 class="section-title">Brickset Collection Sync</h2>
      <div>
        <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
          <div class="lbl-wrap">
            <div class="lbl">Import from Brickset</div>
            <div class="desc">Sync sets you've marked as owned on Brickset.com into your vault.</div>
          </div>
          ${me.brickset_connected ? `
            <div class="u-col u-wfull">
              <div class="u-row u-fs-sm u-up" style="font-weight:600;">
                <span aria-hidden="true" style="display:inline-block;width:8px;height:8px;background:var(--up);border-radius:50%;"></span>
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

      <h2 class="section-title">AI Scanning</h2>
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

      <h2 class="section-title">On-Device Offline AI</h2>
      <div>
        <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
          <div class="lbl-wrap">
            <div class="lbl">Global AI Engine</div>
            <div class="desc">Scanning and the advisor use <strong>Cloud AI by default</strong> — most accurate and works on any device. Choose “Prefer on-device” to run free, private Gemma / Gemini Nano locally <strong>when your device supports it</strong> (WebGPU) or you're offline; it falls back to Cloud automatically, so scanning always works.</div>
          </div>
          <div class="u-row u-wfull">
            <select id="globalAiEngineSelect" class="u-wfull u-fs-base" style="border:1px solid var(--border-c);border-radius:var(--r-1);padding:8px 10px;background:var(--surface-2);color:var(--ink);outline:none;box-sizing:border-box;">
              <option value="cloud" ${localStorage.getItem('bv_ai_engine') !== 'local' ? 'selected' : ''}>Cloud AI (recommended)</option>
              <option value="local" ${localStorage.getItem('bv_ai_engine') === 'local' ? 'selected' : ''}>Prefer on-device (falls back to cloud)</option>
            </select>
          </div>
        </div>
        <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
          <div class="lbl-wrap">
            <div class="lbl">Gemini Nano (Chrome Built-in AI)</div>
            <div class="desc" id="chromeAiStatus">Checking compatibility...</div>
          </div>
        </div>
        <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
          <div class="lbl-wrap">
            <div class="lbl">Gemma Vision Model (Offline Scanning)</div>
            <div class="desc" id="gemmaModelDesc">${gemmaDescDefault}</div>
          </div>
          <div class="u-col u-wfull" style="gap: 8px;">
            <div id="gemmaDownloadStatus" class="u-fs-sm u-mute" style="display:none; width: 100%;">
              <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                <span><span id="gemmaDownloadLabel">Downloading:</span> <span id="gemmaDownloadPct">0%</span></span>
                <button id="cancelGemmaBtn" class="btn-secondary" style="padding:2px 10px; font-size:11px; flex-shrink:0;">Cancel</button>
              </div>
              <div style="background:var(--line-soft); border-radius:4px; height:6px; width:100%; overflow:hidden; margin-top:4px;">
                <div id="gemmaDownloadBar" style="background:var(--up); height:100%; width:0%; transition:width 0.2s ease;"></div>
              </div>
            </div>
            <input type="text" id="gemmaModelUrlInput" value="${escapeHtml(localStorage.getItem('bv_gemma_model_url') || DEFAULT_MODEL_URL)}" placeholder="Model URL (.task / .litertlm)"
              class="u-wfull u-fs-sm" style="padding:8px 10px;border:var(--bw-thin) solid var(--border-c);border-radius:var(--r-2);background:var(--surface-2);color:var(--ink);font-family:var(--mono);outline:none;box-sizing:border-box;">
            <input type="password" id="hfTokenInput" value="${escapeHtml(localStorage.getItem('bv_hf_token') || '')}" placeholder="Hugging Face token (hf_…) — needed for gated models" autocomplete="off"
              class="u-wfull u-fs-sm" style="padding:8px 10px;border:var(--bw-thin) solid var(--border-c);border-radius:var(--r-2);background:var(--surface-2);color:var(--ink);font-family:var(--mono);outline:none;box-sizing:border-box;">
            <div class="u-row u-wfull" style="gap: 8px;">
              <button class="btn-primary u-flex1" id="downloadGemmaBtn" style="padding: 8px 12px; font-size:12px;">Download</button>
              <button class="btn-secondary u-flex1" id="importGemmaBtn" style="padding: 8px 12px; font-size:12px;">Import file</button>
              <button class="btn-secondary" id="deleteGemmaBtn" style="white-space:nowrap; padding: 8px 12px; font-size:12px; color:var(--down); display:none;">Delete</button>
              <input type="file" id="gemmaFileInput" accept=".task,.litertlm,.bin" style="display:none;">
            </div>
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
    pushBtn.textContent = "…";
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

  // --- Check On-Device Prompt API availability ---
  const checkChromeAi = async () => {
    const statusEl = document.getElementById("chromeAiStatus");
    if (!statusEl) return;
    const availability = await getLocalAiAvailability();
    if (availability === 'readily') {
      statusEl.innerHTML = `<span style="color:var(--up); font-weight:600;">Compatible</span> — Ready for offline text advice.`;
    } else if (availability === 'after-download') {
      statusEl.innerHTML = `<span style="color:var(--bv-yellow); font-weight:600;">Supported</span> — Model needs download. Run a query in the Advisor tab to trigger it.`;
    } else {
      statusEl.innerHTML = `<span style="color:var(--down);">Unsupported</span> — Requires Chrome on desktop/Android with Gemini Nano flags enabled.`;
    }
  };
  setTimeout(checkChromeAi, 100);

  // --- Check Gemma 3 Vision Model Cache ---
  const updateGemmaUi = async () => {
    const isDownloaded = await checkGemma3Downloaded();
    const downloadBtn = document.getElementById("downloadGemmaBtn");
    const deleteBtn = document.getElementById("deleteGemmaBtn");
    const descEl = document.getElementById("gemmaModelDesc");
    const importBtn = document.getElementById("importGemmaBtn");
    if (!downloadBtn || !deleteBtn || !descEl) return;

    if (isDownloaded) {
      const persisted = await checkStoragePersisted();
      const persistNote = persisted === true
        ? ` <span class="u-fs-xs" style="color:var(--up);">&#x25CF; Protected from eviction</span>`
        : persisted === false
          ? ` <span class="u-fs-xs" style="color:var(--bv-yellow);">&#x26A0; May be evicted under storage pressure</span>`
          : '';
      descEl.innerHTML = `<span style="color:var(--up); font-weight:600;">Downloaded</span> — Gemma is ready for local offline photo scanning!${persistNote}`;
      downloadBtn.style.display = "none";
      if (importBtn) importBtn.style.display = "none";
      deleteBtn.style.display = "block";
    } else {
      const meta = getDownloadMetadata();
      const currentUrl = document.getElementById("gemmaModelUrlInput")?.value?.trim() || DEFAULT_MODEL_URL;
      const hasPartial = !!(meta && !meta.complete && meta.loadedBytes > 0 && meta.url === currentUrl);
      const resumePct = hasPartial && meta.totalBytes ? Math.round(meta.loadedBytes / meta.totalBytes * 100) : null;
      descEl.innerHTML = gemmaDescDefault + (hasPartial && resumePct !== null
        ? ` <span class="u-fs-xs" style="color:var(--bv-yellow);">Download interrupted at ${resumePct}% &#x2014; tap &#x201C;Resume&#x201D; to continue.</span>`
        : '');
      downloadBtn.textContent = hasPartial ? `Resume (${resumePct !== null ? resumePct + '%' : '…'})` : "Download";
      downloadBtn.style.display = "block";
      if (importBtn) importBtn.style.display = "block";
      // Show Delete when a partial file exists so user can wipe and start fresh.
      deleteBtn.style.display = hasPartial ? "block" : "none";
    }
  };
  setTimeout(updateGemmaUi, 100);

  // --- Gemma Download / Import Actions ---
  const gemmaProgressUi = (label) => {
    const statusDiv = $("#gemmaDownloadStatus");
    const labelSpan = $("#gemmaDownloadLabel");
    const pctSpan = $("#gemmaDownloadPct");
    const barDiv = $("#gemmaDownloadBar");
    if (labelSpan) labelSpan.textContent = label;
    if (statusDiv) statusDiv.style.display = "block";
    return {
      onProgress: (pct) => {
        const percentText = `${Math.round(pct * 100)}%`;
        if (pctSpan) pctSpan.textContent = percentText;
        if (barDiv) barDiv.style.width = percentText;
      },
      done: () => { if (statusDiv) statusDiv.style.display = "none"; },
    };
  };

  $("#downloadGemmaBtn")?.addEventListener("click", async () => {
    const btn = $("#downloadGemmaBtn");
    const urlInput = $("#gemmaModelUrlInput");
    if (!btn || !urlInput) return;

    // Device pre-checks: WebGPU required, warn on low RAM.
    if (!('gpu' in navigator)) {
      toast("WebGPU is required for local scanning but isn't supported by this browser. Try Chrome on Android or desktop.", "error");
      return;
    }
    const ram = navigator.deviceMemory;
    if (ram !== undefined && ram < 4) {
      const proceed = await confirmSheet({
        title: "Low RAM detected",
        message: `Your device reports ${ram}GB RAM. The Gemma model (~3GB) may crash on devices with less than 4GB of memory. Proceed anyway?`,
        confirmLabel: "Download anyway",
        danger: false,
      });
      if (!proceed) return;
    }

    const url = urlInput.value.trim();
    if (!url) { toast("Please provide a valid model URL.", "error"); return; }
    localStorage.setItem('bv_gemma_model_url', url);
    const hfToken = ($("#hfTokenInput")?.value || "").trim();
    if (hfToken) localStorage.setItem('bv_hf_token', hfToken);
    else localStorage.removeItem('bv_hf_token');

    haptic("medium");
    btn.disabled = true;
    const meta = getDownloadMetadata();
    const isResume = !!(meta && meta.url === url && meta.loadedBytes > 0 && !meta.complete);
    btn.textContent = isResume ? "Resuming..." : "Downloading...";
    const progress = gemmaProgressUi(isResume ? "Resuming:" : "Downloading:");
    // Seed the bar at the known resume offset so the user sees their existing
    // progress immediately rather than "0%" until the first chunk arrives.
    if (isResume && meta.totalBytes) progress.onProgress(meta.loadedBytes / meta.totalBytes);

    // AbortController so the Cancel button can stop the download mid-stream.
    const controller = new AbortController();
    const cancelBtn = $("#cancelGemmaBtn");
    const onCancel = () => controller.abort();
    cancelBtn?.addEventListener("click", onCancel);

    // Keep the screen on so Android doesn't kill the radio mid-download.
    let wakeLock = null;
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}

    try {
      await downloadGemma3Model(url, progress.onProgress, hfToken, controller.signal);
      toast("Gemma Vision Model downloaded successfully!", "success");
      await updateGemmaUi();
    } catch (e) {
      if (controller.signal.aborted) {
        toast("Download cancelled — progress saved. Tap Resume to continue.", "info");
      } else {
        toast(e.message, "error");
      }
      btn.disabled = false;
      await updateGemmaUi(); // shows "Resume (NN%)" if partial was saved
    } finally {
      cancelBtn?.removeEventListener("click", onCancel);
      progress.done();
      try { await wakeLock?.release(); } catch {}
    }
  });

  $("#importGemmaBtn")?.addEventListener("click", () => {
    haptic("light");
    $("#gemmaFileInput")?.click();
  });

  $("#gemmaFileInput")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const btn = $("#importGemmaBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Importing..."; }
    const progress = gemmaProgressUi("Importing:");
    let wakeLock = null;
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
    try {
      await importGemma3ModelFile(file, progress.onProgress);
      toast("Gemma Vision Model imported successfully!", "success");
      await updateGemmaUi();
    } catch (err) {
      toast(`Import failed: ${err.message}`, "error");
    } finally {
      progress.done();
      try { await wakeLock?.release(); } catch {}
      if (btn) { btn.disabled = false; btn.textContent = "Import file"; }
      e.target.value = "";
    }
  });

  $("#deleteGemmaBtn")?.addEventListener("click", async () => {
    if (!(await confirmSheet({ title: "Delete Gemma Model?", message: "This will remove the multi-GB model weights from your local browser storage.", confirmLabel: "Delete", danger: true }))) return;
    haptic("heavy");
    await deleteGemma3Model();
    toast("Local model weights deleted", "info");
    await updateGemmaUi();
  });

  // --- Global AI Engine preference ---
  const globalEngineSelect = document.getElementById("globalAiEngineSelect");
  globalEngineSelect?.addEventListener("change", async (e) => {
    const val = e.target.value;
    haptic("light");
    if (val === "local") {
      const nanoAvailable = await getLocalAiAvailability() !== 'no';
      const webGpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;
      
      if (!nanoAvailable && !webGpuAvailable) {
        toast("Local AI (both Gemini Nano and WebGPU) is not supported on this browser.", "error");
        globalEngineSelect.value = "cloud";
        localStorage.setItem("bv_ai_engine", "cloud");
        showLocalAiSetupSheet();
        return;
      }
      
      if (!nanoAvailable) {
        toast("Gemini Nano unavailable here — the advisor will use Cloud. On-device scanning runs when supported, else Cloud.", "info");
      }

      const isDownloaded = await checkGemma3Downloaded();
      if (!isDownloaded) {
        toast("Download the Gemma model below for on-device/offline scanning — until then, scans use Cloud.", "info");
      }
    }
    localStorage.setItem("bv_ai_engine", val);
    toast(val === 'local'
      ? "On-device AI will be used when supported, with automatic Cloud fallback."
      : "Using Cloud AI for scanning and the advisor.", "success");
  });
}

function showLocalAiSetupSheet() {
  showSheet(`
    <div style="font-family:var(--serif); font-size:20px; font-weight:600; margin:0 4px 12px; display:flex; align-items:center; gap:8px;">
      ${I.info({w:18,h:18})} Enable On-Device AI
    </div>
    <div style="font-size:13px; color:var(--ink-mute); line-height:1.5; padding:4px;">
      <p style="margin-bottom:12px;">On-device AI runs free and private in your browser — used for the advisor and photo scanning <strong>when your device supports it</strong> (Chrome's <strong>Gemini Nano</strong> for text; <strong>WebGPU</strong> + the Gemma model for vision) or when you're offline. Cloud AI stays the default and the automatic fallback, so scanning always works.</p>
      <p style="margin-bottom:8px; font-weight:600; color:var(--ink);">To enable in Google Chrome (Desktop or Android):</p>
      <ol style="padding-left:20px; margin-bottom:16px; display:flex; flex-direction:column; gap:8px; text-align:left;">
        <li>Open a new tab and go to <code style="background:var(--surface-3); padding:2px 4px; border-radius:4px; font-family:var(--mono); font-size:11px;">chrome://flags/#prompt-api-for-gemini-nano</code>. Set it to <strong>Enabled</strong>.</li>
        <li>Go to <code style="background:var(--surface-3); padding:2px 4px; border-radius:4px; font-family:var(--mono); font-size:11px;">chrome://flags/#optimization-guide-on-device-model</code>. Set it to <strong>Enabled BypassPerfRequirement</strong> (or similar Enabled option).</li>
        <li>Relaunch Chrome, then go to <code style="background:var(--surface-3); padding:2px 4px; border-radius:4px; font-family:var(--mono); font-size:11px;">chrome://components</code>, find <strong>Optimization Guide On Device Model</strong>, and click <strong>Check for update</strong> to manually force Chrome to download the model weights.</li>
      </ol>
      <button class="btn-primary" id="setupSheetDone" style="margin-top:8px;">Got it</button>
    </div>
  `);
  document.getElementById("setupSheetDone")?.addEventListener("click", () => {
    haptic("light");
    hideSheet();
  });
}
