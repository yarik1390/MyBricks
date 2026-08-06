import { $, $$, haptic, escapeHtml, fmtMoneyShort, toast, fmtPct, setHue, bvIDB, celebrate, celebrateChime, soundEnabled, advisorEnabled, publicOrigin } from '../utils.js';
import { state, invalidatePortfolio } from '../state.js';
import { api, sbSignOut, isGuestMode } from '../api.js';
import { I } from '../icons.js';
import { promptSheet, showSheet, hideSheet } from '../components/sheet.js';
import { go } from '../router.js';
import { getThemePref, setThemePref, getSkinPref, setSkinPref, getModePref, setModePref } from '../theme.js';
import { t, tPlural, SUPPORTED, savedLocale, getLocale, setLocale, clearLocale } from '../lib/i18n.js';

// The picker shows each language in its OWN language — "German" is no help to
// someone who only reads German.
const nativeName = (code) => (SUPPORTED.find((l) => l.code === code) || SUPPORTED[0]).native;
import { skelPage, skelStatGrid, skelSettingRows } from '../components/skeleton.js';
import { startOnboarding } from '../components/onboarding.js';
import { isNativeBilling, presentProPaywall, restorePurchases, presentCustomerCenter } from '../lib/revenuecat-native.js';
import { getCapacitorPlugin } from '../lib/native-auth.js';

