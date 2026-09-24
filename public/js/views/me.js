// Profile (#/me) — 2026 redesign. An identity card with three stat tiles,
// then grouped rows: Collection, Preferences, Data, Play, Membership, Owner,
// Account, and the legal footer. Every setting the old page carried is still
// here — the long tail lives in sheets (Appearance, Currency & region, Public
// profile) so the hub stays one scannable list.
import { $, $$, haptic, escapeHtml, fmtMoneyShort, toast, setHue, bvIDB, celebrate, celebrateChime, soundEnabled, advisorEnabled, publicOrigin } from '../utils.js';
import { state, invalidatePortfolio } from '../state.js';
import { api, sbSignOut, isGuestMode } from '../api.js';
import { I } from '../icons.js';
import { promptSheet, showSheet, hideSheet } from '../components/sheet.js';
import { go } from '../router.js';
import { getThemePref, setThemePref, getSkinPref, setSkinPref, getModePref, setModePref } from '../theme.js';
import { t, tPlural, SUPPORTED, savedLocale, getLocale, setLocale, clearLocale } from '../lib/i18n.js';
import { skelPage, skelStatGrid, skelSettingRows } from '../components/skeleton.js';
import { startOnboarding } from '../components/onboarding.js';
import { getCapacitorPlugin } from '../lib/native-auth.js';
import { clearVaultWidget } from '../lib/native-widget.js';
import { openLegalSheet } from '../components/legal-sheet.js';
import { topbar, iconBtn, icon, row, group, sheetBody, btn, toggle, seg, banner } from '../ui/kit.js';

// The picker shows each language in its OWN language — "German" is no help to
// someone who only reads German.
const nativeName = (code) => (SUPPORTED.find((l) => l.code === code) || SUPPORTED[0]).native;
const CURRENCIES = ['USD', 'GBP', 'EUR', 'CAD', 'AUD'];
const MARKETS = ['FR', 'US', 'GB', 'DE', 'CA', 'AU', 'NL'];
const onMe = () => location.hash.split('?')[0] === '#/me';

function marketName(code) {
  try { return new Intl.DisplayNames([getLocale()], { type: 'region' }).of(code) || code; } catch { return code; }
}

function notificationsOn(me) {
  const master = me.notify_price_drops !== false;
  const keys = ['notify_sell_targets', 'notify_big_moves', 'notify_retiring', 'notify_back_in_stock'];
  return (master ? 1 : 0) + keys.filter((k) => (me[k] ?? master)).length + (me.notify_weekly_digest ? 1 : 0);
}

function themeLabel() {
  return t({ light: 'bvAccount.themeLight', dark: 'bvAccount.themeDark', auto: 'bvAccount.themeAuto' }[getThemePref()] || 'bvAccount.themeAuto');
}

function identityHTML(me, guest) {
  const c = me.portfolio_stats || {};
  const sets = Number(c.set_count ?? c.count) || 0;
  const value = Number(c.total_value) || 0;
  const paid = Number(c.total_paid) || 0;
  const gain = value - paid;
  const pct = paid ? (gain / paid) * 100 : 0;
  const up = gain >= 0;
  const name = me.display_name || t('bvAccount.collector');
  const initial = (name.trim()[0] || '?').toUpperCase();
  const meta = guest
    ? t('bvAccount.guestMeta')
    : [me.handle ? `@${me.handle}` : null, t(me.is_public ? 'bvAccount.publicVault' : 'bvAccount.privateVault'), me.is_supporter ? t('bvAccount.pro') : null].filter(Boolean).join(' · ');
  // No prices paid yet → no honest gain to show.
  const pctText = paid > 0 ? `${up ? '+' : '−'}${Math.abs(pct).toFixed(1)}%` : '—';
  const moneyText = paid > 0 ? `${up ? '+' : '-'}${fmtMoneyShort(Math.abs(gain))}` : t('bvAccount.noPaid');
  return `<section class="bv-ident profile-identity-card" aria-label="${escapeHtml(t('bvAccount.overviewLabel'))}">
      <div class="bv-ident__head">
        <span class="bv-ident__avatar" aria-hidden="true">${escapeHtml(initial)}</span>
        <span class="bv-ident__text"><span class="bv-ident__name">${escapeHtml(name)}</span><span class="bv-ident__meta">${escapeHtml(meta)}</span></span>
        ${iconBtn({ icon: 'edit', label: t('bvAccount.editName'), id: 'editName', tonal: true })}
      </div>
      <div class="bv-ident__stats profile-summary" aria-label="${escapeHtml(t('bvAccount.summaryLabel'))}">
        <a class="bv-ident__stat" href="#/"><span class="bv-ident__num">${escapeHtml(String(sets))}</span><span class="bv-ident__lbl">${escapeHtml(tPlural('bvAccount.setsLabel', sets))}</span></a>
        <a class="bv-ident__stat" href="#/insights"><span class="bv-ident__num">${escapeHtml(fmtMoneyShort(value))}</span><span class="bv-ident__lbl">${escapeHtml(t('bvAccount.valueLabel'))}</span></a>
        <div class="bv-ident__stat portfolio-change ${up ? 'is-gain' : 'is-loss'}" data-testid="portfolio-change" aria-label="${escapeHtml(t(up ? 'bvAccount.gainAria' : 'bvAccount.lossAria', { money: moneyText, pct: pctText }))}">
          <span class="bv-ident__num">${paid > 0 ? `<span class="arrow" aria-hidden="true">${up ? '▲' : '▼'}</span>` : ''}${escapeHtml(pctText)}</span>
          <span class="bv-ident__lbl">${escapeHtml(t(up ? 'bvAccount.gainLabel' : 'bvAccount.lossLabel'))} · ${escapeHtml(moneyText)}</span>
        </div>
      </div>
    </section>`;
}

