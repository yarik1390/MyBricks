// Notifications (#/me/notifications) — 2026 redesign. One switch per kind of
// alert, grouped Prices / Availability / Summary, plus how they reach you.
// Switches save optimistically. The first time an alert is switched on while
// push is off, one sentence explains why before the system permission prompt —
// never at launch.
import { $, $$, escapeHtml, haptic, toast } from '../utils.js';
import { state } from '../state.js';
import { api, isGuestMode } from '../api.js';
import { t } from '../lib/i18n.js';
import { topbar, toggle, row, sheetBody, btn, banner } from '../ui/kit.js';
import { showSheet, hideSheet } from '../components/sheet.js';
import { pushStatus, turnOnPush, turnOffPush } from '../lib/push-delivery.js';

const ASKED_KEY = 'bv_push_asked';
const GROUPS = [
  ['bvAlerts.groupPrices', [
    ['notify_price_drops', 'bvAlerts.nWishlist', 'bvAlerts.nWishlistSub'],
    ['notify_sell_targets', 'bvAlerts.nSell', 'bvAlerts.nSellSub'],
    ['notify_big_moves', 'bvAlerts.nMoves', 'bvAlerts.nMovesSub'],
  ]],
  ['bvAlerts.groupAvailability', [
    ['notify_retiring', 'bvAlerts.nRetiring', 'bvAlerts.nRetiringSub'],
    ['notify_back_in_stock', 'bvAlerts.nStock', 'bvAlerts.nStockSub'],
  ]],
];
const ALERT_KEYS = GROUPS.flatMap(([, rows]) => rows.map(([key]) => key));
const onScreen = () => location.hash.split('?')[0] === '#/me/notifications';

let prefs = null;
let push = 'off';