export async function renderMe() {
  // Legacy Stripe return: detect a Checkout success redirect (?supported=1) before
  // touching state. Stripe is parked behind Patreon, but this path stays so a
  // re-enabled Stripe checkout still refreshes the supporter flag correctly.
  const stripeSuccess = location.hash.includes('supported=1');
  if (stripeSuccess) {
    state.me = null; // force fresh fetch to pick up is_supporter flag
    history.replaceState(null, '', '#/me');
  }

  let me = state.me;
  let publicProfile = null;

  // Older Worker deployments redirect the Google OAuth return to #/me —
  // forward to the Integrations sub-page where the section now lives.
  if (location.hash.includes("google_sync=")) {
    go("#/me/integrations" + location.hash.slice(location.hash.indexOf("?")));
    return;
  }

  if (!me) $("#root").innerHTML = skelPage(skelStatGrid(4) + skelSettingRows(4));
  try {
    me = me || await api("/api/me");
    state.me = me;
    if (me.handle) {
      publicProfile = await fetch((window.WORKER_BASE || '') + "/api/users/" + encodeURIComponent(me.handle) + "/profile")
        .then(r => r.ok ? r.json() : null)
        .catch(() => null);
    }
  } catch (_e) {
    toast("Couldn't load profile", "error");
    me = me || { display_name: "Collector", handle: "you", notify_price_drops: true, portfolio_stats: {} };
  }
  const c = me.portfolio_stats || {};
  const gain = (c.total_value || 0) - (c.total_paid || 0);
  const gainPct = c.total_paid ? gain / c.total_paid : 0;
  const guest = isGuestMode();

  const showcase = publicProfile?.showcase || [];
  let trophyShelfHTML = '';
  if (!guest && me.handle && me.is_public) {
    trophyShelfHTML = `
      <h2 class="section-title">${tPlural('me.trophyShelf', showcase.length)}</h2>
      <div class="card" style="padding:14px 16px;margin-bottom:14px;">
        <div class="trophy-shelf scrollable" style="display:flex;gap:12px;overflow-x:auto;padding-bottom:8px;margin-bottom:12px;">
          ${showcase.map(s => {
            const hasImg = s.image_url && !s.image_url.startsWith("data:");
            const h = setHue(s);
            return `
              <div class="trophy-card" style="width:104px;flex-shrink:0;position:relative;">
                <button class="remove-trophy-btn" data-set="${escapeHtml(s.set_num)}" aria-label="Remove from shelf" style="position:absolute;top:-4px;right:-4px;background:var(--bv-red);color:#fff;border:none;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:10;font-size:15px;line-height:1;font-weight:bold;">×</button>
                <div class="set-card-img${hasImg ? " has-photo" : ""}" style="height:70px;border-radius:var(--r-2);position:relative;">
                  <div class="brick-tile" style="--h:${h};width:64%;height:64%;"></div>
                  ${hasImg ? `<img class="set-photo" src="${escapeHtml(s.image_url)}" alt="" loading="lazy">` : ""}
                </div>
                <div class="u-fs-xs u-ellipsis" style="font-weight:500;margin-top:4px;">${escapeHtml(s.name)}</div>
              </div>
            `;
          }).join("")}
          ${showcase.length < 6 ? `
            <button id="addTrophyBtn" style="width:104px;height:95px;flex-shrink:0;border:2.5px dashed var(--border-c);border-radius:var(--r-2);background:var(--surface-2);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;cursor:pointer;color:var(--ink-soft);outline:none;">
              <span style="font-size:20px;">+</span>
              <span class="u-fs-xs" style="font-weight:600;">Add to shelf</span>
            </button>
          ` : ''}
        </div>
        ${showcase.length === 0 ? `<div class="empty-inline"><strong>Your Trophy Shelf is empty.</strong><span>Pick up to six favorite sets from your vault to make your public profile feel alive.</span></div>` : ''}
      </div>
    `;
  }

  const linkRow = (href, label, desc) => `
    <a class="setting-row" href="${href}" style="cursor:pointer;">
      <div class="lbl-wrap"><div class="lbl">${label}</div><div class="desc">${desc}</div></div>
      ${I.chev()}
    </a>`;

  $("#root").innerHTML = `
    <div class="page">
      <div class="topbar">
        <div class="topbar-heading">
          <div class="topbar-eyebrow">${guest ? "Local guest" : "@" + escapeHtml(me.handle || "you")}</div>
          <h1 class="topbar-title">Profile</h1>
        </div>
      </div>

      <div class="profile-head">
        <div class="avatar">${(me.display_name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}</div>
        <div class="u-flex1">
          <div class="profile-name">${escapeHtml(me.display_name || "Collector")}</div>
          <div class="profile-handle">${guest ? "Guest mode - saved on this device" : "Member - BricksVault"}</div>
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
          <div class="delta ${gain >= 0 ? "up" : "down"}" style="margin-top:6px;"><span class="arrow" aria-hidden="true">${gain >= 0 ? "▲" : "▼"}</span>${fmtPct(Math.abs(gainPct))}</div>
        </div>
      </div>

      ${state.pwa.deferredPrompt ? `
        <button class="install-card" id="installBtn">
          <div class="install-icon">${I.download()}</div>
          <div class="install-text">
            <div class="install-t1">Install BricksVault</div>
            <div class="install-t2">Add to your home screen for a full-screen, app-like experience.</div>
          </div>
          ${I.arrowR()}
        </button>` : ""}

      <div class="profile-layout">
        <section class="profile-main">
          ${guest ? guestModeCardHTML() : ""}
          ${publicProfileSectionHTML(me)}
          ${trophyShelfHTML}
          ${!guest ? supportCardHTML(me, state.config?.patreon_url) : ''}
        </section>
        <aside class="profile-side">

      <h2 class="section-title">Preferences</h2>
      <div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Appearance</div><div class="desc">Match your device or pick a side.</div></div>
          <div class="theme-seg" id="themeSeg" role="group" aria-label="Theme">
            ${[["light","Light"],["auto","Auto"],["dark","Dark"]].map(([v,l]) =>
              `<button data-theme-val="${v}" class="${getThemePref() === v ? "active" : ""}" aria-pressed="${getThemePref() === v}">${l}</button>`).join("")}
          </div>
        </div>
        <div class="setting-row skin-seg-row">
          <div class="lbl-wrap"><div class="lbl">Style</div><div class="desc">Pick a visual skin — free or supporter.</div></div>
          <div class="theme-seg" id="skinSeg" role="group" aria-label="Visual style">
            ${[
              ["retro","Retro"],
              ["modular","Modular"],
              ["vivid","Vivid"],
              ...(me.is_supporter ? [["premium","Premium"],["gold","Gold ★"]] : [["premium","Premium ★"],["gold","Gold ★"]]),
            ].map(([v,l]) =>
              `<button data-skin-val="${v}" class="${getSkinPref() === v ? "active" : ""}" aria-pressed="${getSkinPref() === v}">${l}</button>`).join("")}
          </div>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">View mode</div><div class="desc">Simple hides ROI charts &amp; forecasts — just value &amp; your sets.</div></div>
          <div class="theme-seg" id="modeSeg" role="group" aria-label="View mode">
            ${[["pro","Pro"],["simple","Simple"]].map(([v,l]) =>
              `<button data-mode-val="${v}" class="${getModePref() === v ? "active" : ""}" aria-pressed="${getModePref() === v}">${l}</button>`).join("")}
          </div>
        </div>
        ${!guest ? `<div class="setting-row" id="kidsModeRow" style="cursor:pointer;">
          <div class="lbl-wrap">
            <div class="lbl">Kids Mode</div>
            <div class="desc">${me.has_kids_pin
              ? "PIN set — tap to enter Kids Mode or change settings."
              : "Set a 4-digit PIN to enable a gamified, price-free view for kids."}</div>
          </div>
          ${I.chev()}
        </div>` : ""}
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Price-drop alerts</div><div class="desc">Alert when wishlisted sets hit your target.</div></div>
          <button class="toggle ${me.notify_price_drops ? "on" : ""}" id="notifyToggle" role="switch" aria-label="Price-drop alerts" aria-checked="${!!me.notify_price_drops}"></button>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Weekly vault digest</div><div class="desc">A Sunday summary: value change, top mover, wishlist hits.</div></div>
          <button class="toggle ${me.notify_weekly_digest ? "on" : ""}" id="digestToggle" role="switch" aria-label="Weekly vault digest" aria-checked="${!!me.notify_weekly_digest}"></button>
        </div>
        <div class="setting-row" id="appLockRow" style="display:none;">
          <div class="lbl-wrap"><div class="lbl">App lock</div><div class="desc">Require your fingerprint (or device PIN) to open BricksVault.</div></div>
          <button class="toggle" id="appLockToggle" role="switch" aria-label="App lock" aria-checked="false"></button>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Celebration sounds</div><div class="desc">Play a chime on milestones and rewards.</div></div>
          <button class="toggle ${soundEnabled() ? "on" : ""}" id="soundToggle" role="switch" aria-label="Celebration sounds" aria-checked="${soundEnabled()}"></button>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">AI assistant</div><div class="desc">Show the floating assistant button for price help.</div></div>
          <button class="toggle ${advisorEnabled() ? "on" : ""}" id="advisorToggle" role="switch" aria-label="AI assistant" aria-checked="${advisorEnabled()}"></button>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">${escapeHtml(t("settings.language"))}</div><div class="desc">${escapeHtml(t("settings.languageDesc"))}</div></div>
          <select id="languageSelect" class="setting-select" aria-label="${escapeHtml(t("settings.language"))}">
            <option value="auto" ${savedLocale() ? "" : "selected"}>${escapeHtml(t("settings.languageAuto", { name: nativeName(getLocale()) }))}</option>
            ${SUPPORTED.map(l => `<option value="${l.code}" ${savedLocale() === l.code ? "selected" : ""}>${escapeHtml(l.native)}</option>`).join("")}
          </select>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">${escapeHtml(t("settings.currency"))}</div><div class="desc">${escapeHtml(t("settings.currencyDesc"))}</div></div>
          <select id="currencySelect" style="font-family:var(--mono);font-weight:600;font-size:14px;border:none;background:transparent;color:var(--ink);cursor:pointer;outline:none;text-align-last:right;">
            ${["USD","GBP","EUR","CAD","AUD"].map(cur => `<option value="${cur}" ${me.currency === cur ? "selected" : ""}>${cur}</option>`).join("")}
          </select>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Retail market</div><div class="desc">Local market for store offers. Resale values remain in USD.</div></div>
          <select id="retailMarketSelect" class="setting-select" aria-label="Retail market">
            ${[["FR","France"],["US","United States"],["GB","United Kingdom"],["DE","Germany"],["CA","Canada"],["AU","Australia"]].map(([code, label]) => `<option value="${code}" ${me.retail_market === code ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </div>
      </div>

      <h2 class="section-title">More</h2>
      <div>
        ${linkRow("#/me/integrations", "Integrations", "Google Sheets, Discord, Brickset, push alerts, AI keys")}
        ${linkRow("#/me/data", "Data", "Export &amp; import your vault as CSV")}
        ${!guest ? linkRow("#/me/contributions", "Your contributions", "Reviews, photos &amp; data fixes you've submitted") : ""}
        ${!guest ? `
        <div class="setting-row" id="wrappedRow" style="cursor:pointer;">
          <div class="lbl-wrap"><div class="lbl">${t('share.wrappedTitle', { year: new Date().getFullYear() })}</div><div class="desc">${t('share.wrappedDescription')}</div></div>
          ${I.chev()}
        </div>` : ""}
        ${me.is_admin ? linkRow("#/me/admin", "Admin console", "Catalog imports, jobs, integration health") : ""}
        ${linkRow("#/leaderboard", "Leaderboard", "Top public collections by value")}
        ${linkRow("#/build", "What Can I Build?", "Models you can build from sets you own")}
        <div class="setting-row" id="replayTourRow" style="cursor:pointer;">
          <div class="lbl-wrap"><div class="lbl">App tour</div><div class="desc">Replay the quick guided walkthrough.</div></div>
          ${I.chev()}
        </div>
        <div class="setting-row" id="${guest ? "signInRow" : "signOutRow"}" style="cursor:pointer;">
          <div class="lbl-wrap"><div class="lbl">${guest ? "Sign in" : "Sign out"}</div><div class="desc">${guest ? "Sync your local vault across devices." : "Sync resumes when you return."}</div></div>
          ${I.chev()}
        </div>
        ${guest ? "" : `
        <div class="setting-row" id="deleteAccountRow" style="cursor:pointer;">
          <div class="lbl-wrap"><div class="lbl" style="color:var(--down);">Delete account</div><div class="desc">Permanently erase your account and all data.</div></div>
          ${I.chev()}
        </div>`}
      </div>
        </aside>
      </div>

      <div class="u-mono-label u-fs-2xs u-faint" id="appVersionLine" style="text-align:center;margin-top:24px;">
        BRICKSVAULT · STACK SOMETHING BEAUTIFUL
      </div>
      <div style="text-align:center;margin-top:16px;font-size:12px;">
        <a href="/methodology.html" style="color:var(--ink-mute);text-decoration:underline;">How We Price</a>
        <span style="color:var(--ink-faint);">·</span>
        <a href="/privacy.html" style="color:var(--ink-mute);text-decoration:underline;">Privacy Policy</a>
        <span style="color:var(--ink-mute);margin:0 8px;">·</span>
        <a href="/terms.html" style="color:var(--ink-mute);text-decoration:underline;">Terms of Service</a>
      </div>
      <div class="app-credits" style="text-align:center;margin-top:10px;font-size:11px;line-height:1.5;color:var(--ink-mute);">
        Catalog data &amp; images from <a href="https://rebrickable.com/" target="_blank" rel="noopener noreferrer" style="color:var(--ink-soft);text-decoration:underline;">Rebrickable</a>.
        Pricing from BrickLink, eBay, PriceCharting &amp; Brickset. LEGO® is a trademark of the LEGO Group, which does not sponsor or endorse this app.
      </div>
    </div>`;

  // Native installs are versioned by the store build — show the real one
  // instead of a hand-maintained string that drifts out of date.
  getCapacitorPlugin('App')?.getInfo?.().then(info => {
    const line = $("#appVersionLine");
    if (line && info?.version) line.textContent = `BRICKSVAULT · v${info.version} · STACK SOMETHING BEAUTIFUL`;
  }).catch(() => {});

  $("#replayTourRow")?.addEventListener("click", () => { haptic("light"); startOnboarding(); });
  $("#wrappedRow")?.addEventListener("click", () => { haptic("medium"); showWrappedSheet(); });

  $("#installBtn")?.addEventListener("click", async () => {
    const dp = state.pwa.deferredPrompt;
    if (!dp) return;
    haptic("medium");
    dp.prompt();
    try {
      const { outcome } = await dp.userChoice;
      if (outcome === "accepted") toast("Installing BricksVault…", "success");
    } catch {}
    state.pwa.deferredPrompt = null;
    $("#installBtn")?.remove();
  });

  ["#guestSignInBtn", "#signInRow"].forEach(sel => {
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

  $$("#skinSeg button").forEach(b => b.addEventListener("click", () => {
    const val = b.dataset.skinVal;
    if (!me.is_supporter && (val === "premium" || val === "gold")) {
      toast("Unlock Premium & Gold by supporting BricksVault ★", "info");
      return;
    }
    haptic("light");
    setSkinPref(val);
    $$("#skinSeg button").forEach(x => {
      const on = x === b;
      x.classList.toggle("active", on);
      x.setAttribute("aria-pressed", on);
    });
  }));

  $$("#modeSeg button").forEach(b => b.addEventListener("click", () => {
    const val = b.dataset.modeVal;
    haptic("light");
    setModePref(val);
    $$("#modeSeg button").forEach(x => {
      const on = x === b;
      x.classList.toggle("active", on);
      x.setAttribute("aria-pressed", on);
    });
  }));

  // Kids Mode PIN flow
  $("#kidsModeRow")?.addEventListener("click", () => {
    haptic("light");
    const hasPin = me.has_kids_pin;
    if (!hasPin) {
      // Setup new PIN — shared sheet (also used by the first-run setup wizard).
      import("../components/kids-pin.js").then(({ showKidsPinSetup }) => {
        showKidsPinSetup({ onSuccess: () => { setModePref("kids"); state.me = null; go("#/kids"); } });
      }).catch(() => toast("Couldn't open PIN setup. Try again.", "error"));
    } else {
      // Already has a PIN — show enter/change/remove options
      showSheet(`
        <h2 class="u-serif-h">Kids Mode</h2>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">
          <button class="btn-primary" id="kidsEnterBtn">Enter Kids Mode</button>
          <button class="btn-ghost" id="kidsChangePinBtn">Change PIN</button>
          <button class="btn-ghost" style="color:var(--down)" id="kidsRemovePinBtn">Remove PIN</button>
        </div>
      `);
      $("#kidsEnterBtn")?.addEventListener("click", () => {
        hideSheet();
        showSheet(`
          <h2 class="u-serif-h">Enter Kids Mode</h2>
          <p style="color:var(--ink-mute);margin-bottom:12px">Enter your 4-digit PIN.</p>
          <input id="kidsVerifyPin" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]*"
            placeholder="••••" style="font-size:28px;text-align:center;letter-spacing:8px;width:100%;margin-bottom:12px" class="input">
          <div id="kidsVerifyErr" style="color:var(--down);font-size:13px;margin-bottom:10px;display:none"></div>
          <button class="btn-primary" id="kidsVerifyBtn" style="width:100%">Enter</button>
        `);
        setTimeout(() => $("#kidsVerifyPin")?.focus(), 100);
        $("#kidsVerifyBtn")?.addEventListener("click", async () => {
          const pin = $("#kidsVerifyPin")?.value || "";
          const errEl = $("#kidsVerifyErr");
          if (!/^\d{4}$/.test(pin)) {
            if (errEl) { errEl.textContent = "Please enter a 4-digit PIN."; errEl.style.display = "block"; } return;
          }
          try {
            const r = await api("/api/me/kids-pin/verify", { method: "POST", body: { pin } });
            if (r?.ok) {
              hideSheet(); setModePref("kids"); state.me = null; go("#/kids");
            } else {
              if (errEl) { errEl.textContent = "Incorrect PIN."; errEl.style.display = "block"; }
              haptic("medium");
            }
          } catch { toast("Something went wrong.", "error"); }
        });
      });
      $("#kidsChangePinBtn")?.addEventListener("click", () => {
        hideSheet();
        showSheet(`
          <h2 class="u-serif-h">Change Kids PIN</h2>
          <input id="kidsOldPin" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]*"
            placeholder="Current PIN" style="font-size:24px;text-align:center;letter-spacing:6px;width:100%;margin-bottom:10px" class="input">
          <input id="kidsNewPin1" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]*"
            placeholder="New PIN" style="font-size:24px;text-align:center;letter-spacing:6px;width:100%;margin-bottom:10px" class="input">
          <input id="kidsNewPin2" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]*"
            placeholder="Confirm New PIN" style="font-size:24px;text-align:center;letter-spacing:6px;width:100%;margin-bottom:12px" class="input">
          <div id="kidsChangeErr" style="color:var(--down);font-size:13px;margin-bottom:10px;display:none"></div>
          <button class="btn-primary" id="kidsChangeBtn" style="width:100%">Change PIN</button>
        `);
        setTimeout(() => $("#kidsOldPin")?.focus(), 100);
        $("#kidsChangeBtn")?.addEventListener("click", async () => {
          const oldPin = $("#kidsOldPin")?.value || "";
          const p1 = $("#kidsNewPin1")?.value || "";
          const p2 = $("#kidsNewPin2")?.value || "";
          const errEl = $("#kidsChangeErr");
          if (!/^\d{4}$/.test(oldPin) || !/^\d{4}$/.test(p1)) {
            if (errEl) { errEl.textContent = "PINs must be exactly 4 digits."; errEl.style.display = "block"; } return;
          }
          if (p1 !== p2) {
            if (errEl) { errEl.textContent = "New PINs don't match."; errEl.style.display = "block"; } return;
          }
          try {
            await api("/api/me/kids-pin/set", { method: "POST", body: { pin: p1, current_pin: oldPin } });
            hideSheet(); state.me = null; toast("PIN changed!", "success");
          } catch {
            if (errEl) { errEl.textContent = "Current PIN incorrect or something went wrong."; errEl.style.display = "block"; }
          }
        });
      });
      $("#kidsRemovePinBtn")?.addEventListener("click", () => {
        hideSheet();
        showSheet(`
          <h2 class="u-serif-h">Remove Kids PIN</h2>
          <p style="color:var(--ink-mute);margin-bottom:12px">Enter your current PIN to remove Kids Mode.</p>
          <input id="kidsRemovePin" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]*"
            placeholder="••••" style="font-size:28px;text-align:center;letter-spacing:8px;width:100%;margin-bottom:12px" class="input">
          <div id="kidsRemoveErr" style="color:var(--down);font-size:13px;margin-bottom:10px;display:none"></div>
          <button class="btn-primary" style="width:100%;background:var(--down)" id="kidsRemoveBtn">Remove PIN</button>
        `);
        setTimeout(() => $("#kidsRemovePin")?.focus(), 100);
        $("#kidsRemoveBtn")?.addEventListener("click", async () => {
          const pin = $("#kidsRemovePin")?.value || "";
          const errEl = $("#kidsRemoveErr");
          try {
            await api("/api/me/kids-pin", { method: "DELETE", body: { pin } });
            hideSheet(); state.me = null; toast("Kids PIN removed.", "info");
          } catch {
            if (errEl) { errEl.textContent = "PIN incorrect or something went wrong."; errEl.style.display = "block"; }
          }
        });
      });
    }
  });

  if (stripeSuccess) toast("Thank you for supporting BricksVault!", "success");

  // Native (Google Play / Apple) billing via RevenueCat. Handlers are no-ops on web.
  $("#rcUpgradeBtn")?.addEventListener("click", async () => {
    haptic("medium");
    const r = await presentProPaywall();
    if (r.ok && r.active) {
      state.me = null;
      celebrate("Welcome to BricksVault Pro! ⭐", { quip: "Thanks for the support — you rock. 🧱", hue: 300 });
      go("#/me");
    }
    else if (!r.ok && r.reason !== "cancelled") toast("Store unavailable — try again", "error");
  });
  $("#rcRestoreBtn")?.addEventListener("click", async () => {
    haptic("light");
    const active = await restorePurchases();
    toast(active ? "Purchases restored ⭐" : "No purchases to restore", active ? "success" : "info");
    if (active) { state.me = null; go("#/me"); }
  });
  $("#rcManageBtn")?.addEventListener("click", () => { haptic("light"); presentCustomerCenter(); });

  let notifyOn = me.notify_price_drops;
  $("#notifyToggle")?.addEventListener("click", async (e) => {
    notifyOn = !notifyOn;
    e.currentTarget.classList.toggle("on", notifyOn);
    e.currentTarget.setAttribute("aria-checked", notifyOn);
    haptic("medium");
    try { await api("/api/me", { method: "PATCH", body: { notify_price_drops: notifyOn } }); state.me = null; }
    catch {}
    toast(notifyOn ? "Alerts on" : "Alerts paused", "info");
  });

  let digestOn = !!me.notify_weekly_digest;
  $("#digestToggle")?.addEventListener("click", async (e) => {
    digestOn = !digestOn;
    e.currentTarget.classList.toggle("on", digestOn);
    e.currentTarget.setAttribute("aria-checked", digestOn);
    haptic("medium");
    try { await api("/api/me", { method: "PATCH", body: { notify_weekly_digest: digestOn } }); state.me = null; }
    catch {}
    toast(digestOn ? "Weekly digest on — first one this Sunday" : "Weekly digest off", "info");
  });

  // App lock (biometric) — native only, revealed once biometrics are confirmed
  // available. Enabling/disabling both require a successful verify so only the
  // device owner can change it (and can't be locked out — device PIN fallback).
  (async () => {
    const row = $("#appLockRow");
    const toggle = $("#appLockToggle");
    if (!row || !toggle) return;
    try {
      const [{ biometricAvailable, verifyBiometricResult }, { appLockEnabled, setAppLockEnabled }] = await Promise.all([
        import("../lib/native-biometric.js"),
        import("../lib/app-lock.js"),
      ]);
      if (!(await biometricAvailable(window))) return; // not native / no biometrics → keep hidden
      row.style.display = "";
      const paint = () => {
        const on = appLockEnabled();
        toggle.classList.toggle("on", on);
        toggle.setAttribute("aria-checked", String(on));
      };
      paint();
      toggle.addEventListener("click", async () => {
        const turningOn = !appLockEnabled();
        const result = await verifyBiometricResult(turningOn ? "Enable app lock" : "Disable app lock");
        if (!result.ok) { toast(t('settings.appLockUnchanged', { error: result.message }), "error"); return; }
        setAppLockEnabled(turningOn);
        paint();
        haptic("medium");
        toast(turningOn ? "App lock on — fingerprint required to open" : "App lock off", "info");
      });
    } catch { /* biometric modules unavailable — leave the row hidden */ }
  })();

  $("#soundToggle")?.addEventListener("click", (e) => {
    // Device-local preference (no server round-trip). Turning it on previews the
    // chime so the user hears what they enabled.
    const on = localStorage.getItem("bv_sound") === "off";
    localStorage.setItem("bv_sound", on ? "on" : "off");
    e.currentTarget.classList.toggle("on", on);
    e.currentTarget.setAttribute("aria-checked", String(on));
    haptic("medium");
    if (on) celebrateChime();
    toast(on ? "Sounds on" : "Sounds off", "info");
  });

  $("#advisorToggle")?.addEventListener("click", (e) => {
    // Device-local preference. The router reads advisorEnabled() to show/hide the
    // FAB per route; hide it immediately here so the change is instant.
    const on = localStorage.getItem("bv_advisor") === "off";
    localStorage.setItem("bv_advisor", on ? "on" : "off");
    e.currentTarget.classList.toggle("on", on);
    e.currentTarget.setAttribute("aria-checked", String(on));
    haptic("medium");
    const fab = document.getElementById("advisorFab");
    if (fab && !on) fab.style.display = "none";
    toast(on ? "AI assistant on" : "AI assistant off", "info");
  });

  // "auto" clears the stored choice so the app follows the device again — the
  // reason setLocale/clearLocale are separate calls rather than one setter.
  $("#languageSelect")?.addEventListener("change", async (e) => {
    haptic("medium");
    const val = e.target.value;
    if (val === "auto") await clearLocale();
    else await setLocale(val);
    // setLocale awaits the dictionary listener; rendering only after that
    // boundary prevents an old locale from touching fresh Settings markup.
    await renderMe();
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
      toast(t('settings.currencyUpdated', { currency: val }), "success");
      await renderMe();
    } catch {}
  });

  $("#retailMarketSelect")?.addEventListener("change", async (e) => {
    const val = e.target.value;
    haptic("medium");
    try {
      await api("/api/me", { method: "PATCH", body: { retail_market: val } });
      if (state.me) state.me.retail_market = val;
      toast("Retail market updated", "success");
    } catch (error) {
      toast(error?.message || "Could not update retail market", "error");
    }
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
      toast(t('common.errorWithDetails', { error: e.message || e }), "error");
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
        toast(t('common.errorWithDetails', { error: err.message || err }), "error");
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
      toast(t('common.errorWithDetails', { error: err.message || err }), "error");
    }
  });

  let isPublicState = me.is_public;
  $("#publicToggle")?.addEventListener("click", async (e) => {
    isPublicState = !isPublicState;
    e.currentTarget.classList.toggle("on", isPublicState);
    e.currentTarget.setAttribute("aria-checked", isPublicState);
    haptic("medium");
    const toggleEl = e.currentTarget;
    try {
      await api("/api/me", { method: "PATCH", body: { is_public: isPublicState } });
      // Update in place — a full renderMe() here repainted the whole page and
      // jumped the scroll on every flip.
      if (state.me) state.me.is_public = isPublicState;
      toast(isPublicState ? "Profile public" : "Profile private", "info");
    } catch (err) {
      isPublicState = !isPublicState;
      toggleEl.classList.toggle("on", isPublicState);
      toggleEl.setAttribute("aria-checked", isPublicState);
      toast(t('common.errorWithDetails', { error: err.message || err }), "error");
    }
  });

  let epvState = me.expose_public_value;
  $("#publicValToggle")?.addEventListener("click", async (e) => {
    epvState = !epvState;
    e.currentTarget.classList.toggle("on", epvState);
    e.currentTarget.setAttribute("aria-checked", epvState);
    haptic("medium");
    const epvEl = e.currentTarget;
    try {
      await api("/api/me", { method: "PATCH", body: { expose_public_value: epvState } });
      if (state.me) state.me.expose_public_value = epvState;
      toast(epvState ? "Valuation visible publicly" : "Valuation hidden publicly", "info");
    } catch (err) {
      epvState = !epvState;
      epvEl.classList.toggle("on", epvState);
      epvEl.setAttribute("aria-checked", epvState);
      toast(t('common.errorWithDetails', { error: err.message || err }), "error");
    }
  });

  $("#copyProfileUrl")?.addEventListener("click", () => {
    const url = `${publicOrigin()}/#/u/${encodeURIComponent(me.handle)}`;
    navigator.clipboard.writeText(url).then(() => {
      toast("Link copied to clipboard", "success");
    }).catch(() => {
      toast("Failed to copy link", "error");
    });
  });

  async function clearLocalSessionState() {
    invalidatePortfolio(); state.me = null; state.catalog.items = [];
    state.blind.items = []; state.wishlist = []; state.portfolioHistory = null;
    try {
      await Promise.all([
        bvIDB.del('portfolio'),
        bvIDB.del('catalog'),
        bvIDB.del('blind')
      ]);
    } catch {}
  }

  $("#signOutRow")?.addEventListener("click", async () => {
    haptic("medium");
    await sbSignOut();
    await clearLocalSessionState();
    go("#/");
  });

  $("#deleteAccountRow")?.addEventListener("click", () => {
    haptic("medium");
    showSheet(`
      <h2 class="u-serif-h" style="color:var(--down)">Delete account</h2>
      <p style="color:var(--ink-mute);margin-bottom:10px;line-height:1.5">
        This permanently erases your vault, wishlist, showcase, uploaded photos,
        reviews, contributions, and preferences. <strong>This cannot be undone.</strong>
      </p>
      <p style="color:var(--ink-mute);margin-bottom:12px;line-height:1.5">
        Type <strong>DELETE</strong> to confirm.
      </p>
      <input id="deleteConfirmInput" type="text" autocomplete="off" autocapitalize="characters"
        placeholder="DELETE" style="font-size:18px;text-align:center;letter-spacing:2px;width:100%;margin-bottom:12px" class="input">
      <div id="deleteAccountErr" style="color:var(--down);font-size:13px;margin-bottom:10px;display:none"></div>
      <button class="btn-primary" style="width:100%;background:var(--down);opacity:.5" id="deleteAccountBtn" disabled>Delete my account</button>
    `);
    setTimeout(() => $("#deleteConfirmInput")?.focus(), 100);
    const input = $("#deleteConfirmInput");
    const btn = $("#deleteAccountBtn");
    input?.addEventListener("input", () => {
      const ok = (input.value || "").trim().toUpperCase() === "DELETE";
      if (btn) { btn.disabled = !ok; btn.style.opacity = ok ? "1" : ".5"; }
    });
    btn?.addEventListener("click", async () => {
      if ((input?.value || "").trim().toUpperCase() !== "DELETE") return;
      const errEl = $("#deleteAccountErr");
      if (btn) { btn.disabled = true; btn.textContent = "Deleting…"; }
      try {
        await api("/api/me", { method: "DELETE", body: { confirm: "DELETE" } });
        await sbSignOut();
        await clearLocalSessionState();
        hideSheet();
        toast("Your account has been deleted.", "info");
        go("#/");
      } catch {
        if (errEl) { errEl.textContent = "Couldn't delete your account. Please try again."; errEl.style.display = "block"; }
        if (btn) { btn.disabled = false; btn.textContent = "Delete my account"; }
      }
    });
  });
}

