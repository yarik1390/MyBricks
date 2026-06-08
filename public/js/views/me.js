import { $, $$, haptic, escapeHtml, fmtMoneyShort, toast, fmtMoney, fmtPct, setHue, CURRENCY_SYMBOLS, bvIDB } from '../utils.js';
import { state, invalidatePortfolio } from '../state.js';
import { api, sbSignOut, _authSession, isGuestMode, guestCollectionCSVBlob } from '../api.js';
import { I } from '../icons.js';
import { confirmSheet, promptSheet, showSheet, hideSheet } from '../components/sheet.js';
import { go } from '../router.js';

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
          <button class="toggle ${me.notify_price_drops ? "on" : ""}" id="notifyToggle" aria-pressed="${me.notify_price_drops}"></button>
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
              : `<span style="color:var(--ink-mute);font-weight:600;display:inline-flex;align-items:center;gap:4px;">⚠️ Unconfigured (scraped fallback)</span>`}
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
              <code style="word-break: break-all;">DB (D1 Binding), SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_JWT_SECRET, OPENAI_API_KEY, REBRICKABLE_API_KEY, BRICKSET_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, EBAY_APP_ID, BRICKECONOMY_API_KEY</code>
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
              Google Sheets is not configured on this deployment. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable account linking.
            </div>
          ` : `
            <button class="btn-primary" id="connectGoogleBtn" style="width:100%;font-size:13px;padding:10px 14px;background:#4285F4;border-color:#4285F4;color:#fff;border-radius:var(--r-2);cursor:pointer;outline:none;display:flex;align-items:center;justify-content:center;gap:6px;">
              ${I.extLink()} <span>Connect Google Sheets</span>
            </button>
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
          <div class="lbl-wrap"><div class="lbl">Revalue prices</div><div class="desc" id="revalueAllDesc">Daily safe valuation batches; press to advance now</div></div>
          <button class="import-btn" id="revalueAllBtn" aria-label="Revalue all prices">${I.refresh({w: 16, h: 16})}</button>
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
  $("#revalueAllBtn")?.addEventListener("click", () => triggerImport("revalue"));

  // API Key hooks
  $("#saveGeminiKey")?.addEventListener("click", () => {
    haptic("medium");
    const val = $("#geminiKeyInput").value.trim();
    if (val) localStorage.setItem('bv_gemini_key', val);
    else localStorage.removeItem('bv_gemini_key');
    state.me = null;
    toast("Gemini API key saved", "success");
    renderMe();
  });

  $("#saveOpenAIKey")?.addEventListener("click", () => {
    haptic("medium");
    const val = $("#openaiKeyInput").value.trim();
    if (val) localStorage.setItem('bv_openai_key', val);
    else localStorage.removeItem('bv_openai_key');
    state.me = null;
    toast("OpenAI API key saved", "success");
    renderMe();
  });

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
        Your sets are saved on this device. Sign in to sync across devices, publish a profile, and connect Google Sheets.
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
        <button class="toggle ${me.is_public ? "on" : ""}" id="publicToggle" aria-pressed="${me.is_public}"></button>
      </div>
      <div style="font-size:12px;color:var(--ink-mute);margin-bottom:12px;line-height:1.45;">
        When turned on, anyone with the link can view your collection and showcase shelf.
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;margin-top:14px;border-top:1px solid var(--line-soft);padding-top:10px;">
        <span style="font-weight:600;font-size:13px;">Show total valuation</span>
        <button class="toggle ${me.expose_public_value ? "on" : ""}" id="publicValToggle" aria-pressed="${me.expose_public_value}"></button>
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

async function triggerImport(type) {
  const map = {
    sets: { url: "/api/admin/import-rebrickable", method: "POST", body: { dataset: "sets" }, desc: "importSetsDesc", text: "Importing sets..." },
    figs: { url: "/api/admin/import-rebrickable", method: "POST", body: { dataset: "figs" }, desc: "importFigsDesc", text: "Importing figs..." },
    upc: { url: "/api/admin/backfill-upc", method: "POST", body: {}, desc: "backfillUpcDesc", text: "Backfilling UPC..." },
    revalue: { url: "/api/admin/revalue-brickeconomy", method: "POST", body: { scope: "all", limit: 4 }, desc: "revalueAllDesc", text: "Revaluing prices..." }
  };
  const cnf = map[type];
  if (!cnf) return;
  haptic("medium");
  const descEl = document.getElementById(cnf.desc);
  const origText = descEl ? descEl.textContent : "";
  if (descEl) descEl.textContent = cnf.text;
  try {
    const r = await api(cnf.url, { method: cnf.method, body: cnf.body });
    toast(r.message || r.status || "Job started successfully", "success");
    setTimeout(updateJobsStatus, 500);
  } catch (e) {
    toast("Job failed: " + e.message, "error");
  } finally {
    if (descEl) descEl.textContent = origText;
  }
}

