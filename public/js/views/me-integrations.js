import { $, haptic, escapeHtml, toast, setBtnLoading } from '../utils.js';
import { state, invalidatePortfolio } from '../state.js';
import { api, isGuestMode } from '../api.js';
import { checkGemma3Downloaded, downloadGemma3Model, importGemma3ModelFile, deleteGemma3Model, getLocalAiAvailability, getDownloadMetadata, checkStoragePersisted, DEFAULT_MODEL_URL, MODEL_LICENSE_PAGE } from '../lib/local-ai.js';
import { I } from '../icons.js';
import { icon as kitIcon } from '../ui/kit.js';
import { confirmSheet, showSheet, hideSheet } from '../components/sheet.js';
import { go } from '../router.js';
import { subpageTopbarHTML, loadMe } from './me-shared.js';
import { skelPage, skelSettingRows } from '../components/skeleton.js';
import { disableNativePush, enableNativePush, nativePushEnabled, nativePushSupported } from '../lib/native-push.js';
import { t, tPlural } from '../lib/i18n.js';
import { getProviderCredential, hasPersistentProviderCredential, setProviderCredential } from '../lib/provider-credentials.js';

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
  const googleSetup = state.config?.setup?.google || {};
  const googleStatus = await api("/api/google/status").catch(() => ({ connected: false, spreadsheet_id: null }));
  // The protected status call returns 401 for guests. Public /api/config is the
  // readiness source in that state; defaulting to false produced the impossible
  // "disabled" + "OAuth is ready" message on the same card.
  const googleConfigured = googleStatus.configured
    ?? googleSetup.configured
    ?? state.config?.status?.google
    ?? false;
  const googleMissing = Array.isArray(googleSetup.missing_secrets) ? googleSetup.missing_secrets : ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
  const savedGeminiKey = getProviderCredential('gemini');
  const savedOpenAIKey = getProviderCredential('openai');
  // Earlier builds shipped (and persisted) a dead model URL — drop it so the
  // input falls back to the working default.
  if ((localStorage.getItem('bv_gemma_model_url') || '').includes('jardpound')) {
    localStorage.removeItem('bv_gemma_model_url');
  }
  const gemmaDescDefault = `Requires the model weights (~3GB) to run set photo scanning 100% on-device for free. Official Gemma weights are license-gated: <a href="${MODEL_LICENSE_PAGE}" target="_blank" rel="noopener">accept the license</a>, then download with a Hugging Face token — or download the file in your browser and import it below.`;

  const pill = (text, kind = '') => `<span class="bv-pill${kind ? ` bv-pill--${kind}` : ''}">${escapeHtml(text)}</span>`;
  const head = (ic, title, statusHtml) => `<div class="bv-intcard__head"><span class="bv-intcard__icon" aria-hidden="true">${kitIcon(ic, { size: 22 })}</span><h2 class="bv-intcard__title">${escapeHtml(title)}</h2>${statusHtml}</div>`;
  const aiEngine = localStorage.getItem('bv_ai_engine') === 'local' ? 'local' : 'cloud';

  $("#root").innerHTML = `
    <main class="bv-page integrations-page bv-integrations">
      ${subpageTopbarHTML(t('bvAccount.integrationsLead'), t('bvAccount.integrations'))}

      <section class="bv-intcard" aria-labelledby="intGoogleTitle">
        ${head('sheets', t('bvAccount.intSheets'), googleStatus.connected ? pill(t('bvAccount.connected'), 'gain') : !googleConfigured ? pill(t('bvAccount.setupNeeded')) : pill(t('bvAccount.notConnected')))}
        <p class="bv-intcard__desc" id="intGoogleTitle">Keep your spreadsheet "BricksVault Vault" in sync in the background.</p>
        ${googleStatus.connected ? `
          ${googleStatus.spreadsheet_id ? `<p class="bv-intcard__meta">Spreadsheet ID: <a href="https://docs.google.com/spreadsheets/d/${escapeHtml(googleStatus.spreadsheet_id)}" target="_blank" rel="noopener">${escapeHtml(googleStatus.spreadsheet_id.slice(0, 16))}...</a></p>` : ''}
          <div class="bv-intcard__actions">
            <button type="button" class="bv-btn bv-btn--tonal" id="syncGoogleNowBtn">Sync Now</button>
            <button type="button" class="bv-btn bv-btn--danger" id="disconnectGoogleBtn">Disconnect</button>
          </div>
        ` : !googleConfigured ? `
          <p class="bv-intcard__note">
            <span>Google Sheets is disabled until OAuth is configured.</span>
            <span>Missing Worker secrets:</span> ${escapeHtml(googleMissing.join(', '))}. <span>Add them as GitHub Actions secrets and redeploy to enable account linking.</span>
          </p>
        ` : guest ? `
          <p class="bv-intcard__note integration-ready-note">${I.check({ w: 16 })}<span>Google OAuth is ready. Sign in first, then connect the spreadsheet you want BricksVault to keep in sync.</span></p>
          <button type="button" class="bv-btn bv-btn--primary bv-btn--full" id="connectGoogleBtn">${kitIcon('user', { size: 20 })}<span>Sign in to connect</span></button>
        ` : `
          <button type="button" class="bv-btn bv-btn--primary bv-btn--full" id="connectGoogleBtn">${kitIcon('ext', { size: 20 })}<span>Connect Google Sheets</span></button>
        `}
      </section>

      <section class="bv-intcard" aria-label="Brickset">
        ${head('brick', t('bvAccount.intBrickset'), me.brickset_connected ? pill(t('bvAccount.connected'), 'gain') : pill(t('bvAccount.notConnected')))}
        <p class="bv-intcard__desc">Sync sets you've marked as owned on Brickset.com into your vault.</p>
        ${me.brickset_connected ? `
          <div class="bv-intcard__actions">
            <button type="button" id="bricksetSyncBtn" class="bv-btn bv-btn--tonal">Sync Now</button>
            <button type="button" id="bricksetDisconnectBtn" class="bv-btn bv-btn--danger">Disconnect</button>
          </div>
          <p id="bricksetSyncResult" class="bv-intcard__meta" role="status"></p>
        ` : `
          <div class="bv-intcard__form">
            <div class="bv-field"><div class="bv-field__box"><input id="bricksetUsername" type="text" placeholder="Brickset username" aria-label="Brickset username" autocomplete="username"></div></div>
            <div class="bv-field"><div class="bv-field__box"><input id="bricksetPassword" type="password" placeholder="Brickset password" aria-label="Brickset password" autocomplete="current-password"></div></div>
            <button type="button" id="bricksetConnectBtn" class="bv-btn bv-btn--primary bv-btn--full integration-action">Connect Brickset Account</button>
            <p id="bricksetConnectError" class="bv-field__error" role="alert" style="display:none;"></p>
          </div>
        `}
      </section>

      <section class="bv-intcard" aria-label="Discord">
        ${head('chat', t('bvAccount.intDiscord'), me.discord_webhook_url ? pill(t('bvAccount.on'), 'gain') : pill(t('bvAccount.off')))}
        <p class="bv-intcard__desc">Post price-drop and spike alerts to a Discord channel.</p>
        <div class="bv-field"><label for="discordWebhook">${escapeHtml(t('bvAccount.webhookUrl'))}</label>
          <div class="bv-field__box"><input id="discordWebhook" type="url" placeholder="https://discord.com/api/webhooks/…" value="${me.discord_webhook_url ? escapeHtml(me.discord_webhook_url) : ""}" class="bv-mono-input integration-control" autocomplete="off" spellcheck="false"></div></div>
        <div class="bv-intcard__actions integration-inline-actions">
          <button type="button" id="discordWebhookSave" class="bv-btn bv-btn--tonal integration-action">Save</button>
          ${me.discord_webhook_url ? `<button type="button" id="discordWebhookClear" class="bv-btn bv-btn--danger integration-action integration-action-danger">Clear</button>` : ""}
        </div>
      </section>

      <section class="bv-intcard" aria-label="${escapeHtml(t('bvAccount.intPush'))}">
        ${head('bell', t('bvAccount.intPush'), '')}
        <p class="bv-intcard__desc" id="pushNotifDesc">Receive price alerts on your device even when the app is closed.</p>
        <div class="bv-intcard__actions">
          <button type="button" class="bv-btn bv-btn--tonal integration-action" id="pushNotifBtn" data-push-state="unknown">Enable</button>
          <a class="bv-btn bv-btn--text" href="#/me/notifications">${escapeHtml(t('bvAccount.notifications'))}</a>
        </div>
      </section>

      <section class="bv-intcard" aria-label="${escapeHtml(t('bvAccount.intAi'))}">
        ${head('sparkle', t('bvAccount.intAi'), pill(t(aiEngine === 'local' ? 'bvAccount.aiOnDevice' : 'bvAccount.aiCloud'), aiEngine === 'local' ? 'gain' : ''))}
        <p class="bv-intcard__desc">Scanning and the advisor use <strong>Cloud AI by default</strong> — most accurate and works on any device. Choose “Prefer on-device” to run free, private Gemma / Gemini Nano locally <strong>when your device supports it</strong> (WebGPU) or you're offline; it falls back to Cloud automatically, so scanning always works.</p>
        <div class="bv-field"><label for="globalAiEngineSelect">Global AI Engine</label>
          <div class="bv-field__box"><select id="globalAiEngineSelect">
            <option value="cloud" ${aiEngine !== 'local' ? 'selected' : ''}>Cloud AI (recommended)</option>
            <option value="local" ${aiEngine === 'local' ? 'selected' : ''}>Prefer on-device (falls back to cloud)</option>
          </select></div></div>
        <p class="bv-intcard__meta">${escapeHtml(t('bvAccount.yourKeys', { gemini: savedGeminiKey ? '✓' : '—', openai: savedOpenAIKey ? '✓' : '—' }))}</p>
        <details class="bv-intcard__more"${localStorage.getItem('bv_gemma_dl') ? ' open' : ''}>
          <summary>${escapeHtml(t('bvAccount.manageKeys'))}</summary>
          <div class="bv-intcard__sub">
            <p class="bv-intcard__label">Gemini API key (free)</p>
            <p class="bv-intcard__meta">${savedGeminiKey ? "Active - powers scans, advisor, listings, and valuation fallback on your Google quota" : 'Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> - bypasses shared AI limits'}</p>
            <div class="bv-intcard__inline"><div class="bv-field__box"><input type="password" id="geminiKeyInput" value="${escapeHtml(savedGeminiKey)}" placeholder="AIza..." aria-label="Gemini API key (free)" class="bv-mono-input"></div><button type="button" class="bv-btn bv-btn--tonal" id="saveGeminiKey">Save</button></div>
          </div>
          <div class="bv-intcard__sub">
            <p class="bv-intcard__label">OpenAI key (optional)</p>
            <p class="bv-intcard__meta">${savedOpenAIKey ? "Active - powers scans, advisor, and listing drafts with your key" : "Optional: use your own OpenAI key for scans, advisor, and listing drafts"}</p>
            <div class="bv-intcard__inline"><div class="bv-field__box"><input type="password" id="openaiKeyInput" value="${escapeHtml(savedOpenAIKey)}" placeholder="sk-..." aria-label="OpenAI key (optional)" class="bv-mono-input"></div><button type="button" class="bv-btn bv-btn--tonal" id="saveOpenAIKey">Save</button></div>
          </div>
          <div class="bv-intcard__sub">
            <p class="bv-intcard__label">Gemini Nano (Chrome Built-in AI)</p>
            <p class="bv-intcard__meta" id="chromeAiStatus">Checking compatibility...</p>
          </div>
          <div class="bv-intcard__sub">
            <p class="bv-intcard__label">Gemma Vision Model (Offline Scanning)</p>
            <p class="bv-intcard__meta" id="gemmaModelDesc">${gemmaDescDefault}</p>
            <div id="gemmaDownloadStatus" class="bv-intcard__progress" style="display:none;">
              <div class="bv-intcard__progress-row"><span><span id="gemmaDownloadLabel">Downloading:</span> <span id="gemmaDownloadPct">0%</span></span><button type="button" id="cancelGemmaBtn" class="bv-btn bv-btn--text bv-btn--sm">Cancel</button></div>
              <div class="bv-intcard__track"><div id="gemmaDownloadBar" style="width:0%;"></div></div>
            </div>
            <div class="bv-field__box"><input type="text" id="gemmaModelUrlInput" value="${escapeHtml(localStorage.getItem('bv_gemma_model_url') || DEFAULT_MODEL_URL)}" placeholder="Model URL (.task / .litertlm)" aria-label="Model URL (.task / .litertlm)" class="bv-mono-input"></div>
            <div class="bv-field__box"><input type="password" id="hfTokenInput" value="${escapeHtml(localStorage.getItem('bv_hf_token') || '')}" placeholder="Hugging Face token (hf_…) — needed for gated models" aria-label="Hugging Face token (hf_…) — needed for gated models" autocomplete="off" class="bv-mono-input"></div>
            <div class="bv-intcard__actions">
              <button type="button" class="bv-btn bv-btn--primary" id="downloadGemmaBtn">Download</button>
              <button type="button" class="bv-btn bv-btn--tonal" id="importGemmaBtn">Import file</button>
              <button type="button" class="bv-btn bv-btn--danger" id="deleteGemmaBtn" style="display:none;">Delete</button>
              <input type="file" id="gemmaFileInput" accept=".task,.litertlm,.bin" hidden>
            </div>
          </div>
        </details>
      </section>
    </main>`;

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
      toast(t('common.errorWithDetails', { error: e.message || e }), "error");
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
      toast(t('common.errorWithDetails', { error: e.message || e }), "error");
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
      toast(t('common.errorWithDetails', { error: e.message || e }), "error");
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
    } catch (e) { toast(t('common.errorWithDetails', { error: e.message || e }), "error"); }
  });

  $("#discordWebhookClear")?.addEventListener("click", async () => {
    haptic("medium");
    try {
      await api("/api/me", { method: "PATCH", body: { discord_webhook_url: null } });
      state.me = null;
      toast("Discord alerts cleared", "info");
      await renderMeIntegrations();
    } catch (e) { toast(t('common.errorWithDetails', { error: e.message || e }), "error"); }
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
      toast(t('common.errorWithDetails', { error: e.message || e }), "error");
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
    } catch (e) { toast(t('common.errorWithDetails', { error: e.message || e }), "error"); }
  });

  $("#bricksetSyncBtn")?.addEventListener("click", async () => {
    const btn = $("#bricksetSyncBtn");
    const resultEl = $("#bricksetSyncResult");
    if (btn) { btn.disabled = true; btn.textContent = "Syncing…"; }
    haptic("medium");
    try {
      const res = await api("/api/brickset/sync", { method: "POST" });
      if (resultEl) resultEl.textContent = tPlural('integrations.bricksetSyncResult', res.added, { skipped: res.skipped, total: res.total });
      toast(tPlural('integrations.bricksetSyncSuccess', res.added), "success");
      invalidatePortfolio();
    } catch (e) {
      if (resultEl) resultEl.textContent = t('integrations.bricksetSyncFailed', { error: e.message || e });
      toast(t('integrations.bricksetSyncFailed', { error: e.message || e }), "error");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Sync Now"; }
    }
  });

  // --- Push notification hooks ---
  const pushBtn = $("#pushNotifBtn");
  if (pushBtn && nativePushSupported()) {
    const nativeConfigured = state.config?.status?.native_push === true;
    const pushDesc = $("#pushNotifDesc");
    if (!nativeConfigured) {
      pushBtn.textContent = "Setup needed";
      pushBtn.disabled = true;
      if (pushDesc) pushDesc.textContent = "Native alerts are waiting for the app's Firebase configuration.";
    } else {
      pushBtn.textContent = nativePushEnabled() ? "Disable" : "Enable";
      pushBtn.dataset.pushState = nativePushEnabled() ? "enabled" : "disabled";
      pushBtn.addEventListener("click", async () => {
        pushBtn.disabled = true;
        try {
          if (pushBtn.dataset.pushState === "enabled") {
            await disableNativePush();
            pushBtn.textContent = "Enable";
            pushBtn.dataset.pushState = "disabled";
            toast("Push notifications disabled", "info");
          } else {
            await enableNativePush();
            pushBtn.textContent = "Disable";
            pushBtn.dataset.pushState = "enabled";
            haptic("medium");
            toast("Push notifications enabled", "success");
          }
        } catch (e) {
          toast(t('common.errorWithDetails', { error: e.message || e }), "error");
        } finally {
          pushBtn.disabled = false;
        }
      });
    }
  } else if (pushBtn && 'serviceWorker' in navigator && 'PushManager' in window) {
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
      } catch (e) { toast(t('common.errorWithDetails', { error: e.message || e }), "error"); }
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

  const wireKeySave = (btnSel, inputSel, provider, label) => {
    $(btnSel)?.addEventListener("click", async () => {
      haptic("medium");
      const btn = $(btnSel);
      const val = $(inputSel).value.trim();
      if (!val) {
        setProviderCredential(provider, '');
        state.me = null;
        toast(t('integrations.keyRemoved', { label }), "success");
        renderMeIntegrations();
        return;
      }
      setBtnLoading(btn, true);
      try {
        await validateApiKey(provider, val);
        // New keys are session-only by default. Existing remembered keys remain
        // remembered so upgrades never silently delete user credentials.
        setProviderCredential(provider, val, hasPersistentProviderCredential(provider));
        state.me = null;
        toast(t('integrations.keyVerified', { label }), "success");
        renderMeIntegrations();
      } catch (e) {
        toast(t('common.errorWithDetails', { error: e.message || e }), "error");
      } finally {
        setBtnLoading(btn, false);
      }
    });
  };
  wireKeySave("#saveGeminiKey", "#geminiKeyInput", "gemini", "Gemini");
  wireKeySave("#saveOpenAIKey", "#openaiKeyInput", "openai", "OpenAI");

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
      descEl.innerHTML = gemmaDescDefault;
      if (hasPartial && resumePct !== null) {
        const resumeNote = document.createElement('span');
        resumeNote.className = 'u-fs-xs';
        resumeNote.style.color = 'var(--bv-yellow)';
        resumeNote.textContent = t('downloads.interrupted', { pct: resumePct });
        descEl.append(' ', resumeNote);
      }
      downloadBtn.textContent = hasPartial ? t('downloads.resume', { pct: resumePct !== null ? `${resumePct}%` : '…' }) : "Download";
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
      toast(t('common.errorWithDetails', { error: err.message || err }), "error");
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
