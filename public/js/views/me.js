import { $, $$, haptic, escapeHtml, fmtMoneyShort, toast, fmtMoney, fmtPct, setHue, setBtnLoading, CURRENCY_SYMBOLS, bvIDB } from '../utils.js';
import { state, invalidatePortfolio } from '../state.js';
import { api, sbSignOut, _authSession, isGuestMode, guestCollectionCSVBlob } from '../api.js';
import { I } from '../icons.js';
import { confirmSheet, promptSheet, showSheet, hideSheet } from '../components/sheet.js';
import { classifyJobRun, jobProgressSummary } from '../lib/pure.js';
import { go } from '../router.js';

let activeAdminRunId = null;
let activeAdminTool = null;
let adminJobPollTimer = null;
let populateEverythingAuto = false;
let populateEverythingContinueTimer = null;

export async function renderMe() {
  let me = state.me;
  let googleStatus = { connected: false, spreadsheet_id: null };
  let publicProfile = null;

  if (location.hash.includes("google_sync=success")) {
    toast("Google Sheets connected successfully!", "success");
    history.replaceState(null, "", "#/me");
  } else if (location.hash.includes("google_sync=error")) {
    toast("Failed to connect Google Sheets", "error");
    history.replaceState(null, "", "#/me");
  }

  try {
    const [meData, gStatus] = await Promise.all([
      me ? Promise.resolve(me) : api("/api/me"),
      api("/api/google/status").catch(() => ({ connected: false, spreadsheet_id: null }))
    ]);
    me = meData;
    state.me = me;
    googleStatus = gStatus;
    
    if (me.handle) {
      publicProfile = await fetch((window.WORKER_BASE || '') + "/api/users/" + encodeURIComponent(me.handle) + "/profile")
        .then(r => r.ok ? r.json() : null)
        .catch(() => null);
    }
  } catch (e) {
    toast("Couldn't load profile", "error");
    me = me || { display_name: "Collector", handle: "you", notify_price_drops: true, portfolio_stats: {} };
  }
  const c = me.portfolio_stats || {};
  const gain = (c.total_value || 0) - (c.total_paid || 0);
  const gainPct = c.total_paid ? gain / c.total_paid : 0;
  const guest = isGuestMode();
  const savedGeminiKey = localStorage.getItem('bv_gemini_key') || '';
  const savedOpenAIKey = localStorage.getItem('bv_openai_key') || '';
  const status = state.config?.status || {
    supabase: true,
    d1: true,
    openai: !!savedOpenAIKey,
    google: googleStatus.connected,
    ebay: me?.ebay_configured,
    bricklink: me?.bricklink_configured,
    brickeconomy: me?.brickeconomy_configured,
    brickset: false,
    brickowl: false,
    rebrickable: false
  };
  const googleConfigured = googleStatus.configured ?? status.google;
  const googleSetup = state.config?.setup?.google || {};
  const googleMissing = Array.isArray(googleSetup.missing_secrets) ? googleSetup.missing_secrets : ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
  const googleSetupMessage = googleSetup.recommended_action
    || `Missing Worker secrets: ${googleMissing.join(", ")}. Add them as GitHub Actions secrets and redeploy to enable account linking.`;

  const showcase = publicProfile?.showcase || [];
  let trophyShelfHTML = '';
  if (!guest && me.handle && me.is_public) {
    trophyShelfHTML = `
      <div class="section-title">Trophy Shelf (${showcase.length}/6)</div>
      <div class="card" style="padding:14px 16px;margin-bottom:14px;">
        <div class="trophy-shelf scrollable" style="display:flex;gap:12px;overflow-x:auto;padding-bottom:8px;margin-bottom:12px;">
          ${showcase.map(s => {
            const hasImg = s.image_url && !s.image_url.startsWith("data:");
            const h = setHue(s);
            return `
              <div class="trophy-card" style="width:104px;flex-shrink:0;position:relative;">
                <button class="remove-trophy-btn" data-set="${escapeHtml(s.set_num)}" style="position:absolute;top:-4px;right:-4px;background:var(--bv-red);color:#fff;border:none;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:10;font-size:12px;line-height:1;font-weight:bold;">×</button>
                <div class="set-card-img${hasImg ? " has-photo" : ""}" style="height:70px;border-radius:var(--r-2);position:relative;">
                  <div class="brick-tile" style="--h:${h};width:64%;height:64%;"></div>
                  ${hasImg ? `<img class="set-photo" src="${escapeHtml(s.image_url)}" alt="" loading="lazy">` : ""}
                </div>
                <div style="font-size:11px;font-weight:500;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(s.name)}</div>
              </div>
            `;
          }).join("")}
          ${showcase.length < 6 ? `
            <button id="addTrophyBtn" style="width:104px;height:95px;flex-shrink:0;border:2.5px dashed var(--line);border-radius:var(--r-2);background:var(--surface-2);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;cursor:pointer;color:var(--ink-soft);outline:none;">
              <span style="font-size:20px;">+</span>
              <span style="font-size:11px;font-weight:600;">Add to shelf</span>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }

  $("#root").innerHTML = `
    <div class="page">
      <div class="topbar">
        <div class="topbar-heading">
          <div class="topbar-eyebrow">${guest ? "Local guest" : "@" + escapeHtml(me.handle || "you")}</div>
          <div class="topbar-title">Profile</div>
        </div>
      </div>

      <div class="profile-head">
        <div class="avatar">${(me.display_name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}</div>
        <div style="flex:1;min-width:0;">
          <div class="profile-name">${escapeHtml(me.display_name || "Collector")}</div>
          <div class="profile-handle">${guest ? "Guest mode - saved on this device" : "Member - Brickvault"}</div>
        </div>
        <button class="profile-pencil" aria-label="Edit name" id="editName">${I.pencil()}</button>
      </div>

      <div class="summary-grid">
        <div class="summary-cell"><div class="lbl">Sets owned</div><div class="val">${c.set_count || 0}</div></div>
        <div class="summary-cell"><div class="lbl">Total value</div><div class="val">${fmtMoneyShort(c.total_value || 0)}</div></div>
        <div class="summary-cell"><div class="lbl">Invested</div><div class="val">${fmtMoneyShort(c.total_paid || 0)}</div></div>
        <div class="summary-cell">
          <div class="lbl">Gain</div>
          <div class="val" style="color:${gain >= 0 ? "var(--up)" : "var(--down)"};">${fmtMoneyShort(gain)}</div>
          <div class="delta ${gain >= 0 ? "up" : "down"}" style="margin-top:6px;"><span class="arrow">${gain >= 0 ? "▲" : "▼"}</span>${fmtPct(Math.abs(gainPct))}</div>
        </div>
      </div>

      ${state.pwa.deferredPrompt ? `
        <button class="install-card" id="installBtn">
          <div class="install-icon">${I.download()}</div>
          <div class="install-text">
            <div class="install-t1">Install Brickvault</div>
            <div class="install-t2">Add to your home screen for a full-screen, app-like experience.</div>
          </div>
          ${I.arrowR()}
        </button>` : ""}

      ${guest ? guestModeCardHTML() : ""}
      ${publicProfileSectionHTML(me)}
      ${trophyShelfHTML}

      <div class="section-title">Preferences</div>
      <div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Appearance</div><div class="desc">Match your device or pick a side.</div></div>
          <div class="theme-seg" id="themeSeg" role="group" aria-label="Theme">
            ${[["light","Light"],["auto","Auto"],["dark","Dark"]].map(([v,l]) =>
              `<button data-theme-val="${v}" class="${getThemePref() === v ? "active" : ""}" aria-pressed="${getThemePref() === v}">${l}</button>`).join("")}
          </div>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Price-drop alerts</div><div class="desc">Alert when wishlisted sets hit your target.</div></div>
          <button class="toggle ${me.notify_price_drops ? "on" : ""}" id="notifyToggle" aria-label="Toggle price-drop alerts" aria-pressed="${me.notify_price_drops}"></button>
        </div>
        <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
          <div class="lbl-wrap"><div class="lbl">Discord alerts</div><div class="desc">Post price-drop and spike alerts to a Discord channel.</div></div>
          <div style="display:flex;gap:8px;width:100%;">
            <input id="discordWebhook" type="url" placeholder="https://discord.com/api/webhooks/…" value="${me.discord_webhook_url ? escapeHtml(me.discord_webhook_url) : ""}" style="flex:1;min-width:0;font-size:12px;font-family:var(--mono);border:1px solid var(--line);border-radius:var(--r-1);padding:6px 10px;background:var(--surface-2);color:var(--ink);outline:none;" autocomplete="off" spellcheck="false" />
            <button id="discordWebhookSave" class="btn-secondary" style="font-size:12px;padding:6px 12px;white-space:nowrap;">Save</button>
            ${me.discord_webhook_url ? `<button id="discordWebhookClear" class="btn-secondary" style="font-size:12px;padding:6px 12px;color:var(--down);">Clear</button>` : ""}
          </div>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Currency</div><div class="desc">Display values in your local currency.</div></div>
          <select id="currencySelect" style="font-family:var(--mono);font-weight:600;font-size:14px;border:none;background:transparent;color:var(--ink);cursor:pointer;outline:none;text-align-last:right;">
            ${["USD","GBP","EUR","CAD","AUD"].map(cur => `<option value="${cur}" ${me.currency === cur ? "selected" : ""}>${cur}</option>`).join("")}
          </select>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Daily snapshot</div><div class="desc">Portfolio history captured at 02:00 daily.</div></div>
          <div style="font-family:var(--mono);font-size:12px;color:var(--up);">ACTIVE</div>
        </div>
      </div>

      ${me.is_admin ? `
      <div class="section-title">System Setup Checklist</div>
      <div class="card" style="padding:14px 16px;margin-bottom:14px;">
        <div style="display:flex;flex-direction:column;gap:10px;font-size:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span>Database (D1)</span>
            ${status.d1
              ? `<span style="color:var(--up);font-weight:600;display:inline-flex;align-items:center;gap:4px;">● Connected</span>`
              : `<span style="color:var(--bv-red);font-weight:600;display:inline-flex;align-items:center;gap:4px;">⚠️ Missing</span>`}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span>Authentication (Supabase)</span>
            ${status.supabase
              ? `<span style="color:var(--up);font-weight:600;display:inline-flex;align-items:center;gap:4px;">● Configured</span>`
              : `<span style="color:var(--bv-red);font-weight:600;display:inline-flex;align-items:center;gap:4px;">⚠️ Missing</span>`}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span>Server AI (OpenAI)</span>
            ${status.openai
              ? `<span style="color:var(--up);font-weight:600;display:inline-flex;align-items:center;gap:4px;">● Configured</span>`
              : `<span style="color:var(--ink-mute);font-weight:600;display:inline-flex;align-items:center;gap:4px;">⚠️ Unconfigured (use your own key)</span>`}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span>Google Sheets Integration</span>
            ${status.google
              ? `<span style="color:var(--up);font-weight:600;display:inline-flex;align-items:center;gap:4px;">● Configured</span>`
              : `<span style="color:var(--bv-red);font-weight:600;display:inline-flex;align-items:center;gap:4px;">⚠️ Unconfigured</span>`}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span>BrickLink Pricing API</span>
            ${status.bricklink
              ? `<span style="color:var(--up);font-weight:600;display:inline-flex;align-items:center;gap:4px;">● Connected</span>`
              : `<span style="color:var(--bv-red);font-weight:600;display:inline-flex;align-items:center;gap:4px;">⚠️ Unconfigured</span>`}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span>eBay Pricing API</span>
            ${status.ebay
              ? `<span style="color:var(--up);font-weight:600;display:inline-flex;align-items:center;gap:4px;">● Connected</span>`
              : `<span style="color:var(--ink-mute);font-weight:600;display:inline-flex;align-items:center;gap:4px;">⚠️ Unconfigured (sold comps disabled)</span>`}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span>BrickEconomy API</span>
            ${status.brickeconomy
              ? `<span style="color:var(--up);font-weight:600;display:inline-flex;align-items:center;gap:4px;">● Configured</span>`
              : `<span style="color:var(--bv-red);font-weight:600;display:inline-flex;align-items:center;gap:4px;">⚠️ Unconfigured</span>`}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span>Rebrickable Catalog API</span>
            ${status.rebrickable
              ? `<span style="color:var(--up);font-weight:600;display:inline-flex;align-items:center;gap:4px;">OK Configured</span>`
              : `<span style="color:var(--bv-red);font-weight:600;display:inline-flex;align-items:center;gap:4px;">Missing</span>`}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span>Brickset Metadata API</span>
            ${status.brickset
              ? `<span style="color:var(--up);font-weight:600;display:inline-flex;align-items:center;gap:4px;">OK Configured</span>`
              : `<span style="color:var(--ink-mute);font-weight:600;display:inline-flex;align-items:center;gap:4px;">Optional</span>`}
          </div>
          ${(!status.supabase || !status.google || !status.ebay || !status.brickeconomy || !status.openai || !status.rebrickable) ? `
            <div style="font-size:10px;color:var(--ink-mute);border-top:1px solid var(--line-soft);padding-top:8px;line-height:1.4;display:flex;flex-direction:column;gap:4px;">
              <span>To configure integrations, set the following environment variables in your Cloudflare dashboard:</span>
              <code style="word-break: break-all;">DB (D1 Binding), SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_JWT_SECRET, OPENAI_API_KEY, REBRICKABLE_API_KEY, BRICKSET_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, EBAY_APP_ID, EBAY_CLIENT_SECRET, BRICKECONOMY_API_KEY</code>
            </div>
          ` : ''}
        </div>
      </div>
      ` : ''}

      <div class="section-title">Google Sheets Sync</div>
      <div>
        <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
          <div class="lbl-wrap">
            <div class="lbl">Google Sheets Auto-Sync</div>
            <div class="desc">Keep your spreadsheet "MyBricks Vault" in sync in the background.</div>
          </div>
          ${googleStatus.connected ? `
            <div style="display:flex;flex-direction:column;gap:8px;width:100%;">
              <div style="font-size:12px;color:var(--up);font-weight:600;display:flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:8px;height:8px;background:var(--up);border-radius:50%;"></span>
                Connected to Google Sheets
              </div>
              ${googleStatus.spreadsheet_id ? `
                <div style="font-size:11px;color:var(--ink-mute);">
                  Spreadsheet ID: <a href="https://docs.google.com/spreadsheets/d/${googleStatus.spreadsheet_id}" target="_blank" rel="noopener" style="text-decoration:underline;color:var(--ink);">${googleStatus.spreadsheet_id.slice(0, 16)}...</a>
                </div>
              ` : ''}
              <div style="display:flex;gap:8px;margin-top:4px;width:100%;">
                <button class="btn-secondary" id="syncGoogleNowBtn" style="flex:1;font-size:12px;padding:8px 12px;border:1.5px solid var(--line);border-radius:var(--r-2);background:var(--surface-2);color:var(--ink);cursor:pointer;outline:none;">Sync Now</button>
                <button class="btn-secondary" id="disconnectGoogleBtn" style="color:var(--bv-red);font-size:12px;padding:8px 12px;border:1.5px solid var(--line);border-radius:var(--r-2);background:var(--surface-2);cursor:pointer;outline:none;">Disconnect</button>
              </div>
            </div>
          ` : !googleConfigured ? `
            <div style="width:100%;border:1.5px solid var(--line-soft);border-radius:var(--r-2);background:var(--surface-2);padding:10px 12px;font-size:12px;color:var(--ink-mute);line-height:1.45;">
              Google Sheets is disabled until OAuth is configured. ${escapeHtml(googleSetupMessage)}
            </div>
          ` : `
            <button class="btn-primary" id="connectGoogleBtn" style="width:100%;font-size:13px;padding:10px 14px;background:#4285F4;border-color:#4285F4;color:#fff;border-radius:var(--r-2);cursor:pointer;outline:none;display:flex;align-items:center;justify-content:center;gap:6px;">
              ${I.extLink()} <span>Connect Google Sheets</span>
            </button>
          `}
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
            <div style="display:flex;flex-direction:column;gap:8px;width:100%;">
              <div style="font-size:12px;color:var(--up);font-weight:600;display:flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:8px;height:8px;background:var(--up);border-radius:50%;"></span>
                Brickset account connected
              </div>
              <div style="display:flex;gap:8px;width:100%;">
                <button id="bricksetSyncBtn" class="btn-secondary" style="flex:1;font-size:12px;padding:8px 12px;border:1.5px solid var(--line);border-radius:var(--r-2);background:var(--surface-2);color:var(--ink);cursor:pointer;outline:none;">Sync Now</button>
                <button id="bricksetDisconnectBtn" class="btn-secondary" style="font-size:12px;padding:8px 12px;border:1.5px solid var(--line);border-radius:var(--r-2);background:var(--surface-2);color:var(--down);cursor:pointer;outline:none;">Disconnect</button>
              </div>
              <div id="bricksetSyncResult" style="font-size:11px;color:var(--ink-mute);"></div>
            </div>
          ` : `
            <div style="display:flex;flex-direction:column;gap:8px;width:100%;">
              <input id="bricksetUsername" type="text" placeholder="Brickset username" autocomplete="username" style="font-size:13px;border:1px solid var(--line);border-radius:var(--r-1);padding:8px 10px;background:var(--surface-2);color:var(--ink);outline:none;width:100%;box-sizing:border-box;" />
              <input id="bricksetPassword" type="password" placeholder="Brickset password" autocomplete="current-password" style="font-size:13px;border:1px solid var(--line);border-radius:var(--r-1);padding:8px 10px;background:var(--surface-2);color:var(--ink);outline:none;width:100%;box-sizing:border-box;" />
              <button id="bricksetConnectBtn" class="btn-primary" style="width:100%;font-size:13px;padding:10px 14px;border-radius:var(--r-2);cursor:pointer;outline:none;">Connect Brickset Account</button>
              <div id="bricksetConnectError" style="font-size:11px;color:var(--down);display:none;"></div>
            </div>
          `}
        </div>
      </div>

      ${me.is_admin ? `
      <div class="section-title">Catalog</div>
      <div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Import sets</div><div class="desc" id="importSetsDesc">~22k sets from Rebrickable with themes &amp; images</div></div>
          <button class="import-btn" id="importSetsBtn" aria-label="Import sets">${I.download()}</button>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Import minifigs</div><div class="desc" id="importFigsDesc">~10k minifigures from Rebrickable</div></div>
          <button class="import-btn" id="importFigsBtn" aria-label="Import minifigs">${I.download()}</button>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Backfill barcodes</div><div class="desc" id="backfillUpcDesc">Daily safe slices from Brickset; press to advance now</div></div>
          <button class="import-btn" id="backfillUpcBtn" aria-label="Backfill barcodes">${I.download()}</button>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Populate coverage</div><div class="desc" id="populateCoverageDesc">One safe slice: barcode pages plus eBay sold prices</div></div>
          <button class="import-btn" id="populateCoverageBtn" aria-label="Populate coverage">${I.refresh({w: 16, h: 16})}</button>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Revalue prices</div><div class="desc" id="revalueAllDesc">Daily safe valuation batches; press to advance now</div></div>
          <button class="import-btn" id="revalueAllBtn" aria-label="Revalue all prices">${I.refresh({w: 16, h: 16})}</button>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Populate everything</div><div class="desc" id="populateEverythingDesc">Auto-runs safe slices from every configured data source</div></div>
          <button class="import-btn" id="populateEverythingBtn" aria-label="Populate all configured data sources">${I.refresh({w: 16, h: 16})}</button>
        </div>
      </div>
      <div class="section-title">Import & Revalue Jobs</div>
      <div class="card" style="padding:14px 16px;margin-bottom:14px;">
        <div id="jobsStatusContainer" style="display:flex;flex-direction:column;gap:8px;font-size:12px;color:var(--ink-soft);">
          Loading jobs status...
        </div>
      </div>
      <div class="section-title">Integrations Health</div>
      <div class="card" style="padding:14px 16px;margin-bottom:14px;">
        <div id="integrationsHealthContainer" style="display:flex;flex-direction:column;gap:8px;font-size:12px;color:var(--ink-soft);">
          Loading integrations status...
        </div>
      </div>
      ` : ""}

      <div class="section-title">AI Scanning</div>
      <div>
        <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
          <div class="lbl-wrap">
            <div class="lbl">Gemini API key (free)</div>
            <div class="desc">${savedGeminiKey ? "Active - powers scans, advisor, listings, and valuation fallback on your Google quota" : 'Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="color:var(--bv-red);font-weight:600;text-decoration:underline;">aistudio.google.com/apikey</a> - bypasses shared AI limits'}</div>
          </div>
          <div style="display:flex;gap:8px;width:100%;">
            <input type="password" id="geminiKeyInput" value="${escapeHtml(savedGeminiKey)}" placeholder="AIza..."
              style="flex:1;padding:10px;border:1.5px solid var(--line);border-radius:var(--r-2);background:var(--surface-2);color:var(--ink);font-size:13px;font-family:var(--mono);outline:none;">
            <button class="btn-secondary" id="saveGeminiKey" style="white-space:nowrap;">Save</button>
          </div>
        </div>
        <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
          <div class="lbl-wrap">
            <div class="lbl">OpenAI key (optional)</div>
            <div class="desc">${savedOpenAIKey ? "Active - powers scans, advisor, and listing drafts with your key" : "Optional: use your own OpenAI key for scans, advisor, and listing drafts"}</div>
          </div>
          <div style="display:flex;gap:8px;width:100%;">
            <input type="password" id="openaiKeyInput" value="${escapeHtml(savedOpenAIKey)}" placeholder="sk-..."
              style="flex:1;padding:10px;border:1.5px solid var(--line);border-radius:var(--r-2);background:var(--surface-2);color:var(--ink);font-size:13px;font-family:var(--mono);outline:none;">
            <button class="btn-secondary" id="saveOpenAIKey" style="white-space:nowrap;">Save</button>
          </div>
        </div>
      </div>

      <div class="section-title">Data</div>
      <div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Export collection</div><div class="desc">CSV with all collector fields &amp; ROI.</div></div>
          <button class="import-btn" id="exportCsvBtn" aria-label="Export CSV">${I.download()}</button>
        </div>
        <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
          <div class="lbl-wrap">
            <div class="lbl">Import collection</div>
            <div class="desc">Upload a CSV to add sets in bulk. Existing sets are skipped.</div>
          </div>
          <div class="csv-import-wrap">
            <label class="csv-file-label">${I.download()}<span>Choose CSV file</span><input type="file" id="csvFile" accept=".csv"></label>
            <span id="csvFileName"></span>
            <button class="btn-primary" id="csvImportBtn" style="display:none;">${I.plus()}<span>Import</span></button>
          </div>
          <div id="csvImportResult" style="font-size:13px;color:var(--ink-mute);font-family:var(--mono);"></div>
        </div>
        <div class="setting-row" id="${guest ? "signInRow" : "signOutRow"}" style="cursor:pointer;">
          <div class="lbl-wrap"><div class="lbl">${guest ? "Sign in" : "Sign out"}</div><div class="desc">${guest ? "Sync your local vault across devices." : "Sync resumes when you return."}</div></div>
          ${I.chev()}
        </div>
      </div>

      <div style="text-align:center;font-family:var(--mono);font-size:10px;color:var(--ink-faint);margin-top:24px;letter-spacing:0.1em;">
        BRICKVAULT · v5.0 · STACK SOMETHING BEAUTIFUL
      </div>
    </div>`;

  $("#installBtn")?.addEventListener("click", async () => {
    const dp = state.pwa.deferredPrompt;
    if (!dp) return;
    haptic("medium");
    dp.prompt();
    try {
      const { outcome } = await dp.userChoice;
      if (outcome === "accepted") toast("Installing Brickvault…", "success");
    } catch {}
    state.pwa.deferredPrompt = null;
    $("#installBtn")?.remove();
  });

  ["#guestSignInBtn", "#profileSignInBtn", "#signInRow"].forEach(sel => {
    $(sel)?.addEventListener("click", () => {
      haptic("medium");
      go("#/login");
    });
  });

  $$("#themeSeg button").forEach(b => b.addEventListener("click", () => {
    const val = b.dataset.themeVal;
    haptic("light");
    setThemePref(val);
    $$("#themeSeg button").forEach(x => {
      const on = x === b;
      x.classList.toggle("active", on);
      x.setAttribute("aria-pressed", on);
    });
  }));

  let notifyOn = me.notify_price_drops;
  $("#notifyToggle")?.addEventListener("click", async (e) => {
    notifyOn = !notifyOn;
    e.currentTarget.classList.toggle("on", notifyOn);
    haptic("medium");
    try { await api("/api/me", { method: "PATCH", body: { notify_price_drops: notifyOn } }); state.me = null; }
    catch {}
    toast(notifyOn ? "Alerts on" : "Alerts paused", "info");
  });
  
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
      await renderMe();
    } catch (e) { toast("Error: " + e.message, "error"); }
  });

  $("#discordWebhookClear")?.addEventListener("click", async () => {
    haptic("medium");
    try {
      await api("/api/me", { method: "PATCH", body: { discord_webhook_url: null } });
      state.me = null;
      toast("Discord alerts cleared", "info");
      await renderMe();
    } catch (e) { toast("Error: " + e.message, "error"); }
  });

  // Brickset connect — server exchanges username+password for userHash and stores it
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
      await renderMe();
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
      await renderMe();
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
      state.portfolio = null; invalidatePortfolio();
    } catch (e) {
      if (resultEl) resultEl.textContent = "Sync failed: " + e.message;
      toast("Brickset sync failed: " + e.message, "error");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Sync Now"; }
    }
  });

  $("#currencySelect")?.addEventListener("change", async (e) => {
    const val = e.target.value;
    haptic("medium");
    try {
      await api("/api/me", { method: "PATCH", body: { currency: val } });
      if (state.me) state.me.currency = val;
      bvIDB.del('portfolio').catch(() => {});
      invalidatePortfolio();
      state.portfolioHistory = null;
      toast("Currency updated to " + val, "success");
      await renderMe();
    } catch {}
  });

  $("#editName")?.addEventListener("click", async () => {
    const res = await promptSheet({ title: "Edit Display Name", label: "Display Name", value: me.display_name || "" });
    if (res === null) return;
    try {
      await api("/api/me", { method: "PATCH", body: { display_name: res } });
      state.me = null;
      toast("Name updated", "success");
      await renderMe();
    } catch (e) {
      toast("Error: " + e.message, "error");
    }
  });

  // Trophy shelf hooks
  $$(".remove-trophy-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const setNum = btn.dataset.set;
      const newShowcase = showcase.filter(s => s.set_num !== setNum).map(s => s.set_num);
      haptic("medium");
      try {
        await api("/api/users/" + encodeURIComponent(me.handle) + "/showcase", {
          method: "POST",
          body: { set_nums: newShowcase }
        });
        toast("Removed from trophy shelf", "success");
        await renderMe();
      } catch (err) {
        toast("Failed to update: " + err.message, "error");
      }
    });
  });

  $("#addTrophyBtn")?.addEventListener("click", () => {
    showSearchableTrophyPicker(showcase.map(s => s.set_num));
  });

  // Public Profile privacy & configuration hooks
  $("#saveHandleBtn")?.addEventListener("click", async () => {
    const h = ($("#chooseHandleInp")?.value || "").trim().toLowerCase();
    if (!h) { toast("Enter a handle", "info"); return; }
    if (!/^[a-zA-Z0-9-]{3,30}$/.test(h)) { toast("Handle: 3-30 chars, letters, numbers, hyphens only", "error"); return; }
    try {
      await api("/api/me", { method: "PATCH", body: { handle: h } });
      state.me = null;
      toast("Handle saved successfully", "success");
      await renderMe();
    } catch (err) {
      toast("Error: " + err.message, "error");
    }
  });

  let isPublicState = me.is_public;
  $("#publicToggle")?.addEventListener("click", async (e) => {
    isPublicState = !isPublicState;
    e.currentTarget.classList.toggle("on", isPublicState);
    haptic("medium");
    try {
      await api("/api/me", { method: "PATCH", body: { is_public: isPublicState } });
      state.me = null;
      toast(isPublicState ? "Profile public" : "Profile private", "info");
      await renderMe();
    } catch (err) {
      toast("Error: " + err.message, "error");
    }
  });

  let epvState = me.expose_public_value;
  $("#publicValToggle")?.addEventListener("click", async (e) => {
    epvState = !epvState;
    e.currentTarget.classList.toggle("on", epvState);
    haptic("medium");
    try {
      await api("/api/me", { method: "PATCH", body: { expose_public_value: epvState } });
      state.me = null;
      toast(epvState ? "Valuation visible publicly" : "Valuation hidden publicly", "info");
      await renderMe();
    } catch (err) {
      toast("Error: " + err.message, "error");
    }
  });

  $("#copyProfileUrl")?.addEventListener("click", () => {
    const url = `${location.origin}/#/u/${encodeURIComponent(me.handle)}`;
    navigator.clipboard.writeText(url).then(() => {
      toast("Link copied to clipboard", "success");
    }).catch(() => {
      toast("Failed to copy link", "error");
    });
  });

  // Google Sheets hooks (Secure Code flow redirect)
  $("#connectGoogleBtn")?.addEventListener("click", async () => {
    haptic("light");
    if (guest) {
      go("#/login");
      return;
    }
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
      await renderMe();
    } catch (e) {
      toast("Error: " + e.message, "error");
    }
  });

  // Admin Catalog hooks
  $("#importSetsBtn")?.addEventListener("click", () => triggerImport("sets"));
  $("#importFigsBtn")?.addEventListener("click", () => triggerImport("figs"));
  $("#backfillUpcBtn")?.addEventListener("click", () => triggerImport("upc"));
  $("#populateCoverageBtn")?.addEventListener("click", () => triggerImport("populate"));
  $("#revalueAllBtn")?.addEventListener("click", () => triggerImport("revalue"));
  $("#populateEverythingBtn")?.addEventListener("click", () => triggerImport("everything"));

  // API Key hooks — validate with a minimal live call before saving so a bad
  // or quota-exhausted key fails loudly here instead of silently in the scanner.
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
        renderMe();
        return;
      }
      setBtnLoading(btn, true);
      try {
        await validateApiKey(provider, val);
        localStorage.setItem(storageKey, val);
        state.me = null;
        toast(`${label} key verified and saved`, "success");
        renderMe();
      } catch (e) {
        toast(`${label}: ${e.message}`, "error");
      } finally {
        setBtnLoading(btn, false);
      }
    });
  };
  wireKeySave("#saveGeminiKey", "#geminiKeyInput", "bv_gemini_key", "gemini", "Gemini");
  wireKeySave("#saveOpenAIKey", "#openaiKeyInput", "bv_openai_key", "openai", "OpenAI");

  // CSV Import/Export hooks
  $("#exportCsvBtn")?.addEventListener("click", async () => {
    haptic("medium");
    try {
      if (guest) {
        const blob = guestCollectionCSVBlob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "brickvault-collection.csv";
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
      const token = _authSession?.access_token;
      const res = await fetch((window.WORKER_BASE || "") + "/api/collection/export", {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "brickvault-collection.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast("Error exporting: " + e.message, "error");
    }
  });

  const fileInput = $("#csvFile");
  const importBtn = $("#csvImportBtn");
  const fileNameSpan = $("#csvFileName");

  fileInput?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) {
      fileNameSpan.textContent = file.name;
      importBtn.style.display = "inline-flex";
    } else {
      fileNameSpan.textContent = "";
      importBtn.style.display = "none";
    }
  });

  importBtn?.addEventListener("click", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    haptic("medium");
    setBtnLoading(importBtn, true);
    const resultEl = $("#csvImportResult");
    if (resultEl) resultEl.textContent = "Uploading & parsing...";
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (!rows.length) throw new Error("No valid rows found — check set_num column exists");

      // Preview before applying — imports are hard to undo.
      const sample = rows.slice(0, 3)
        .map(r => `${r.set_num}${r.quantity > 1 ? ` ×${r.quantity}` : ''}`)
        .join(', ');
      setBtnLoading(importBtn, false);
      if (resultEl) resultEl.textContent = "";
      const ok = await confirmSheet({
        title: `Import ${rows.length} set${rows.length === 1 ? '' : 's'}?`,
        message: `Starting with: ${sample}${rows.length > 3 ? ` and ${rows.length - 3} more` : ''}. Existing sets are kept.`,
        confirmLabel: "Import",
      });
      if (!ok) return;
      setBtnLoading(importBtn, true);
      if (resultEl) resultEl.textContent = "Importing...";

      const r = await api("/api/collection/import", { method: "POST", body: { rows } });
      if (resultEl) resultEl.textContent = `✓ ${r.imported} imported, ${r.skipped} skipped${r.errors?.length ? `, ${r.errors.length} errors` : ""}`;
      invalidatePortfolio();
      toast(`${r.imported} sets imported`, "success");
    } catch (e) {
      if (resultEl) resultEl.textContent = "Error: " + e.message;
      toast("Import failed: " + e.message, "error");
    } finally {
      setBtnLoading(importBtn, false);
    }
  });

  if (me.is_admin) {
    updateJobsStatus();
    updateIntegrationsHealth();
  }

  $("#signOutRow")?.addEventListener("click", async () => {
    haptic("medium");
    await sbSignOut();
    invalidatePortfolio(); state.me = null; state.catalog.items = [];
    state.blind.items = []; state.wishlist = []; state.portfolioHistory = null;
    try {
      await Promise.all([
        bvIDB.del('portfolio'),
        bvIDB.del('catalog'),
        bvIDB.del('blind')
      ]);
    } catch {}
    go("#/");
  });
}