function footerHTML() {
  return `<footer class="bv-profile__foot">
      <p class="me-footer-links"><a href="/methodology.html">How We Price</a> · <button type="button" class="legal-sheet-link" data-legal-sheet="partners">${escapeHtml(t('bvAccount.dataSources'))}</button> · <button type="button" class="legal-sheet-link" data-legal-sheet="privacy">${escapeHtml(t('bvAccount.privacy'))}</button> · <button type="button" class="legal-sheet-link" data-legal-sheet="terms">${escapeHtml(t('bvAccount.terms'))}</button></p>
      <p class="app-credits">${escapeHtml(t('bvAccount.credits'))} ${escapeHtml(t('bvAccount.trademark'))}</p>
      <p class="bv-profile__version" id="appVersionLine">BRICKSVAULT · STACK SOMETHING BEAUTIFUL</p>
    </footer>`;
}

function pageHTML(me) {
  const guest = isGuestMode();
  const contributions = Number(me.contributions_approved) || 0;
  const collection = [
    row({ icon: 'globe', title: t('bvAccount.publicProfile'), sub: guest ? t('bvAccount.publicGuest') : !me.handle ? t('bvAccount.publicNoHandle') : me.is_public ? t('bvAccount.publicOn') : t('bvAccount.publicOff'), id: 'publicProfileRow' }),
    row({ icon: 'trophy', title: t('bvAccount.leaderboard'), href: '#/leaderboard' }),
    guest ? '' : row({ icon: 'star', title: t('share.wrappedTitle', { year: new Date().getFullYear() }), id: 'wrappedRow' }),
    guest ? '' : row({ icon: 'check', title: t('bvAccount.contributions'), sub: contributions ? tPlural('bvAccount.approvedCount', contributions, { count: contributions }) : t('bvAccount.contributionsSub'), href: '#/me/contributions' }),
    row({ icon: 'brick', title: t('bvAccount.build'), sub: t('bvAccount.buildSub'), href: '#/build' }),
  ].join('');
  const on = notificationsOn(me);
  const prefs = [
    row({ icon: 'palette', title: t('bvAccount.appearance'), trail: themeLabel(), id: 'appearanceRow' }),
    row({ icon: 'bell', title: t('bvAccount.notifications'), trail: t('bvAccount.onCount', { count: on }), href: '#/me/notifications' }),
    row({ icon: 'globe', title: t('bvAccount.currencyRegion'), trail: `${me.currency || 'USD'} · ${marketName(me.retail_market || 'FR')}`, id: 'currencyRow' }),
    row({ icon: 'lock', title: t('bvAccount.appLock'), trail: t('bvAccount.off'), id: 'appLockRow', attrs: { hidden: true } }),
  ].join('');
  const data = [
    row({ icon: 'plug', title: t('bvAccount.integrations'), sub: t('bvAccount.integrationsSub'), href: '#/me/integrations' }),
    row({ icon: 'db', title: t('bvAccount.importExport'), sub: t('bvAccount.importExportSub'), href: '#/me/data' }),
    guest ? '' : row({ icon: 'shield', title: t('bvAccount.insurance'), sub: t('bvAccount.insuranceSub'), href: '#/me/insurance' }),
  ].join('');
  const play = [
    row({ icon: 'game', title: t('bvAccount.priceIt'), sub: t('bvAccount.priceItSub'), href: '#/game' }),
    guest ? '' : row({ icon: 'kid', title: t('bvAccount.kidsMode'), sub: t(me.has_kids_pin ? 'bvAccount.kidsOn' : 'bvAccount.kidsOff'), id: 'kidsModeRow' }),
    row({ icon: 'walk', title: t('bvAccount.tour'), sub: t('bvAccount.tourSub'), id: 'replayTourRow' }),
  ].join('');
  const membership = row({ icon: 'star', title: t('bvAccount.proTitle'), sub: me.is_supporter ? t('bvAccount.proActive') : t('bvAccount.proPitch'), href: '#/pro', id: 'proRow' });
  const account = guest
    ? row({ icon: 'user', title: t('bvAccount.signIn'), sub: t('bvAccount.signInSub'), id: 'signInRow' })
    : row({ icon: 'logout', title: t('bvAccount.signOut'), sub: t('bvAccount.signOutSub'), id: 'signOutRow' })
      + row({ icon: 'user', title: t('bvAccount.deleteAccount'), sub: t('bvAccount.deleteSub'), id: 'deleteAccountRow', danger: true });
  const shareBtn = !guest && me.handle && me.is_public ? iconBtn({ icon: 'share', label: t('bvAccount.shareProfile'), id: 'shareProfileBtn' }) : '';
  return `<main class="bv-page bv-profile" id="profilePage">
      ${topbar({ title: t('bvAccount.profile'), actionsHtml: shareBtn })}
      ${identityHTML(me, guest)}
      ${guest ? `<div class="bv-profile__banner">${banner({ icon: 'cloud', kind: 'neutral', text: t('bvAccount.guestBanner'), action: t('bvAccount.signInSync'), actionId: 'guestSignInBtn' })}</div>` : ''}
      ${state.pwa.deferredPrompt ? `<div class="bv-profile__banner">${banner({ icon: 'download', text: t('bvAccount.installBody'), action: t('bvAccount.install'), actionId: 'installBtn' })}</div>` : ''}
      <div class="profile-settings-nav" aria-label="${escapeHtml(t('bvAccount.settingsLabel'))}">
        ${group(t('bvAccount.groupCollection'), collection)}
        ${group(t('bvAccount.groupPreferences'), prefs)}
        ${group(t('bvAccount.groupData'), data)}
        ${group(t('bvAccount.groupPlay'), play)}
        ${group(t('bvAccount.groupMembership'), membership)}
        ${me.is_admin ? group(t('bvAccount.groupOwner'), row({ icon: 'shield', title: t('bvAccount.admin'), sub: t('bvAccount.adminSub'), href: '#/me/admin' })) : ''}
        ${group(t('bvAccount.groupAccount'), account)}
      </div>
      ${footerHTML()}
    </main>`;
}