function hourLabel(h) {
  return new Date(2020, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function subtitle() {
  const pushOn = push === 'on';
  const email = !isGuestMode() && !!state.me?.email;
  const weekly = !!prefs.notify_weekly_digest;
  if (pushOn && email) return t(weekly ? 'bvAlerts.subPushWeekly' : 'bvAlerts.subPushEmail');
  if (pushOn) return t('bvAlerts.subPush');
  if (email) return t(weekly ? 'bvAlerts.subEmailWeekly' : 'bvAlerts.subEmail');
  return t('bvAlerts.subInApp');
}

function switchRow(key, title, sub, { disabled = false } = {}) {
  const id = `nt-${key}`;
  return `<div class="bv-notrow"><span class="bv-notrow__text"><span class="bv-notrow__title" id="${id}-t">${escapeHtml(t(title))}</span><span class="bv-notrow__sub">${escapeHtml(t(sub))}</span></span>${toggle({ id, on: !!prefs[key], label: t(title), disabled, attrs: { 'data-pref': key, 'aria-describedby': `${id}-t` } })}</div>`;
}

function group(title, inner) {
  return `<section class="bv-notgroup"><h2 class="bv-h2">${escapeHtml(t(title))}</h2><div class="bv-group__box">${inner}</div></section>`;
}

function hoursSelect(id, value, label) {
  return `<label class="bv-quiet__field"><span>${escapeHtml(t(label))}</span><select id="${id}" class="bv-quiet__select">${Array.from({ length: 24 }, (_, h) => `<option value="${h}"${h === value ? ' selected' : ''}>${escapeHtml(hourLabel(h))}</option>`).join('')}</select></label>`;
}

function pushRowHTML() {
  const guest = push === 'guest';
  const sub = {
    on: 'bvAlerts.pushOnSub', off: 'bvAlerts.pushOffSub', blocked: 'bvAlerts.pushBlocked',
    unsupported: 'bvAlerts.pushUnsupported', setup: 'bvAlerts.pushSetup', guest: 'bvAlerts.pushGuest',
  }[push] || 'bvAlerts.pushOffSub';
  const locked = guest || push === 'blocked' || push === 'unsupported' || push === 'setup';
  return `<div class="bv-notrow"><span class="bv-notrow__text"><span class="bv-notrow__title" id="nt-push-t">${escapeHtml(t('bvAlerts.push'))}</span><span class="bv-notrow__sub">${escapeHtml(t(sub))}</span></span>${toggle({ id: 'ntPush', on: push === 'on', label: t('bvAlerts.push'), disabled: locked })}</div>`;
}

function pageHTML() {
  const guest = isGuestMode();
  const q = prefs.quiet_hours;
  const summary = [
    switchRow('notify_weekly_digest', 'bvAlerts.nDigest', 'bvAlerts.nDigestSub', { disabled: guest }),
    `<div class="bv-notrow bv-notrow--quiet"><span class="bv-notrow__text"><span class="bv-notrow__title" id="nt-quiet_hours-t">${escapeHtml(t('bvAlerts.nQuiet'))}</span><span class="bv-notrow__sub" id="ntQuietSub">${escapeHtml(t('bvAlerts.nQuietRange', { start: hourLabel(prefs.quiet_start), end: hourLabel(prefs.quiet_end) }))}</span></span>${toggle({ id: 'nt-quiet_hours', on: !!q, label: t('bvAlerts.nQuiet'), attrs: { 'data-pref': 'quiet_hours', 'aria-describedby': 'nt-quiet_hours-t' } })}</div>`,
    q ? `<div class="bv-quiet" id="ntQuietHours">${hoursSelect('ntQuietStart', prefs.quiet_start, 'bvAlerts.quietFrom')}${hoursSelect('ntQuietEnd', prefs.quiet_end, 'bvAlerts.quietTo')}<p class="bv-quiet__note">${escapeHtml(t('bvAlerts.quietNote'))}</p></div>` : '',
  ].join('');
  const email = state.me?.email;
  const delivery = pushRowHTML()
    + row({ icon: 'send', title: t('bvAlerts.email'), sub: guest ? t('bvAlerts.emailGuest') : email || t('bvAlerts.emailNone'), href: guest ? '#/login' : '#/me/integrations' })
    + row({ icon: 'chat', title: t('bvAlerts.discord'), sub: state.me?.discord_webhook_url ? t('bvAlerts.connected') : t('bvAlerts.notConnected'), href: guest ? '#/login' : '#/me/integrations' });
  return `<main class="bv-page no-nav bv-notifs" id="notificationsPage">
      ${topbar({ title: t('bvAlerts.notifications'), sub: subtitle(), back: 'history' })}
      ${guest ? `<div class="bv-notifs__banner">${banner({ icon: 'info', kind: 'neutral', text: t('bvAlerts.guestNote'), action: t('bvAlerts.signIn'), actionHref: '#/login' })}</div>` : ''}
      ${GROUPS.map(([title, rows]) => group(title, rows.map(([key, ti, sub]) => switchRow(key, ti, sub)).join(''))).join('')}
      ${group('bvAlerts.groupSummary', summary)}
      ${group('bvAlerts.groupDelivery', delivery)}
    </main>`;
}

function paint() {
  const root = $('#root');
  if (!root || !onScreen()) return;
  root.innerHTML = pageHTML();
  wire();
}

export async function renderMeNotifications() {
  const root = $('#root');
  if (!root) return;
  if (!state.me) {
    try { state.me = await api('/api/me'); } catch { /* offline: fall back to defaults */ }
  }
  const me = state.me || {};
  const master = me.notify_price_drops !== false;
  prefs = {
    notify_price_drops: master,
    notify_sell_targets: me.notify_sell_targets ?? master,
    notify_big_moves: me.notify_big_moves ?? master,
    notify_retiring: me.notify_retiring ?? master,
    notify_back_in_stock: me.notify_back_in_stock ?? master,
    notify_weekly_digest: !!me.notify_weekly_digest,
    quiet_hours: !!me.quiet_hours,
    quiet_start: Number.isInteger(me.quiet_start) ? me.quiet_start : 22,
    quiet_end: Number.isInteger(me.quiet_end) ? me.quiet_end : 8,
  };
  push = 'off';
  paint();
  push = await pushStatus().catch(() => 'unsupported');
  paint();
}

async function savePrefs(patch, revert) {
  Object.assign(prefs, patch);
  if (state.me) Object.assign(state.me, patch);
  try {
    await api('/api/me', { method: 'PATCH', body: patch });
  } catch (err) {
    revert();
    if (state.me) Object.assign(state.me, Object.fromEntries(Object.keys(patch).map(k => [k, prefs[k]])));
    paint();
    toast(t('common.errorWithDetails', { error: err.message || err }), 'error');
  }
}

function wire() {
  $$('#notificationsPage [data-pref]').forEach(tg => tg.addEventListener('click', async () => {
    const key = tg.dataset.pref;
    const next = !prefs[key];
    const prev = prefs[key];
    haptic('light');
    tg.setAttribute('aria-checked', String(next));
    const patch = { [key]: next };
    if (key === 'quiet_hours' && next) {
      try { patch.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { /* keep server value */ }
    }
    await savePrefs(patch, () => { prefs[key] = prev; });
    if (key === 'quiet_hours') paint();
    else $('#notificationsPage .bv-topbar__sub') && ($('#notificationsPage .bv-topbar__sub').textContent = subtitle());
    // Answer before asking: the switch is already on; only now, in context,
    // offer push — once — if this device can take it.
    if (next && ALERT_KEYS.includes(key) && push === 'off' && !askedBefore()) offerPush();
  }));
  for (const [id, key] of [['#ntQuietStart', 'quiet_start'], ['#ntQuietEnd', 'quiet_end']]) {
    $(id)?.addEventListener('change', async (e) => {
      const prev = prefs[key];
      const value = Number(e.target.value);
      const sub = $('#ntQuietSub');
      prefs[key] = value;
      if (sub) sub.textContent = t('bvAlerts.nQuietRange', { start: hourLabel(prefs.quiet_start), end: hourLabel(prefs.quiet_end) });
      await savePrefs({ [key]: value }, () => { prefs[key] = prev; });
    });
  }
  $('#ntPush')?.addEventListener('click', async () => {
    if (push === 'on') {
      haptic('light');
      push = 'off';
      paint();
      await turnOffPush().catch(() => {});
      toast(t('bvAlerts.pushTurnedOff'), 'info');
      return;
    }
    await enablePush();
  });
}

function askedBefore() {
  try { return localStorage.getItem(ASKED_KEY) === '1'; } catch { return false; }
}

function offerPush() {
  try { localStorage.setItem(ASKED_KEY, '1'); } catch {}
  showSheet(sheetBody({
    title: t('bvAlerts.permTitle'),
    inner: `<p class="bv-sheet__sub bv-permcopy">${escapeHtml(t('bvAlerts.permBody'))}</p>
      ${btn(t('bvAlerts.permAllow'), { id: 'ntPermAllow', full: true, icon: 'bell' })}
      ${btn(t('bvAlerts.permLater'), { id: 'ntPermLater', kind: 'text', full: true })}`,
  }));
  $('#ntPermLater')?.addEventListener('click', () => hideSheet());
  $('#ntPermAllow')?.addEventListener('click', async () => { hideSheet(); await enablePush(); });
}

async function enablePush() {
  try {
    await turnOnPush();
    push = 'on';
    haptic('success');
    toast(t('bvAlerts.pushTurnedOn'), 'success');
  } catch (err) {
    push = await pushStatus().catch(() => 'off');
    toast(err?.code === 'denied' || push === 'blocked' ? t('bvAlerts.pushDenied') : t('common.errorWithDetails', { error: err.message || err }), 'error');
  }
  if (onScreen()) paint();
}