function parseCSV(text) {
  const table = parseCSVTable(text);
  if (!table.length) return [];
  const header = table[0].map(h => h.trim().replace(/^["']|["']$/g, ""));
  const normHeader = header.map(h => h.toLowerCase().replace(/\s+/g, "_"));
  const findIdx = (...names) => {
    const wanted = names.map(n => n.toLowerCase().replace(/\s+/g, "_"));
    return normHeader.findIndex(h => wanted.includes(h));
  };
  const setNumIdx = findIdx("set_num", "set_number");
  if (setNumIdx === -1) return [];

  const quantityIdx = findIdx("quantity");
  const priceIdx = findIdx("purchase_price");
  const condIdx = findIdx("condition");
  const dateIdx = findIdx("purchased_at", "date_added");
  const notesIdx = findIdx("notes");
  const storageIdx = findIdx("storage_location");
  const sourceIdx = findIdx("acquisition_source");
  const completeIdx = findIdx("is_complete");
  const missingIdx = findIdx("missing_pieces");

  const rows = [];
  for (let i = 1; i < table.length; i++) {
    const parts = table[i].map(p => String(p || "").trim());
    if (!parts.some(Boolean)) continue;
    const set_num = parts[setNumIdx];
    if (!set_num) continue;
    const quantity = quantityIdx !== -1 ? (parseInt(parts[quantityIdx], 10) || 1) : 1;
    const purchase_price = priceIdx !== -1 ? optionalNumber(parts[priceIdx]) : null;
    let condition = condIdx !== -1 ? parts[condIdx].toLowerCase() : "new";
    if (condition.includes("accept")) condition = "used_acceptable";
    else if (condition.includes("good") || condition.includes("used")) condition = "used_good";
    else if (condition.includes("seal")) condition = "sealed";
    else condition = "new";

    let purchased_at = dateIdx !== -1 ? parts[dateIdx] : null;
    if (purchased_at) {
      const parsed = Date.parse(purchased_at);
      if (!isNaN(parsed)) {
        purchased_at = new Date(parsed).toISOString().slice(0,10);
      } else {
        purchased_at = null;
      }
    }
    const row = { set_num, quantity, purchase_price, condition, purchased_at };
    if (notesIdx !== -1) row.notes = parts[notesIdx] || null;
    if (storageIdx !== -1) row.storage_location = parts[storageIdx] || null;
    if (sourceIdx !== -1) row.acquisition_source = parts[sourceIdx] || null;
    if (completeIdx !== -1) row.is_complete = parts[completeIdx] === "" ? true : !/^(false|0|no)$/i.test(parts[completeIdx]);
    if (missingIdx !== -1) row.missing_pieces = parseInt(parts[missingIdx], 10) || 0;
    rows.push(row);
  }
  return rows;
}

function parseCSVTable(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some(v => String(v).trim() !== "")) rows.push(row);
  return rows;
}

function optionalNumber(value) {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function guestModeCardHTML() {
  return `
    <div class="card" style="padding:14px 16px;margin-bottom:14px;">
      <div style="font-weight:600;font-size:14px;margin-bottom:6px;">Local guest vault</div>
      <div style="font-size:13px;color:var(--ink-mute);line-height:1.45;margin-bottom:12px;">
        Your sets are saved on this device. Sign in before switching devices to sync your vault, publish a profile, unlock Trophy Shelf, and connect Google Sheets.
      </div>
      <button class="btn-primary" id="guestSignInBtn" style="width:100%;">${I.user()}<span>Sign in to sync</span></button>
    </div>
  `;
}

function publicProfileSectionHTML(me) {
  if (me.is_guest) {
    return `
      <div class="section-title">Public Profile</div>
      <div class="card" style="padding:14px 16px;margin-bottom:14px;">
        <div style="font-size:13px;color:var(--ink-mute);line-height:1.45;margin-bottom:12px;">
          Public profiles and Trophy Shelf sync require an account.
        </div>
        <button class="btn-secondary" id="profileSignInBtn" style="width:100%;">${I.user()}<span>Sign in</span></button>
      </div>
    `;
  }
  if (!me.handle) {
    return `
      <div class="section-title">Public Profile</div>
      <div class="card" style="padding:14px 16px;margin-bottom:14px;">
        <div style="font-size:13px;color:var(--ink-mute);margin-bottom:12px;line-height:1.45;">
          Choose a unique username/handle to create a public profile page showing off your stats and Trophy Shelf.
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <input type="text" id="chooseHandleInp" placeholder="your-name" style="flex:1 1 180px;min-width:0;padding:10px;border:1.5px solid var(--line);border-radius:var(--r-2);background:var(--surface-2);color:var(--ink);font-size:14px;outline:none;font-family:var(--sans);">
          <button class="btn-primary" id="saveHandleBtn" style="width:auto;max-width:100%;white-space:nowrap;padding:10px 16px;">Set Handle</button>
        </div>
      </div>
    `;
  }
  const url = `${location.origin}/#/u/${encodeURIComponent(me.handle)}`;
  return `
    <div class="section-title">Public Profile</div>
    <div class="card" style="padding:14px 16px;margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <span style="font-weight:600;font-size:13px;">Public Portfolio</span>
        <button class="toggle ${me.is_public ? "on" : ""}" id="publicToggle" aria-label="Toggle public profile" aria-pressed="${me.is_public}"></button>
      </div>
      <div style="font-size:12px;color:var(--ink-mute);margin-bottom:12px;line-height:1.45;">
        When turned on, anyone with the link can view your collection and showcase shelf.
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;margin-top:14px;border-top:1px solid var(--line-soft);padding-top:10px;">
        <span style="font-weight:600;font-size:13px;">Show total valuation</span>
        <button class="toggle ${me.expose_public_value ? "on" : ""}" id="publicValToggle" aria-label="Toggle public valuation" aria-pressed="${me.expose_public_value}"></button>
      </div>
      <div style="font-size:12px;color:var(--ink-mute);margin-bottom:12px;line-height:1.45;">
        Expose the total value and thematic breakdown of your collection on your public profile.
      </div>
      <div style="background:var(--surface-3);border:1.5px solid var(--line-soft);border-radius:var(--r-2);padding:10px;font-size:12px;display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
        <a href="${url}" style="color:var(--accent);text-decoration:underline;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;">${url}</a>
        <button class="btn-secondary" id="copyProfileUrl" style="padding:6px 12px;font-size:11px;width:auto;margin:0;">Copy</button>
      </div>
    </div>
  `;
}

function showSearchableTrophyPicker(currentSetNums) {
  const me = state.me;
  if (!me?.handle) return;
  const ownedItems = state.portfolio?.items || [];
  
  showSheet(`
    <div style="font-family:var(--serif);font-size:22px;font-weight:500;margin:0 4px 12px;">Add to Trophy Shelf</div>
    <div class="search-wrap" style="margin: 0 4px 14px;">
      <span class="s-icon">${I.search()}</span>
      <input class="search-input" id="trophySearchInput" placeholder="Search your collection…" autocomplete="off">
    </div>
    <div id="trophyPickerResults" class="scrollable" style="max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; margin: 4px;"></div>
    <button class="btn-secondary" id="trophyPickerClose" style="margin-top: 14px;">Close</button>
  `);

  const resultsDiv = document.getElementById("trophyPickerResults");
  const searchInp = document.getElementById("trophySearchInput");

  function renderResults(q = "") {
    const query = q.toLowerCase().trim();
    const filtered = ownedItems.filter(item => 
      !currentSetNums.includes(item.set_num) && 
      (item.name?.toLowerCase().includes(query) || item.set_num?.toLowerCase().includes(query) || item.theme?.toLowerCase().includes(query))
    );

    if (filtered.length === 0) {
      resultsDiv.innerHTML = `<div style="text-align:center;padding:24px;color:var(--ink-mute);font-size:13px;">No sets found</div>`;
      return;
    }

    resultsDiv.innerHTML = filtered.map(item => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--surface-2);border-radius:var(--r-2);">
        <div style="min-width:0;flex:1;margin-right:12px;">
          <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.name)}</div>
          <div style="font-size:11px;color:var(--ink-mute);">${escapeHtml(item.set_num)} · ${escapeHtml(item.theme || '')}</div>
        </div>
        <button class="btn-primary add-trophy-item-btn" data-set="${escapeHtml(item.set_num)}" style="padding:6px 12px;font-size:12px;width:auto;">Add</button>
      </div>
    `).join("");

    resultsDiv.querySelectorAll(".add-trophy-item-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        haptic("light");
        const setNum = btn.dataset.set;
        const newShowcase = [...currentSetNums, setNum];
        try {
          btn.disabled = true;
          btn.textContent = "...";
          await api("/api/users/" + encodeURIComponent(me.handle) + "/showcase", {
            method: "POST",
            body: { set_nums: newShowcase }
          });
          toast("Added to trophy shelf", "success");
          hideSheet();
          await renderMe();
        } catch (err) {
          toast("Error adding: " + err.message, "error");
          btn.disabled = false;
          btn.textContent = "Add";
        }
      });
    });
  }

  renderResults();

  searchInp.addEventListener("input", (e) => renderResults(e.target.value));
  $("#trophyPickerClose").addEventListener("click", hideSheet);
}

const ADMIN_JOB_TOOLS = {
  sets: { url: "/api/admin/import-rebrickable", method: "POST", body: { dataset: "sets" }, desc: "importSetsDesc", btn: "importSetsBtn", text: "Importing sets...", idle: "~22k sets from Rebrickable with themes & images" },
  figs: { url: "/api/admin/import-rebrickable", method: "POST", body: { dataset: "figs" }, desc: "importFigsDesc", btn: "importFigsBtn", text: "Importing figs...", idle: "~10k minifigures from Rebrickable" },
  upc: { url: "/api/admin/backfill-upc", method: "POST", body: {}, desc: "backfillUpcDesc", btn: "backfillUpcBtn", text: "Backfilling UPC...", idle: "Daily safe slices from Brickset; press to advance now" },
  populate: { url: "/api/admin/populate-coverage", method: "POST", body: {}, desc: "populateCoverageDesc", btn: "populateCoverageBtn", text: "Populating coverage...", idle: "One safe slice: barcode pages plus eBay sold prices" },
  revalue: { url: "/api/admin/revalue-brickeconomy", method: "POST", body: { scope: "all", limit: 4 }, desc: "revalueAllDesc", btn: "revalueAllBtn", text: "Revaluing prices...", idle: "Daily safe valuation batches; press to advance now" },
  everything: { url: "/api/admin/populate-everything", method: "POST", body: { valuation_limit: 6, barcode_pages: 4, ebay_limit: 2 }, desc: "populateEverythingDesc", btn: "populateEverythingBtn", text: "Populating everything...", idle: "Auto-runs safe slices from every configured data source" }
};

function adminToolFromJobType(jobType = "") {
  if (jobType === "catalog_sets") return "sets";
  if (jobType === "catalog_figs") return "figs";
  if (jobType === "catalog_all") return "sets";
  if (jobType === "barcode_backfill") return "upc";
  if (jobType === "populate_coverage") return "populate";
  if (jobType === "valuation") return "revalue";
  if (jobType === "populate_everything") return "everything";
  return null;
}

function setAdminJobButtons(runningType = null) {
  Object.entries(ADMIN_JOB_TOOLS).forEach(([key, cfg]) => {
    const btn = document.getElementById(cfg.btn);
    if (!btn) return;
    const busy = !!runningType;
    btn.disabled = busy;
    btn.setAttribute("aria-busy", busy && key === runningType ? "true" : "false");
  });
}

function setAdminJobDescriptions(runningType = null, text = "") {
  Object.entries(ADMIN_JOB_TOOLS).forEach(([key, cfg]) => {
    const desc = document.getElementById(cfg.desc);
    if (!desc) return;
    desc.textContent = runningType && key === runningType ? (text || cfg.text) : cfg.idle;
  });
}

function scheduleAdminJobPoll(delay = 2500) {
  if (adminJobPollTimer) clearTimeout(adminJobPollTimer);
  if (location.hash !== "#/me") return;
  adminJobPollTimer = setTimeout(() => {
    adminJobPollTimer = null;
    updateJobsStatus();
  }, delay);
}

function isPopulateEverythingComplete(run = {}) {
  return run.job_type === "populate_everything" && /method:populate-everything\b[^]*complete:true/i.test(String(run.error || ""));
}

function schedulePopulateEverythingContinue(delay = 1400) {
  if (populateEverythingContinueTimer) clearTimeout(populateEverythingContinueTimer);
  if (!populateEverythingAuto || location.hash !== "#/me") return;
  populateEverythingContinueTimer = setTimeout(() => {
    populateEverythingContinueTimer = null;
    if (populateEverythingAuto && !activeAdminRunId) triggerImport("everything");
  }, delay);
}

async function triggerImport(type) {
  const cnf = ADMIN_JOB_TOOLS[type];
  if (!cnf) return;
  if (activeAdminRunId) {
    toast("A catalog job is already running", "info");
    scheduleAdminJobPoll(500);
    return;
  }
  if (type === "everything") populateEverythingAuto = true;
  else populateEverythingAuto = false;
  haptic("medium");
  const descEl = document.getElementById(cnf.desc);
  const origText = descEl ? descEl.textContent : "";
  if (descEl) descEl.textContent = cnf.text;
  setAdminJobButtons(type);
  try {
    const r = await api(cnf.url, { method: cnf.method, body: cnf.body });
    activeAdminRunId = r.run_id || null;
    activeAdminTool = type;
    if (type === "everything" && r.done) populateEverythingAuto = false;
    toast(r.message || `Job #${activeAdminRunId || ""} started`, "success");
    await updateJobsStatus();
    scheduleAdminJobPoll(1200);
  } catch (e) {
    toast("Job failed: " + e.message, "error");
    if (descEl) descEl.textContent = origText;
    activeAdminRunId = null;
    activeAdminTool = null;
    populateEverythingAuto = false;
    if (populateEverythingContinueTimer) {
      clearTimeout(populateEverythingContinueTimer);
      populateEverythingContinueTimer = null;
    }
    setAdminJobButtons(null);
    setAdminJobDescriptions(null);
  }
}

async function updateJobsStatus() {
  const container = document.getElementById("jobsStatusContainer");
  if (!container) return;
  const ago = (ts) => {
    if (!ts) return "";
    const then = new Date(String(ts).replace(" ", "T") + "Z").getTime();
    const mins = Math.round((Date.now() - then) / 60000);
    if (!Number.isFinite(mins)) return "";
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
  };
  try {
    const data = await api("/api/admin/import-status");
    const runs = data.runs || [];
    if (runs.length === 0) {
      activeAdminRunId = null;
      activeAdminTool = null;
      setAdminJobButtons(null);
      setAdminJobDescriptions(null);
      if (adminJobPollTimer) {
        clearTimeout(adminJobPollTimer);
        adminJobPollTimer = null;
      }
      if (populateEverythingContinueTimer) {
        clearTimeout(populateEverythingContinueTimer);
        populateEverythingContinueTimer = null;
      }
      container.innerHTML = `<div style="color:var(--ink-mute);">No jobs have run yet.</div>`;
      return;
    }

    const classified = runs.map(run => ({ run, state: classifyJobRun(run) }));
    const runningRun = runs.find(run => String(run.status || "").toLowerCase() === "running");
    if (runningRun) {
      activeAdminRunId = runningRun.id;
      activeAdminTool = adminToolFromJobType(runningRun.job_type) || activeAdminTool;
    } else {
      activeAdminRunId = null;
      activeAdminTool = null;
    }
    const runningProgress = runningRun ? jobProgressSummary(runningRun) : null;
    setAdminJobButtons(activeAdminTool || (runningRun ? "active" : null));
    setAdminJobDescriptions(activeAdminTool, runningProgress?.label);
    const isStoppedRun = (run) => classifyJobRun(run).label === "Stopped" || /Timed out|Worker run stopped/i.test(String(run.error || ""));
    const hasCompleted = classified.some(x => x.state.label === "Completed");
    const hasRunning = classified.some(x => x.state.label === "Running");
    const retryableCount = classified.filter(x => x.state.retryable).length;
    const hardErrors = classified.filter(x => x.state.needsAttention);
    const activeProgressHTML = runningRun && runningProgress ? `
      <div style="margin-top:9px;">
        <div style="display:flex;justify-content:space-between;gap:10px;font-size:11px;color:var(--ink-soft);margin-bottom:5px;">
          <span>${escapeHtml(runningProgress.label)}</span>
          <span>${escapeHtml(runningProgress.countText || "working")}${runningProgress.pct != null ? ` / ${runningProgress.pct}%` : ""}</span>
        </div>
        <div style="height:8px;border:1px solid var(--line);border-radius:var(--r-full);background:var(--surface);overflow:hidden;">
          <div style="height:100%;width:${runningProgress.pct ?? 32}%;background:var(--bv-yellow);transition:width .25s ease;"></div>
        </div>
      </div>
    ` : "";
    const summaryHTML = `
      <div style="border:1.5px solid var(--line-soft);border-radius:var(--r-2);background:var(--surface-2);padding:10px 12px;margin-bottom:10px;">
        <div style="font-weight:700;font-size:12px;color:${hardErrors.length ? "var(--bv-red)" : hasRunning ? "var(--bv-yellow)" : "var(--up)"};">
          ${hardErrors.length ? `${hardErrors.length} hard job error${hardErrors.length === 1 ? "" : "s"} need attention` : hasRunning ? "Job running" : retryableCount ? `${retryableCount} retryable provider note${retryableCount === 1 ? "" : "s"}` : hasCompleted ? "Latest batches completed" : "No completed batches yet"}
        </div>
        <div style="font-size:11px;color:var(--ink-mute);line-height:1.45;margin-top:3px;">
          Provider no-data and stopped slices are safe to retry. D1/SQLite corruption and access errors are highlighted as hard failures.
        </div>
        ${activeProgressHTML}
      </div>`;

    container.innerHTML = summaryHTML + runs.map(run => {
      const jobState = classifyJobRun(run);
      const statusColor = jobState.tone === "ok" ? "var(--up)"
        : jobState.tone === "warn" ? "var(--bv-yellow)"
        : jobState.tone === "danger" ? "var(--bv-red)"
        : "var(--ink-mute)";
      const statusText = jobState.label.toUpperCase();
      const progress = jobProgressSummary(run);

      const dateStr = run.started_at ? new Date(run.started_at.replace(" ", "T") + "Z").toLocaleString() : "Unknown date";
      const details = [];
      if (run.themes_loaded) details.push(`${run.themes_loaded} themes`);
      if (run.error && /Brickset says:\s*success/i.test(String(run.error))) {
        details.push("key valid; rerun backfill");
      } else if (isStoppedRun(run)) {
        details.push("continue with safe batch");
      } else if (run.error && String(run.error).includes('method:valuation')) {
        if (run.sets_skipped) details.push(`${run.sets_skipped} processed`);
        if (run.sets_loaded) details.push(`${run.sets_loaded} updated`);
      } else if (run.error && String(run.error).includes('method:')) {
        if (run.sets_skipped) details.push(`${run.sets_skipped} processed`);
        if (run.sets_loaded) details.push(`${run.sets_loaded} filled`);
        const nextMatch = String(run.error).match(/next_page:(\d+)/);
        if (nextMatch) details.push(`next page ${nextMatch[1]}`);
      } else if (run.sets_loaded) details.push(`${run.sets_loaded} sets`);
      if (run.figs_loaded) details.push(`${run.figs_loaded} figs`);
      if (!(run.error && String(run.error).includes('method:')) && run.sets_skipped) details.push(`${run.sets_skipped} skipped/processed`);
      if (jobState.retryable && !details.length) details.push("safe to retry");
      if (jobState.needsAttention) details.push("check diagnostics");
      if (progress.countText && !details.includes(progress.countText)) details.unshift(progress.countText);
      const updatedText = run.updated_at ? `Updated ${ago(run.updated_at)}` : "";
      const progressHTML = progress.pct != null ? `
        <div style="margin-top:6px;">
          <div style="display:flex;justify-content:space-between;gap:8px;font-size:10px;color:var(--ink-mute);margin-bottom:4px;">
            <span>${escapeHtml(progress.label)}</span>
            <span>${progress.pct}%</span>
          </div>
          <div style="height:6px;border:1px solid var(--line-soft);border-radius:var(--r-full);background:var(--surface-2);overflow:hidden;">
            <div style="height:100%;width:${progress.pct}%;background:${statusColor};transition:width .25s ease;"></div>
          </div>
        </div>
      ` : progress.active ? `
        <div style="margin-top:6px;font-size:10px;color:var(--ink-mute);">${escapeHtml(progress.label)}...</div>
      ` : "";
      const errorHTML = run.error ? `<div style="color:${statusColor};font-size:11px;margin-top:3px;overflow-wrap:anywhere;">${escapeHtml(String(run.error))}</div>` : "";

      return `
        <div style="border-bottom:1px solid var(--line-soft);padding-bottom:8px;margin-bottom:4px;">
          <div style="display:flex;justify-content:space-between;align-items:center;font-weight:600;margin-bottom:2px;">
            <span>Job #${run.id}</span>
            <span style="color:${statusColor};font-size:11px;text-align:right;max-width:58%;overflow-wrap:anywhere;">${escapeHtml(statusText)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;color:var(--ink-mute);font-size:11px;">
            <span>Started: ${dateStr}</span>
            <span>${details.join(", ") || "No items processed"}</span>
          </div>
          ${updatedText ? `<div style="font-size:10px;color:var(--ink-faint);margin-top:2px;">${escapeHtml(updatedText)}</div>` : ""}
          ${progressHTML}
          ${errorHTML}
        </div>
      `;
    }).join("");

    const latestRun = runs[0] || null;
    const latestState = latestRun ? classifyJobRun(latestRun) : null;
    if (hasRunning && location.hash === "#/me") {
      scheduleAdminJobPoll(2500);
    } else if (adminJobPollTimer) {
      clearTimeout(adminJobPollTimer);
      adminJobPollTimer = null;
    }
    if (!hasRunning && populateEverythingAuto && latestRun?.job_type === "populate_everything") {
      if (isPopulateEverythingComplete(latestRun)) {
        populateEverythingAuto = false;
        toast("All configured data sources are populated", "success");
      } else if (latestState?.needsAttention) {
        populateEverythingAuto = false;
        toast("Populate everything stopped for a hard provider error", "error");
      } else {
        schedulePopulateEverythingContinue();
      }
    }
  } catch (err) {
    setAdminJobButtons(null);
    container.innerHTML = `<div style="color:var(--bv-red);">Failed to load jobs: ${escapeHtml(err.message)}</div>`;
  }
}

async function updateIntegrationsHealth() {
  const container = document.getElementById("integrationsHealthContainer");
  if (!container) return;
  const ago = (ts) => {
    if (!ts) return "never";
    const then = new Date(String(ts).replace(" ", "T") + "Z").getTime();
    const mins = Math.round((Date.now() - then) / 60000);
    if (!Number.isFinite(mins)) return "unknown";
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  };
  const statusColor = (status) => status === "ok" ? "var(--up)"
    : status === "degraded" ? "var(--bv-yellow)"
    : status === "down" ? "var(--bv-red)"
    : status === "unconfigured" ? "var(--ink-mute)"
    : "var(--ink-mute)";
  const isLatestFailure = (r) => {
    const okAt = r.last_ok_at ? new Date(String(r.last_ok_at).replace(" ", "T") + "Z").getTime() : 0;
    const failAt = r.last_fail_at ? new Date(String(r.last_fail_at).replace(" ", "T") + "Z").getTime() : 0;
    return failAt && failAt >= okAt;
  };
  const statusLabel = (r, standbyFallback = false) => {
    if (standbyFallback) return "Standby fallback";
    const latestFail = isLatestFailure(r);
    if (latestFail && r.service === "ebay" && /OAuth|invalid[_ -]?client/i.test(r.last_error || "")) return "Check keys";
    if (latestFail && r.service === "ebay" && /Marketplace Insights|HTTP 401|HTTP 403|access denied|insufficient permissions|invalid[_ -]?scope|not authorized/i.test(r.last_error || "")) return "Sold comps blocked";
    if (latestFail && /HTTP 401|HTTP 403|access denied|insufficient permissions|invalid[_ -]?scope|not authorized/i.test(r.last_error || "")) return "Needs access";
    if (latestFail && /Too many subrequests|operation was aborted|AbortError|timed out|timeout/i.test(r.last_error || "")) return "Batch limited";
    if (r.status === "unknown") return r.configured ? "Ready / no calls" : "Unconfigured";
    return String(r.status || "unknown").replace("_", " ");
  };
  try {
    const data = await api("/api/admin/integrations");
    const rows = data.integrations || [];
    const bricksetRow = rows.find(r => r.service === "brickset");
    const bricksetCoversBarcodes = !!bricksetRow?.configured && bricksetRow.status !== "down";
    const isBrickOwlStandby = (r) => r.service === "brickowl"
      && bricksetCoversBarcodes
      && /HTTP 401|HTTP 403|access denied|not authorized/i.test(r.last_error || "");
    const coverage = data.coverage || {};
    const quality = coverage.quality || {};
    const routing = data.api_routing || {};
    const totalSets = Number(coverage.total_sets || 0);
    const formatCoverage = (count, pct) => {
      const n = Number(count || 0);
      if (!totalSets) return "No catalog";
      if (!n) return `No rows yet (0/${totalSets.toLocaleString()})`;
      const displayPct = Number(pct || 0);
      const pctLabel = displayPct > 0 ? `${displayPct}%` : "<0.1%";
      return `${pctLabel} (${n.toLocaleString()}/${totalSets.toLocaleString()})`;
    };
    const bricklinkCount = coverage.sets_with_bricklink ?? coverage.sets_with_bricklink_new ?? 0;
    const coverageRows = [
      ["Catalog sets", Number(coverage.total_sets || 0).toLocaleString()],
      ["Stale values", Number(coverage.stale_values || 0).toLocaleString()],
      ["Expired values", Number(coverage.expired_values || 0).toLocaleString()],
      ["Missing values", Number(coverage.missing_values || 0).toLocaleString()],
      ["Missing MSRP", Number(quality.missing_msrp || 0).toLocaleString()],
      ["Missing UPC", Number(quality.missing_upc || 0).toLocaleString()],
      ["Old active sets", Number(quality.old_active_sets || 0).toLocaleString()],
      ["Low-confidence values", Number(quality.low_confidence_values || 0).toLocaleString()],
      ["Barcode coverage", formatCoverage(coverage.sets_with_upc, coverage.barcode_coverage_pct)],
      ["BrickLink coverage", formatCoverage(bricklinkCount, coverage.bricklink_coverage_pct)],
      ["eBay new sold", formatCoverage(coverage.sets_with_ebay_new, coverage.ebay_new_coverage_pct)],
      ["eBay used sold", formatCoverage(coverage.sets_with_ebay_used, coverage.ebay_used_coverage_pct)],
    ];
    const coverageNote = "Coverage tracks populated catalog fields. BrickLink and eBay are split into new and used market data; daily safe batches advance barcode and price coverage automatically.";
    const routingHTML = `
      <div style="border:1.5px solid var(--line-soft);border-radius:var(--r-2);padding:10px 12px;background:var(--surface-2);margin-bottom:10px;">
        <div style="font-family:var(--mono);font-size:10px;text-transform:uppercase;color:var(--ink-mute);margin-bottom:6px;">API routing</div>
        <div style="font-size:11px;color:var(--ink-soft);line-height:1.45;word-break:break-all;">
          Worker: ${escapeHtml(routing.worker_base_url || window.WORKER_BASE || "unknown")}<br>
          Config: ${escapeHtml(routing.config_endpoint || "")}
        </div>
      </div>`;
    const coverageHTML = `
      <div style="border:1.5px solid var(--line-soft);border-radius:var(--r-2);padding:10px 12px;background:var(--surface-2);margin-bottom:10px;">
        <div style="font-family:var(--mono);font-size:10px;text-transform:uppercase;color:var(--ink-mute);margin-bottom:6px;">Data coverage</div>
        <div style="display:grid;grid-template-columns:1fr;gap:7px;">
          ${coverageRows.map(([label, value]) => `
            <div style="display:flex;justify-content:space-between;gap:8px;">
              <span style="color:var(--ink-mute);">${escapeHtml(label)}</span>
              <strong style="color:var(--ink);text-align:right;">${escapeHtml(value)}</strong>
            </div>
          `).join("")}
        </div>
        <div style="font-size:10px;color:var(--ink-mute);line-height:1.4;margin-top:8px;">${escapeHtml(coverageNote)}</div>
      </div>`;
    const integrationsHTML = rows.map(r => {
      const standbyFallback = isBrickOwlStandby(r);
      const color = standbyFallback ? statusColor("unknown") : statusColor(r.status);
      const hasAttempts = Number(r.ok_count || 0) + Number(r.fail_count || 0) > 0;
      const latestFail = isLatestFailure(r);
      const isEbayAccessBlocked = latestFail && r.service === "ebay"
        && /Marketplace Insights|HTTP 401|HTTP 403|access denied|insufficient permissions|invalid[_ -]?scope|not authorized|OAuth|invalid[_ -]?client/i.test(r.last_error || "");
      const timingText = standbyFallback ? "Brickset barcode backfill active" : hasAttempts
        ? latestFail ? `OK ${ago(r.last_ok_at)} / Fail ${ago(r.last_fail_at)}` : `Last OK ${ago(r.last_ok_at)}`
        : "No recent calls logged";
      const countText = standbyFallback ? "Not used" : hasAttempts
        ? isEbayAccessBlocked
          ? `${r.fail_count || 0} blocked call${Number(r.fail_count || 0) === 1 ? "" : "s"}`
          : latestFail ? `${r.ok_count || 0} ok / ${r.fail_count || 0} fail` : `${r.ok_count || 0} ok / ${r.fail_count || 0} past fail`
        : "Ready when used";
      const usedByText = standbyFallback
        ? "optional barcode fallback; not used while Brickset is available"
        : ((r.used_by || []).join(", ") || r.notes || "");
      const actionText = standbyFallback ? "" : (r.recommended_action || "");
      const missingSecrets = Array.isArray(r.missing_secrets) && r.missing_secrets.length
        ? `Missing secrets: ${r.missing_secrets.join(", ")}`
        : "";
      return `
        <div style="border-bottom:1px solid var(--line-soft);padding-bottom:8px;margin-bottom:4px;">
          <div style="display:flex;justify-content:space-between;align-items:center;font-weight:600;margin-bottom:2px;gap:10px;">
            <span style="min-width:0;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px;"></span>${escapeHtml(r.label || r.service)}</span>
            <span style="color:${color};font-size:11px;text-transform:uppercase;text-align:right;">${escapeHtml(statusLabel(r, standbyFallback))}</span>
          </div>
          <div style="display:flex;justify-content:space-between;color:var(--ink-mute);font-size:11px;gap:10px;">
            <span>${escapeHtml(timingText)}</span>
            <span>${escapeHtml(countText)}</span>
          </div>
          <div style="font-size:11px;color:var(--ink-mute);margin-top:2px;">${escapeHtml(usedByText)}</div>
          ${missingSecrets ? `<div style="font-size:11px;color:var(--bv-red);margin-top:2px;">${escapeHtml(missingSecrets)}</div>` : ""}
          ${actionText ? `<div style="font-size:11px;color:var(--ink-soft);margin-top:2px;">Action: ${escapeHtml(actionText)}</div>` : ""}
          ${!standbyFallback && latestFail && r.last_error && (r.status === "down" || r.status === "degraded") ? `<div style="color:${color};font-size:11px;margin-top:2px;">${escapeHtml(r.last_error)}</div>` : ""}
        </div>
      `;
    }).join("");
    container.innerHTML = routingHTML + coverageHTML + (integrationsHTML || `<div style="color:var(--ink-mute);">No integration diagnostics available.</div>`);
  } catch (err) {
    container.innerHTML = `<div style="color:var(--bv-red);">Failed to load integrations: ${escapeHtml(err.message)}</div>`;
  }
}

// Helpers for Theme Configuration
function getThemePref() {
  try { return localStorage.getItem("bv_theme") || "auto"; } catch { return "auto"; }
}
const resolveTheme = pref => {
  if (pref === "light" || pref === "dark") return pref;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};
function applyTheme(pref) {
  const resolved = resolveTheme(pref);
  document.documentElement.dataset.theme = resolved;
  const color = resolved === "dark" ? "#16161C" : "#F5F1E8";
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute("content", color));
}
function setThemePref(pref) {
  try { localStorage.setItem("bv_theme", pref); } catch {}
  applyTheme(pref);
}