export async function renderMe() {
  // Legacy Stripe return: detect a Checkout success redirect (?supported=1) before
  // touching state. Stripe is parked behind Patreon, but this path stays so a
  // re-enabled Stripe checkout still refreshes the supporter flag correctly.
  const stripeSuccess = location.hash.includes('supported=1');
  if (stripeSuccess) {
    state.me = null; // force fresh fetch to pick up is_supporter flag
    history.replaceState(null, '', '#/me');
  }
  // Older Worker deployments redirect the Google OAuth return to #/me —
  // forward to the Integrations sub-page where the section now lives.
  if (location.hash.includes("google_sync=")) {
    go("#/me/integrations" + location.hash.slice(location.hash.indexOf("?")));
    return;
  }

  let me = state.me;
  let publicProfile = null;
  if (!me) $("#root").innerHTML = skelPage(skelStatGrid(3) + skelSettingRows(6));
  try {
    me = me || await api("/api/me");
    state.me = me;
    if (me.handle && !isGuestMode()) {
      publicProfile = await fetch((window.WORKER_BASE || '') + "/api/users/" + encodeURIComponent(me.handle) + "/profile")
        .then(r => r.ok ? r.json() : null)
        .catch(() => null);
    }
  } catch (_e) {
    toast(t('bvAccount.loadFailed'), "error");
    me = me || { display_name: t('bvAccount.collector'), handle: null, notify_price_drops: true, portfolio_stats: {} };
  }
  if (!onMe()) return;
  $("#root").innerHTML = pageHTML(me);
  wire(me, publicProfile);
  if (stripeSuccess) toast(t('bvAccount.thanksSupport'), "success");
}