async function updateJobsStatus() {
  const container = document.getElementById("jobsStatusContainer");
  if (!container) return;
  try {
    const data = await api("/api/admin/import-status");
    const runs = data.runs || [];
    if (runs.length === 0) {
      container.innerHTML = `<div style="color:var(--ink-mute);">No jobs have run yet.</div>`;
      return;
    }

    const isStoppedRun = (run) => run.status === "expired" || /Timed out|Worker run stopped/i.test(String(run.error || ""));
    const hasCompleted = runs.some(run => run.status === "completed");
    const hasRunning = runs.some(run => run.status === "running");
    const hardErrors = runs.filter(run => run.status === "error" && !isStoppedRun(run));
    const summaryHTML = `
      <div style="border:1.5px solid var(--line-soft);border-radius:var(--r-2);background:var(--surface-2);padding:10px 12px;margin-bottom:10px;">
        <div style="font-weight:700;font-size:12px;color:${hardErrors.length ? "var(--bv-red)" : hasRunning ? "var(--bv-yellow)" : "var(--up)"};">
          ${hardErrors.length ? `${hardErrors.length} job needs attention` : hasRunning ? "Job running" : hasCompleted ? "Latest batches are retry-safe" : "No completed batches yet"}
        </div>
        <div style="font-size:11px;color:var(--ink-mute);line-height:1.45;margin-top:3px;">
          Stopped jobs usually mean Cloudflare ended a long background slice. The buttons now run smaller safe batches, so press again to continue.
        </div>
      </div>`;

    container.innerHTML = summaryHTML + runs.map(run => {
      let statusColor = "var(--ink-mute)";
      let statusText = (run.status || 'unknown').toUpperCase();
      if (run.status === "completed") {
        statusColor = "var(--up)";
      } else if (run.status === "running") {
        statusColor = "var(--accent)";
        statusText = "RUNNING...";
      } else if (isStoppedRun(run)) {
        statusColor = "var(--ink-mute)";
        statusText = "STOPPED";
      } else if (run.status === "error") {
        const errText = String(run.error || "Unknown error");
        statusColor = "var(--bv-red)";
        statusText = `ERROR: ${escapeHtml(errText)}`;
        if (/Brickset says:\s*success/i.test(errText)) {
          statusColor = "var(--bv-yellow)";
          statusText = "RETRY NEEDED";
        }
      }

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

      return `
        <div style="border-bottom:1px solid var(--line-soft);padding-bottom:8px;margin-bottom:4px;">
          <div style="display:flex;justify-content:space-between;align-items:center;font-weight:600;margin-bottom:2px;">
            <span>Job #${run.id}</span>
            <span style="color:${statusColor};font-size:11px;text-align:right;max-width:58%;overflow-wrap:anywhere;">${statusText}</span>
          </div>
          <div style="display:flex;justify-content:space-between;color:var(--ink-mute);font-size:11px;">
            <span>Started: ${dateStr}</span>
            <span>${details.join(", ") || "No items processed"}</span>
          </div>
        </div>
      `;
    }).join("");

    if (hasRunning && location.hash === "#/me") {
      setTimeout(updateJobsStatus, 5000);
    }
  } catch (err) {
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
  const statusLabel = (r) => {
    if (/HTTP 401|HTTP 403|access denied|insufficient permissions|invalid[_ -]?scope|not authorized/i.test(r.last_error || "")) return "Needs access";
    if (/Too many subrequests|operation was aborted|AbortError|timed out|timeout/i.test(r.last_error || "")) return "Batch limited";
    if (r.status === "unknown") return r.configured ? "Ready / no calls" : "Unconfigured";
    return String(r.status || "unknown").replace("_", " ");
  };
  try {
    const data = await api("/api/admin/integrations");
    const rows = data.integrations || [];
    const coverage = data.coverage || {};
    const routing = data.api_routing || {};
    const coverageRows = [
      ["Catalog sets", Number(coverage.total_sets || 0).toLocaleString()],
      ["Stale values", Number(coverage.stale_values || 0).toLocaleString()],
      ["Expired values", Number(coverage.expired_values || 0).toLocaleString()],
      ["Missing values", Number(coverage.missing_values || 0).toLocaleString()],
      ["Barcode coverage", `${coverage.barcode_coverage_pct || 0}%`],
      ["BrickLink coverage", `${coverage.bricklink_coverage_pct || 0}%`],
      ["eBay coverage", `${coverage.ebay_coverage_pct || 0}%`],
    ];
    const coverageNote = "Coverage tracks catalog fields that have been populated. Low or zero coverage means the safe background batches have not filled that data yet.";
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
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;">
          ${coverageRows.map(([label, value]) => `
            <div style="display:flex;justify-content:space-between;gap:8px;">
              <span style="color:var(--ink-mute);">${escapeHtml(label)}</span>
              <strong style="color:var(--ink);">${escapeHtml(value)}</strong>
            </div>
          `).join("")}
        </div>
        <div style="font-size:10px;color:var(--ink-mute);line-height:1.4;margin-top:8px;">${escapeHtml(coverageNote)}</div>
      </div>`;
    const integrationsHTML = rows.map(r => {
      const color = statusColor(r.status);
      const hasAttempts = Number(r.ok_count || 0) + Number(r.fail_count || 0) > 0;
      const timingText = hasAttempts ? `OK ${ago(r.last_ok_at)} / Fail ${ago(r.last_fail_at)}` : "No recent calls logged";
      const countText = hasAttempts ? `${r.ok_count || 0} ok / ${r.fail_count || 0} fail` : "Ready when used";
      return `
        <div style="border-bottom:1px solid var(--line-soft);padding-bottom:8px;margin-bottom:4px;">
          <div style="display:flex;justify-content:space-between;align-items:center;font-weight:600;margin-bottom:2px;gap:10px;">
            <span style="min-width:0;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px;"></span>${escapeHtml(r.label || r.service)}</span>
            <span style="color:${color};font-size:11px;text-transform:uppercase;text-align:right;">${escapeHtml(statusLabel(r))}</span>
          </div>
          <div style="display:flex;justify-content:space-between;color:var(--ink-mute);font-size:11px;gap:10px;">
            <span>${escapeHtml(timingText)}</span>
            <span>${escapeHtml(countText)}</span>
          </div>
          <div style="font-size:11px;color:var(--ink-mute);margin-top:2px;">${escapeHtml((r.used_by || []).join(", ") || r.notes || "")}</div>
          ${r.last_error && (r.status === "down" || r.status === "degraded") ? `<div style="color:${color};font-size:11px;margin-top:2px;">${escapeHtml(r.last_error)}</div>` : ""}
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