function supportCardHTML(me, patreonUrl) {
  const perksHTML = `
    <ul class="support-perks">
      <li>Investor insights: sell/buy signals, top movers, retirement radar</li>
      <li>Full 1-year portfolio history (free: 90 days)</li>
      <li>Market value &amp; ROI columns in CSV export</li>
      <li>5× photo-scan and revaluation limits</li>
      <li>Gold ★ skin + ⭐ badge on your public profile</li>
    </ul>`;
  const native = isNativeBilling();
  if (me.is_supporter) {
    // Premium members get BricksVault Pro. On native, offer the RevenueCat
    // Customer Center to manage/cancel.
    return `
      <h2 class="section-title">BricksVault Pro</h2>
      <div class="card support-card support-card-active">
        <div class="supporter-badge-lg">⭐ BricksVault Pro</div>
        <p class="support-desc">Thank you for going Pro. Your support keeps BricksVault alive — enjoy your perks.</p>
        ${perksHTML}
        ${native ? `<button class="btn-secondary" id="rcManageBtn" style="margin-top:12px;">Manage subscription</button>` : ''}
      </div>`;
  }
  // Native (Google Play / Apple) build → Play Billing paywall. Web → Patreon.
  if (native) {
    return `
      <h2 class="section-title">BricksVault Pro</h2>
      <div class="card support-card">
        <p class="support-desc">Unlock BricksVault Pro:</p>
        ${perksHTML}
        <button class="btn-primary" id="rcUpgradeBtn" style="margin-top:4px;">Upgrade to Pro</button>
        <button class="btn-ghost" id="rcRestoreBtn" style="width:100%;margin-top:8px;font-size:13px;color:var(--ink-mute);">Restore purchases</button>
      </div>`;
  }
  if (!patreonUrl) return '';
  return `
    <h2 class="section-title">Support BricksVault</h2>
    <div class="card support-card">
      <p class="support-desc">Back BricksVault on Patreon to unlock supporter perks:</p>
      ${perksHTML}
      <a href="${patreonUrl}" target="_blank" rel="noopener" class="btn-primary patreon-btn">
        Support on Patreon →
      </a>
      <p class="u-mute" style="font-size:11px;margin-top:10px;text-align:center;">
        After pledging, your badge is granted within 24 hours.
      </p>
    </div>`;
}