function wire(me, publicProfile) {
  // Native installs are versioned by the store build — show the real one
  // instead of a hand-maintained string that drifts out of date.
  getCapacitorPlugin('App')?.getInfo?.().then(info => {
    const line = $("#appVersionLine");
    if (line && info?.version) line.textContent = `BRICKSVAULT · v${info.version} · STACK SOMETHING BEAUTIFUL`;
  }).catch(() => {});

  $("#replayTourRow")?.addEventListener("click", () => { haptic("light"); startOnboarding(); });
  $("#wrappedRow")?.addEventListener("click", () => { haptic("medium"); showWrappedSheet(); });
  $$("[data-legal-sheet]").forEach(link => link.addEventListener("click", () => openLegalSheet(link.dataset.legalSheet)));
  $("#publicProfileRow")?.addEventListener("click", () => {
    haptic("light");
    if (isGuestMode()) { go("#/login"); return; }
    openPublicProfileSheet(me, publicProfile);
  });
  $("#appearanceRow")?.addEventListener("click", () => { haptic("light"); openAppearanceSheet(me); });
  $("#currencyRow")?.addEventListener("click", () => { haptic("light"); openCurrencySheet(me); });
  $("#kidsModeRow")?.addEventListener("click", () => openKidsMode(me));
  $("#shareProfileBtn")?.addEventListener("click", async () => {
    haptic("light");
    const url = `${publicOrigin()}/#/u/${encodeURIComponent(me.handle)}`;
    const { shareContent } = await import("../lib/native-share.js");
    shareContent({ title: t('bvAccount.shareTitle', { name: me.display_name || me.handle }), url });
  });

  $("#installBtn")?.addEventListener("click", async () => {
    const dp = state.pwa.deferredPrompt;
    if (!dp) return;
    haptic("medium");
    dp.prompt();
    try {
      const { outcome } = await dp.userChoice;
      if (outcome === "accepted") toast(t('bvAccount.installing'), "success");
    } catch {}
    state.pwa.deferredPrompt = null;
    $("#installBtn")?.closest('.bv-profile__banner')?.remove();
  });

  ["#guestSignInBtn", "#signInRow"].forEach(sel => {
    $(sel)?.addEventListener("click", () => { haptic("medium"); go("#/login"); });
  });

  $("#editName")?.addEventListener("click", async () => {
    const res = await promptSheet({ title: t('bvAccount.editNameTitle'), label: t('bvAccount.displayName'), value: me.display_name || "" });
    if (res === null) return;
    try {
      await api("/api/me", { method: "PATCH", body: { display_name: res } });
      state.me = null;
      toast(t('bvAccount.nameUpdated'), "success");
      await renderMe();
    } catch (e) {
      toast(t('common.errorWithDetails', { error: e.message || e }), "error");
    }
  });

  wireAppLock();

  async function clearLocalSessionState() {
    invalidatePortfolio(); state.me = null; state.catalog.items = [];
    state.blind.items = []; state.wishlist = []; state.portfolioHistory = null;
    try {
      await Promise.all([bvIDB.del('portfolio'), bvIDB.del('catalog'), bvIDB.del('blind')]);
    } catch {}
  }

  $("#signOutRow")?.addEventListener("click", async () => {
    haptic("medium");
    await clearVaultWidget();
    await sbSignOut();
    await clearLocalSessionState();
    go("#/");
  });

  $("#deleteAccountRow")?.addEventListener("click", () => {
    haptic("medium");
    showSheet(sheetBody({
      title: t('bvAccount.deleteTitle'),
      inner: `<p class="bv-sheet__sub">${escapeHtml(t('bvAccount.deleteBody'))}</p>
        <p class="bv-sheet__sub">${escapeHtml(t('bvAccount.deleteType'))}</p>
        <div class="bv-field"><div class="bv-field__box"><input id="deleteConfirmInput" type="text" autocomplete="off" autocapitalize="characters" placeholder="DELETE" aria-label="${escapeHtml(t('bvAccount.deleteType'))}" class="bv-mono-input"></div></div>
        <p class="bv-field__error" id="deleteAccountErr" role="alert" hidden></p>
        <button type="button" class="bv-btn bv-btn--danger-fill bv-btn--full" id="deleteAccountBtn" disabled>${escapeHtml(t('bvAccount.deleteConfirm'))}</button>`,
    }));
    setTimeout(() => $("#deleteConfirmInput")?.focus(), 100);
    const input = $("#deleteConfirmInput");
    const btnEl = $("#deleteAccountBtn");
    input?.addEventListener("input", () => {
      const ok = (input.value || "").trim().toUpperCase() === "DELETE";
      if (btnEl) btnEl.disabled = !ok;
    });
    btnEl?.addEventListener("click", async () => {
      if ((input?.value || "").trim().toUpperCase() !== "DELETE") return;
      const errEl = $("#deleteAccountErr");
      btnEl.disabled = true;
      btnEl.textContent = t('bvAccount.deleting');
      try {
        await api("/api/me", { method: "DELETE", body: { confirm: "DELETE" } });
        await clearVaultWidget();
        await sbSignOut();
        await clearLocalSessionState();
        hideSheet();
        toast(t('bvAccount.deleted'), "info");
        go("#/");
      } catch {
        if (errEl) { errEl.textContent = t('bvAccount.deleteFailed'); errEl.hidden = false; }
        btnEl.disabled = false;
        btnEl.textContent = t('bvAccount.deleteConfirm');
      }
    });
  });
}

