import { $, $$, haptic, escapeHtml, fmtMoneyShort, toast, fmtPct, setHue, bvIDB } from '../utils.js';
import { state, invalidatePortfolio } from '../state.js';
import { api, sbSignOut, isGuestMode } from '../api.js';
import { I } from '../icons.js';
import { promptSheet, showSheet, hideSheet } from '../components/sheet.js';
import { go } from '../router.js';
import { getThemePref, setThemePref, getSkinPref, setSkinPref } from '../theme.js';
import { skelPage, skelStatGrid, skelSettingRows } from '../components/skeleton.js';
import { startOnboarding } from '../components/onboarding.js';

export async function renderMe() {
  // Detect Stripe Checkout success return before touching state.
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
      <h2 class="section-title">Trophy Shelf (${showcase.length}/6)</h2>
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
          <div class="delta ${gain >= 0 ? "up" : "down"}" style="margin-top:6px;"><span class="arrow" aria-hidden="true">${gain >= 0 ? "▲" : "▼"}</span>${fmtPct(Math.abs(gainPct))}</div>
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
      ${!guest ? supportCardHTML(me, state.config?.patreon_url) : ''}

      <h2 class="section-title">Preferences</h2>
      <div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Appearance</div><div class="desc">Match your device or pick a side.</div></div>
          <div class="theme-seg" id="themeSeg" role="group" aria-label="Theme">
            ${[["light","Light"],["auto","Auto"],["dark","Dark"]].map(([v,l]) =>
              `<button data-theme-val="${v}" class="${getThemePref() === v ? "active" : ""}" aria-pressed="${getThemePref() === v}">${l}</button>`).join("")}
          </div>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Style</div><div class="desc">Retro brick look or modern premium.</div></div>
          <div class="theme-seg" id="skinSeg" role="group" aria-label="Visual style">
            ${[["retro","Retro"],["premium","Premium"],...(me.is_supporter ? [["gold","Gold ★"]] : [])].map(([v,l]) =>
              `<button data-skin-val="${v}" class="${getSkinPref() === v ? "active" : ""}" aria-pressed="${getSkinPref() === v}">${l}</button>`).join("")}
          </div>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Price-drop alerts</div><div class="desc">Alert when wishlisted sets hit your target.</div></div>
          <button class="toggle ${me.notify_price_drops ? "on" : ""}" id="notifyToggle" role="switch" aria-label="Price-drop alerts" aria-checked="${!!me.notify_price_drops}"></button>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Currency</div><div class="desc">Display values in your local currency.</div></div>
          <select id="currencySelect" style="font-family:var(--mono);font-weight:600;font-size:14px;border:none;background:transparent;color:var(--ink);cursor:pointer;outline:none;text-align-last:right;">
            ${["USD","GBP","EUR","CAD","AUD"].map(cur => `<option value="${cur}" ${me.currency === cur ? "selected" : ""}>${cur}</option>`).join("")}
          </select>
        </div>
      </div>

      <h2 class="section-title">More</h2>
      <div>
        ${linkRow("#/me/integrations", "Integrations", "Google Sheets, Discord, Brickset, push alerts, AI keys")}
        ${linkRow("#/me/data", "Data", "Export &amp; import your collection as CSV")}
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
      </div>

      <div class="u-mono-label u-fs-2xs u-faint" style="text-align:center;margin-top:24px;">
        BRICKVAULT · v5.0 · STACK SOMETHING BEAUTIFUL
      </div>
    </div>`;

  $("#replayTourRow")?.addEventListener("click", () => { haptic("light"); startOnboarding(); });

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

  $$("#skinSeg button").forEach(b => b.addEventListener("click", () => {
    const val = b.dataset.skinVal;
    haptic("light");
    setSkinPref(val);
    $$("#skinSeg button").forEach(x => {
      const on = x === b;
      x.classList.toggle("active", on);
      x.setAttribute("aria-pressed", on);
    });
  }));

  if (stripeSuccess) toast("Thank you for supporting Brickvault!", "success");

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
    e.currentTarget.setAttribute("aria-checked", isPublicState);
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
    e.currentTarget.setAttribute("aria-checked", epvState);
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

function supportCardHTML(me, patreonUrl) {
  if (me.is_supporter) {
    return `
      <h2 class="section-title">Supporter</h2>
      <div class="card support-card support-card-active">
        <div class="supporter-badge-lg">⭐ Supporter</div>
        <p class="support-desc">Thank you for backing Brickvault. Your support keeps this project alive.</p>
      </div>`;
  }
  if (!patreonUrl) return '';
  return `
    <h2 class="section-title">Support Brickvault</h2>
    <div class="card support-card">
      <p class="support-desc">Back Brickvault on Patreon to unlock the Supporter badge, Gold skin, and higher AI limits.</p>
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
        <div class="u-fs-base u-mute" style="line-height:1.45;margin-bottom:12px;">
          Public profiles and Trophy Shelf sync require an account.
        </div>
        <button class="btn-secondary u-wfull" id="profileSignInBtn">${I.user()}<span>Sign in</span></button>
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
  const url = `${location.origin}/#/u/${encodeURIComponent(me.handle)}`;
  return `
    <div class="section-title">Public Profile</div>
    <div class="card" style="padding:14px 16px;margin-bottom:14px;">
      <div class="u-between" style="margin-bottom:10px;">
        <span class="u-fs-base" style="font-weight:600;">Public Portfolio</span>
        <button class="toggle ${me.is_public ? "on" : ""}" id="publicToggle" role="switch" aria-label="Public profile" aria-checked="${!!me.is_public}"></button>
      </div>
      <div class="u-fs-sm u-mute" style="margin-bottom:12px;line-height:1.45;">
        When turned on, anyone with the link can view your collection and showcase shelf.
      </div>
      <div class="u-between" style="margin-bottom:10px;margin-top:14px;border-top:1px solid var(--border-soft-c);padding-top:10px;">
        <span class="u-fs-base" style="font-weight:600;">Show total valuation</span>
        <button class="toggle ${me.expose_public_value ? "on" : ""}" id="publicValToggle" role="switch" aria-label="Public valuation" aria-checked="${!!me.expose_public_value}"></button>
      </div>
      <div class="u-fs-sm u-mute" style="margin-bottom:12px;line-height:1.45;">
        Expose the total value and thematic breakdown of your collection on your public profile.
      </div>
      <div class="u-between u-fs-sm" style="background:var(--surface-3);border:var(--bw-thin) solid var(--border-soft-c);border-radius:var(--r-2);padding:10px;margin-top:8px;">
        <a href="${url}" class="u-ellipsis" style="color:var(--accent);text-decoration:underline;max-width:200px;">${url}</a>
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
    <h2 class="u-serif-h" style="margin:0 4px 12px;">Add to Trophy Shelf</h2>
    <div class="search-wrap" style="margin: 0 4px 14px;">
      <span class="s-icon">${I.search()}</span>
      <input class="search-input" id="trophySearchInput" placeholder="Search your collection…" autocomplete="off">
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