function guestModeCardHTML() {
  return `
    <div class="card" style="padding:14px 16px;margin-bottom:14px;">
      <div style="font-weight:600;font-size:14px;margin-bottom:6px;">Local guest vault</div>
      <div class="u-fs-base u-mute" style="line-height:1.45;margin-bottom:12px;">
        Your sets are saved on this device. Sign in before switching devices to sync your vault, publish a profile, unlock Trophy Shelf, and connect Google Sheets.
      </div>
      <button class="btn-primary u-wfull" id="guestSignInBtn">${I.user()}<span>Sign in to sync</span></button>
    </div>
  `;
}

function publicProfileSectionHTML(me) {
  if (me.is_guest) {
    return `
      <h2 class="section-title">Public Profile</h2>
      <div class="card" style="padding:14px 16px;margin-bottom:14px;">
        <div class="u-fs-base u-mute" style="line-height:1.45;">
          Public profiles and Trophy Shelf sync require an account — use <b>Sign in to sync</b> above.
        </div>
      </div>
    `;
  }
  if (!me.handle) {
    return `
      <h2 class="section-title">Public Profile</h2>
      <div class="card" style="padding:14px 16px;margin-bottom:14px;">
        <div class="u-fs-base u-mute" style="margin-bottom:12px;line-height:1.45;">
          Choose a unique username/handle to create a public profile page showing off your stats and Trophy Shelf.
        </div>
        <div class="u-row" style="flex-wrap:wrap;">
          <input type="text" id="chooseHandleInp" placeholder="your-name" style="flex:1 1 180px;min-width:0;padding:10px;border:var(--bw-thin) solid var(--border-c);border-radius:var(--r-2);background:var(--surface-2);color:var(--ink);font-size:14px;outline:none;font-family:var(--sans);">
          <button class="btn-primary" id="saveHandleBtn" style="width:auto;max-width:100%;white-space:nowrap;padding:10px 16px;">Set Handle</button>
        </div>
      </div>
    `;
  }
  const url = `${publicOrigin()}/#/u/${encodeURIComponent(me.handle)}`;
  return `
    <div class="section-title">Public Profile</div>
    <div class="card" style="padding:14px 16px;margin-bottom:14px;">
      <div class="u-between" style="margin-bottom:10px;">
        <span class="u-fs-base" style="font-weight:600;">Public Portfolio</span>
        <button class="toggle ${me.is_public ? "on" : ""}" id="publicToggle" role="switch" aria-label="Public profile" aria-checked="${!!me.is_public}"></button>
      </div>
      <div class="u-fs-sm u-mute" style="margin-bottom:12px;line-height:1.45;">
        When turned on, anyone with the link can view your vault and showcase shelf.
      </div>
      <div class="u-between" style="margin-bottom:10px;margin-top:14px;border-top:1px solid var(--border-soft-c);padding-top:10px;">
        <span class="u-fs-base" style="font-weight:600;">Show total valuation</span>
        <button class="toggle ${me.expose_public_value ? "on" : ""}" id="publicValToggle" role="switch" aria-label="Public valuation" aria-checked="${!!me.expose_public_value}"></button>
      </div>
      <div class="u-fs-sm u-mute" style="margin-bottom:12px;line-height:1.45;">
        Expose the total value and thematic breakdown of your vault on your public profile.
      </div>
      <div class="u-between u-fs-sm public-profile-linkbox">
        <a href="${url}" class="u-ellipsis public-profile-link">${url}</a>
        <button class="btn-secondary" id="copyProfileUrl" style="padding:6px 14px;font-size:12px;width:auto;margin:0;min-height:44px;">Copy</button>
      </div>
    </div>
  `;
}