// App lock (biometric) — native only, revealed once biometrics are confirmed
// available. Enabling/disabling both require a successful verify so only the
// device owner can change it (and can't be locked out — device PIN fallback).
async function wireAppLock() {
  const rowEl = $("#appLockRow");
  if (!rowEl) return;
  try {
    const [{ biometricAvailable, verifyBiometricResult }, { appLockEnabled, setAppLockEnabled }] = await Promise.all([
      import("../lib/native-biometric.js"),
      import("../lib/app-lock.js"),
    ]);
    if (!(await biometricAvailable(window))) return; // not native / no biometrics → keep hidden
    rowEl.hidden = false;
    const paint = () => {
      const trail = rowEl.querySelector('.bv-row__trail');
      if (trail?.firstChild) trail.firstChild.textContent = t(appLockEnabled() ? 'bvAccount.fingerprint' : 'bvAccount.off');
    };
    paint();
    rowEl.addEventListener("click", async () => {
      const turningOn = !appLockEnabled();
      const result = await verifyBiometricResult(turningOn ? "Enable app lock" : "Disable app lock");
      if (!result.ok) { toast(t('settings.appLockUnchanged', { error: result.message }), "error"); return; }
      setAppLockEnabled(turningOn);
      paint();
      haptic("medium");
      toast(t(turningOn ? 'bvAccount.appLockOn' : 'bvAccount.appLockOff'), "info");
    });
  } catch { /* biometric modules unavailable — leave the row hidden */ }
}

// ------------------------------------------------------------- Appearance
function openAppearanceSheet(me) {
  const skins = [['retro', 'bvAccount.skinRetro'], ['modular', 'bvAccount.skinModular'], ['vivid', 'bvAccount.skinVivid'], ['premium', 'bvAccount.skinPremium'], ['gold', 'bvAccount.skinGold']];
  const locked = (v) => !me.is_supporter && (v === 'premium' || v === 'gold');
  const switchRow = (id, label, sub, on) => `<div class="bv-prefrow"><span class="bv-prefrow__text"><span class="bv-prefrow__title">${escapeHtml(label)}</span><span class="bv-prefrow__sub">${escapeHtml(sub)}</span></span>${toggle({ id, on, label })}</div>`;
  showSheet(sheetBody({
    title: t('bvAccount.appearance'),
    id: 'appearanceSheet',
    inner: `<div class="bv-prefs">
        <div class="bv-field"><span class="bv-field__label">${escapeHtml(t('bvAccount.theme'))}</span>${seg([['light', 'bvAccount.themeLight'], ['auto', 'bvAccount.themeAuto'], ['dark', 'bvAccount.themeDark']].map(([value, key]) => ({ label: t(key), value, current: getThemePref() === value })), { label: t('bvAccount.theme'), id: 'themeSeg' })}</div>
        <div class="bv-field"><span class="bv-field__label">${escapeHtml(t('bvAccount.style'))}</span>
          <div class="bv-chips bv-chips--wrap" id="skinSeg" role="group" aria-label="${escapeHtml(t('bvAccount.style'))}">${skins.map(([v, key]) => `<button type="button" class="bv-chip" data-skin-val="${v}" aria-pressed="${getSkinPref() === v}">${escapeHtml(t(key))}${locked(v) ? ' ★' : ''}</button>`).join('')}</div>
          <span class="bv-field__help">${escapeHtml(t(me.is_supporter ? 'bvAccount.styleHelpPro' : 'bvAccount.styleHelp'))}</span></div>
        <div class="bv-field"><span class="bv-field__label">${escapeHtml(t('bvAccount.viewMode'))}</span>${seg([['pro', 'bvAccount.modeFull'], ['simple', 'bvAccount.modeSimple']].map(([value, key]) => ({ label: t(key), value, current: getModePref() === value })), { label: t('bvAccount.viewMode'), id: 'modeSeg' })}
          <span class="bv-field__help">${escapeHtml(t('bvAccount.viewModeHelp'))}</span></div>
        <div class="bv-field"><label for="languageSelect">${escapeHtml(t("settings.language"))}</label>
          <div class="bv-field__box"><select id="languageSelect" aria-label="${escapeHtml(t("settings.language"))}">
            <option value="auto" ${savedLocale() ? "" : "selected"}>${escapeHtml(t("settings.languageAuto", { name: nativeName(getLocale()) }))}</option>
            ${SUPPORTED.map(l => `<option value="${l.code}" ${savedLocale() === l.code ? "selected" : ""}>${escapeHtml(l.native)}</option>`).join("")}
          </select></div><span class="bv-field__help">${escapeHtml(t("settings.languageDesc"))}</span></div>
        <div class="bv-group__box">
          ${switchRow('soundToggle', t('bvAccount.sounds'), t('bvAccount.soundsSub'), soundEnabled())}
          ${switchRow('advisorToggle', t('bvAccount.assistant'), t('bvAccount.assistantSub'), advisorEnabled())}
        </div>
      </div>`,
  }));
  const pressIn = (sel, el) => $$(`${sel} [data-value], ${sel} [data-skin-val]`).forEach(x => x.setAttribute("aria-pressed", String(x === el)));
  $$("#themeSeg [data-value]").forEach(b => b.addEventListener("click", () => {
    haptic("light");
    setThemePref(b.dataset.value);
    pressIn('#themeSeg', b);
    const trail = $('#appearanceRow .bv-row__trail');
    if (trail?.firstChild) trail.firstChild.textContent = themeLabel();
  }));
  $$("#skinSeg [data-skin-val]").forEach(b => b.addEventListener("click", () => {
    const val = b.dataset.skinVal;
    if (!me.is_supporter && (val === "premium" || val === "gold")) {
      toast(t('bvAccount.skinLocked'), "info");
      return;
    }
    haptic("light");
    setSkinPref(val);
    pressIn('#skinSeg', b);
  }));
  $$("#modeSeg [data-value]").forEach(b => b.addEventListener("click", () => {
    haptic("light");
    setModePref(b.dataset.value);
    pressIn('#modeSeg', b);
  }));
  $("#soundToggle")?.addEventListener("click", (e) => {
    // Device-local preference (no server round-trip). Turning it on previews the
    // chime so the user hears what they enabled.
    const on = localStorage.getItem("bv_sound") === "off";
    localStorage.setItem("bv_sound", on ? "on" : "off");
    e.currentTarget.setAttribute("aria-checked", String(on));
    haptic("medium");
    if (on) celebrateChime();
  });
  $("#advisorToggle")?.addEventListener("click", (e) => {
    // Device-local preference. The router reads advisorEnabled() to show/hide the
    // FAB per route; hide it immediately here so the change is instant.
    const on = localStorage.getItem("bv_advisor") === "off";
    localStorage.setItem("bv_advisor", on ? "on" : "off");
    e.currentTarget.setAttribute("aria-checked", String(on));
    haptic("medium");
    const fab = document.getElementById("advisorFab");
    if (fab && !on) fab.style.display = "none";
  });
  // "auto" clears the stored choice so the app follows the device again — the
  // reason setLocale/clearLocale are separate calls rather than one setter.
  $("#languageSelect")?.addEventListener("change", async (e) => {
    haptic("medium");
    const val = e.target.value;
    if (val === "auto") await clearLocale();
    else await setLocale(val);
    // setLocale awaits the dictionary listener; repainting only after that
    // boundary keeps an old locale from touching fresh markup.
    await renderMe();
    openAppearanceSheet(state.me || me);
  });
}