function showSearchableTrophyPicker(currentSetNums) {
  const me = state.me;
  if (!me?.handle) return;
  const ownedItems = state.portfolio?.items || [];

  showSheet(`
    <h2 class="u-serif-h" style="margin:0 4px 12px;">Add to Trophy Shelf</h2>
    <div class="search-wrap" style="margin: 0 4px 14px;">
      <span class="s-icon">${I.search()}</span>
      <input class="search-input" id="trophySearchInput" placeholder="Search your vault…" autocomplete="off">
    </div>
    <div id="trophyPickerResults" class="scrollable u-col" style="max-height: 300px; overflow-y: auto; margin: 4px;"></div>
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
      resultsDiv.innerHTML = `<div class="u-mute u-fs-base" style="text-align:center;padding:24px;">No sets found</div>`;
      return;
    }

    resultsDiv.innerHTML = filtered.map(item => `
      <div class="u-between" style="padding:8px 10px;background:var(--surface-2);border-radius:var(--r-2);">
        <div class="u-flex1" style="margin-right:12px;">
          <div class="u-fs-base u-ellipsis" style="font-weight:600;">${escapeHtml(item.name)}</div>
          <div class="u-fs-xs u-mute">${escapeHtml(item.set_num)} · ${escapeHtml(item.theme || '')}</div>
        </div>
        <button class="btn-primary add-trophy-item-btn" data-set="${escapeHtml(item.set_num)}" style="padding:6px 12px;font-size:12px;width:auto;">Add</button>
      </div>
    `).join("");

    resultsDiv.querySelectorAll(".add-trophy-item-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        haptic("light");
        const setNum = btn.dataset.set;
        const newShowcase = [...currentSetNums, setNum];
        const wasEmpty = currentSetNums.length === 0;
        const nowFull = newShowcase.length === 6;
        try {
          btn.disabled = true;
          btn.textContent = "...";
          await api("/api/users/" + encodeURIComponent(me.handle) + "/showcase", {
            method: "POST",
            body: { set_nums: newShowcase }
          });
          hideSheet();
          // First trophy unlocks the shelf, the sixth fills it — both are moments.
          if (wasEmpty) celebrate("Trophy Shelf unlocked! 🏆", { quip: "Your profile just got a display case.", hue: 50 });
          else if (nowFull) celebrate("Trophy Shelf complete! 🏆", { quip: "All six slots filled — flex earned.", hue: 50 });
          else toast("Added to trophy shelf", "success");
          await renderMe();
        } catch (err) {
          toast(t('common.errorWithDetails', { error: err.message || err }), "error");
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

// --- Brick Wrapped ----------------------------------------------------------
// The collector's year in numbers, rendered as story stats + a shareable card.
async function showWrappedSheet() {
  showSheet(`
    <div style="font-family:var(--serif);font-size:22px;font-weight:500;margin:0 4px 12px;">${t('share.wrappedHeading')}</div>
    <div id="wrappedContent" style="text-align:center;padding:30px 0;color:var(--ink-mute);">
      <div class="spinner" style="margin:0 auto 10px;"></div>${t('share.wrappedLoading')}
    </div>`);
  let w;
  try { w = await api("/api/me/wrapped"); }
  catch (e) {
    const el = $("#wrappedContent");
    if (el) el.innerHTML = `<p style="color:var(--down);font-size:13px;">${t('me.wrappedLoadFailed', { error: escapeHtml(e.message) })}</p>`;
    return;
  }
  const el = $("#wrappedContent");
  if (!el) return;
  const gain = (w.value_end != null && w.value_start != null) ? w.value_end - w.value_start : null;
  const stat = (num, lbl) => `
    <div style="background:var(--surface-2);border:1.5px solid var(--line-soft);border-radius:var(--r-2);padding:12px 8px;">
      <div style="font-family:var(--serif);font-size:22px;font-weight:600;">${num}</div>
      <div style="font-size:10px;font-family:var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--ink-mute);margin-top:2px;">${lbl}</div>
    </div>`;
  el.style.textAlign = "";
  el.style.padding = "";
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center;">
      ${stat(w.sets_added, tPlural('share.wrappedSetsAdded', w.sets_added))}
      ${stat(w.pieces_added >= 1000 ? (w.pieces_added / 1000).toFixed(1) + "k" : w.pieces_added, tPlural('share.wrappedPiecesAdded', w.pieces_added))}
      ${stat(w.minifig_count, tPlural('share.wrappedMinifigs', w.minifig_count))}
      ${stat(fmtMoneyShort(w.invested), t('share.wrappedInvested'))}
      ${gain != null ? stat(`${gain >= 0 ? "+" : ""}${fmtMoneyShort(gain)}`, t('share.wrappedValueChange')) : stat("—", t('share.wrappedValueChange'))}
      ${stat(w.sets_sold ? fmtMoneyShort(w.sale_total) : "—", w.sets_sold ? tPlural('share.wrappedSold', w.sets_sold) : t('share.wrappedSoldLabel'))}
    </div>
    ${w.best_performer ? `
      <div style="margin-top:12px;background:var(--surface-2);border:1.5px solid var(--line-soft);border-radius:var(--r-2);padding:12px 14px;font-size:13px;">
        <div class="u-mono-label" style="margin-bottom:4px;">${t('share.wrappedBestLabel')}</div>
        <strong>${escapeHtml(w.best_performer.name)}</strong>
        ${w.best_performer.roi_pct != null ? `<span style="color:var(--up);font-weight:700;"> +${w.best_performer.roi_pct}%</span>` : ""}
      </div>` : ""}
    ${w.longest_held ? `
      <div style="margin-top:8px;font-size:12px;color:var(--ink-mute);">${t('share.wrappedLongestHeld', { name: `<strong>${escapeHtml(w.longest_held.name)}</strong>`, year: escapeHtml(String(w.longest_held.purchased_at).slice(0, 4)) })}</div>` : ""}
    <div class="btn-row" style="margin-top:14px;">
      <button class="btn-secondary" id="wrappedClose">${t('share.wrappedClose')}</button>
      <button class="btn-primary" id="wrappedShare">${I.share ? I.share() : ""}<span>${t('share.wrappedShareYear')}</span></button>
    </div>`;
  $("#wrappedClose")?.addEventListener("click", hideSheet);
  $("#wrappedShare")?.addEventListener("click", async () => {
    haptic("medium");
    const img = renderWrappedCard(w, gain);
    // Prefer sharing the image card; fall back to a text summary anywhere the
    // platform can't share files.
    try {
      if (img && navigator.canShare) {
        const blob = await new Promise(res => img.toBlob(res, "image/png"));
        if (blob) {
          const file = new File([blob], `brick-wrapped-${w.year}.png`, { type: "image/png" });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: t('share.wrappedTitle', { year: w.year }) });
            return;
          }
        }
      }
    } catch (e) { if (e?.name === "AbortError") return; }
    const { shareContent } = await import("../lib/native-share.js");
    const lines = [
      t('share.wrappedSummaryTitle', { year: w.year }),
      `${tPlural('share.wrappedSetsAdded', w.sets_added)} · ${tPlural('share.wrappedPiecesAdded', w.pieces_added)}`,
      gain != null ? t('me.wrappedValueChange', { direction: t(gain >= 0 ? 'me.wrappedUp' : 'me.wrappedDown'), value: fmtMoneyShort(Math.abs(gain)) }) : null,
      w.best_performer ? t('share.wrappedBest', { name: w.best_performer.name, roi: w.best_performer.roi_pct != null ? ` (+${w.best_performer.roi_pct}%)` : '' }) : null,
      t('share.wrappedTracked'),
    ].filter(Boolean);
    shareContent({ title: t('share.wrappedTitle', { year: w.year }), text: lines.join("\n") });
  });
}