// ------------------------------------------------------- Currency & region
function openCurrencySheet(me) {
  showSheet(sheetBody({
    title: t('bvAccount.currencyRegion'),
    inner: `<div class="bv-prefs">
        <div class="bv-field"><label for="currencySelect">${escapeHtml(t('settings.currency'))}</label>
          <div class="bv-field__box"><select id="currencySelect" aria-label="${escapeHtml(t('settings.currency'))}">${CURRENCIES.map(cur => `<option value="${cur}" ${me.currency === cur ? "selected" : ""}>${cur}</option>`).join("")}</select></div>
          <span class="bv-field__help">${escapeHtml(t('settings.currencyDesc'))}</span></div>
        <div class="bv-field"><label for="retailMarketSelect">${escapeHtml(t('bvAccount.retailMarket'))}</label>
          <div class="bv-field__box"><select id="retailMarketSelect" aria-label="${escapeHtml(t('bvAccount.retailMarket'))}">${MARKETS.map(code => `<option value="${code}" ${(me.retail_market || 'FR') === code ? "selected" : ""}>${escapeHtml(marketName(code))}</option>`).join("")}</select></div>
          <span class="bv-field__help">${escapeHtml(t('bvAccount.retailMarketHelp'))}</span></div>
      </div>`,
  }));
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
      hideSheet();
      await renderMe();
    } catch (err) {
      toast(t('common.errorWithDetails', { error: err.message || err }), "error");
    }
  });
  $("#retailMarketSelect")?.addEventListener("change", async (e) => {
    const val = e.target.value;
    haptic("medium");
    try {
      await api("/api/me", { method: "PATCH", body: { retail_market: val } });
      if (state.me) state.me.retail_market = val;
      toast(t('bvAccount.marketUpdated'), "success");
      const trail = $('#currencyRow .bv-row__trail');
      if (trail?.firstChild) trail.firstChild.textContent = [state.me?.currency || me.currency || 'USD', marketName(val)].join(' · ');
    } catch (error) {
      toast(error?.message || t('common.actionFailed'), "error");
    }
  });
}

// ----------------------------------------------------------- Public profile
function openPublicProfileSheet(me, publicProfile) {
  if (!me.handle) {
    showSheet(sheetBody({
      title: t('bvAccount.publicProfile'),
      sub: t('bvAccount.handleIntro'),
      inner: `<form class="bv-form" id="handleForm" novalidate>
          <div class="bv-field"><label for="chooseHandleInp">${escapeHtml(t('bvAccount.handle'))}</label><div class="bv-field__box"><span class="bv-field__prefix">@</span><input type="text" id="chooseHandleInp" placeholder="your-name" autocomplete="off" autocapitalize="none" maxlength="30"></div><span class="bv-field__help">${escapeHtml(t('bvAccount.handleHelp'))}</span></div>
          <button type="submit" class="bv-btn bv-btn--primary bv-btn--full" id="saveHandleBtn">${escapeHtml(t('bvAccount.setHandle'))}</button>
        </form>`,
    }));
    $("#handleForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const h = ($("#chooseHandleInp")?.value || "").trim().toLowerCase();
      if (!h) { toast(t('bvAccount.handleEmpty'), "info"); return; }
      if (!/^[a-zA-Z0-9-]{3,30}$/.test(h)) { toast(t('bvAccount.handleHelp'), "error"); return; }
      try {
        await api("/api/me", { method: "PATCH", body: { handle: h } });
        state.me = null;
        hideSheet();
        toast(t('bvAccount.handleSaved'), "success");
        await renderMe();
      } catch (err) {
        toast(t('common.errorWithDetails', { error: err.message || err }), "error");
      }
    });
    return;
  }
  const url = `${publicOrigin()}/#/u/${encodeURIComponent(me.handle)}`;
  const showcase = publicProfile?.showcase || [];
  const shelf = `<div class="bv-shelf">
      <div class="bv-shelf__head"><span class="bv-field__label">${escapeHtml(tPlural('me.trophyShelf', showcase.length))}</span></div>
      <div class="trophy-shelf">
        ${showcase.map(s => {
          const hasImg = s.image_url && !s.image_url.startsWith("data:");
          return `<div class="trophy-card">
              <button type="button" class="remove-trophy-btn" data-set="${escapeHtml(s.set_num)}" aria-label="${escapeHtml(t('bvAccount.removeTrophy', { name: s.name || s.set_num }))}">${icon('x', { size: 16, stroke: 2.4 })}</button>
              <div class="trophy-card__img${hasImg ? " has-photo" : ""}"><div class="brick-tile" style="--h:${setHue(s)};"></div>${hasImg ? `<img class="set-photo" src="${escapeHtml(s.image_url)}" alt="" loading="lazy">` : ""}</div>
              <div class="trophy-card__name">${escapeHtml(s.name)}</div>
            </div>`;
        }).join("")}
        ${showcase.length < 6 ? `<button type="button" class="trophy-add" id="addTrophyBtn">${icon('plus', { size: 20 })}<span>${escapeHtml(t('bvAccount.addToShelf'))}</span></button>` : ''}
      </div>
      ${showcase.length === 0 ? `<p class="bv-field__help">${escapeHtml(t('bvAccount.shelfEmpty'))}</p>` : ''}
    </div>`;
  const sw = (id, label, sub, on) => `<div class="bv-prefrow"><span class="bv-prefrow__text"><span class="bv-prefrow__title">${escapeHtml(label)}</span><span class="bv-prefrow__sub">${escapeHtml(sub)}</span></span>${toggle({ id, on, label })}</div>`;
  showSheet(sheetBody({
    title: t('bvAccount.publicProfile'),
    id: 'publicProfileSheet',
    inner: `<div class="bv-prefs">
        <div class="bv-group__box">
          ${sw('publicToggle', t('bvAccount.publicPortfolio'), t('bvAccount.publicPortfolioSub'), !!me.is_public)}
          ${sw('publicValToggle', t('bvAccount.showValue'), t('bvAccount.showValueSub'), !!me.expose_public_value)}
        </div>
        <div class="bv-linkbox public-profile-linkbox"><a href="${escapeHtml(url)}" class="public-profile-link">${escapeHtml(url)}</a>${btn(t('bvAccount.copy'), { kind: 'tonal', size: 'sm', id: 'copyProfileUrl' })}</div>
        ${shelf}
      </div>`,
  }));
  $$('#sheet a.public-profile-link').forEach(a => a.addEventListener('click', () => hideSheet()));

  // Switches update in place — repainting would jump the sheet on every flip.
  const wireSwitch = (id, field, onMsg, offMsg) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("click", async () => {
      const next = el.getAttribute('aria-checked') !== 'true';
      el.setAttribute("aria-checked", String(next));
      haptic("medium");
      try {
        await api("/api/me", { method: "PATCH", body: { [field]: next } });
        if (state.me) state.me[field] = next;
        toast(t(next ? onMsg : offMsg), "info");
        const sub = $('#publicProfileRow .bv-row__sub');
        if (field === 'is_public' && sub) sub.textContent = t(next ? 'bvAccount.publicOn' : 'bvAccount.publicOff');
      } catch (err) {
        el.setAttribute("aria-checked", String(!next));
        toast(t('common.errorWithDetails', { error: err.message || err }), "error");
      }
    });
  };
  wireSwitch('publicToggle', 'is_public', 'bvAccount.profilePublic', 'bvAccount.profilePrivate');
  wireSwitch('publicValToggle', 'expose_public_value', 'bvAccount.valueVisible', 'bvAccount.valueHidden');

  $("#copyProfileUrl")?.addEventListener("click", () => {
    navigator.clipboard.writeText(url).then(() => toast(t('bvAccount.linkCopied'), "success")).catch(() => toast(t('bvAccount.copyFailed'), "error"));
  });
  $$(".remove-trophy-btn").forEach(b => {
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const setNum = b.dataset.set;
      const next = showcase.filter(s => s.set_num !== setNum).map(s => s.set_num);
      haptic("medium");
      try {
        await api("/api/users/" + encodeURIComponent(me.handle) + "/showcase", { method: "POST", body: { set_nums: next } });
        toast(t('bvAccount.trophyRemoved'), "success");
        hideSheet();
        await renderMe();
      } catch (err) {
        toast(t('common.errorWithDetails', { error: err.message || err }), "error");
      }
    });
  });
  $("#addTrophyBtn")?.addEventListener("click", () => showSearchableTrophyPicker(showcase.map(s => s.set_num)));
}

// Kids Mode PIN flow (unchanged behaviour: set, enter, change, remove).
function openKidsMode(me) {
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