// Offscreen 1080×1080 share card. Deliberately simple: bold numbers on the
// brand cream, no external assets, so it renders instantly everywhere.
function renderWrappedCard(w, gain) {
  try {
    const c = document.createElement("canvas");
    c.width = 1080; c.height = 1080;
    const x = c.getContext("2d");
    x.fillStyle = "#F5F1E8"; x.fillRect(0, 0, 1080, 1080);
    x.fillStyle = "#26231d";
    x.font = "600 64px Georgia, serif";
    x.fillText(t('share.wrappedTitle', { year: '' }).trim(), 80, 140);
    x.fillStyle = "#b9821f";
    x.fillText(String(w.year), 80, 220);
    const rows = [
      [`${w.sets_added}`, tPlural('share.wrappedSetsAdded', w.sets_added)],
      [`${w.pieces_added}`, tPlural('share.wrappedPiecesAdded', w.pieces_added)],
      [gain != null ? `${gain >= 0 ? "+" : "−"}${fmtMoneyShort(Math.abs(gain))}` : "—", t('share.wrappedValueChange')],
      [w.best_performer ? w.best_performer.name.slice(0, 26) : "—", w.best_performer?.roi_pct != null ? t('share.wrappedBestCanvasWithRoi', { roi: `+${w.best_performer.roi_pct}%` }) : t('share.wrappedBestCanvas')],
    ];
    let y = 380;
    for (const [big, small] of rows) {
      x.fillStyle = "#26231d";
      x.font = "700 88px Georgia, serif";
      x.fillText(String(big), 80, y);
      x.fillStyle = "#6b6455";
      x.font = "500 34px -apple-system, sans-serif";
      x.fillText(String(small), 80, y + 48);
      y += 170;
    }
    x.fillStyle = "#b9821f";
    x.font = "600 36px -apple-system, sans-serif";
    x.fillText(t('share.wrappedTagline'), 80, 1020);
    return c;
  } catch { return null; }
}
