// BricksVault Pro (#/pro) — 2026 redesign. What Pro adds, the price, and one
// way to get it: Google Play billing through RevenueCat in the installed app,
// Patreon on the web. In the app the plan cards pick the plan and Continue opens
// Google Play's purchase sheet for it. Members see their status and how to
// manage it.
import { $, escapeHtml, haptic, toast, celebrate } from '../utils.js';
import { state } from '../state.js';
import { t } from '../lib/i18n.js';
import { topbar, icon, btn } from '../ui/kit.js';
import { go } from '../router.js';
import { isNativeBilling, proPurchaseReady, purchaseProPlan, restorePurchases, presentCustomerCenter, proPlanPrices } from '../lib/revenuecat-native.js';
import { loadMe } from './me-shared.js';
import { api } from '../api.js';

const BENEFITS = [
  ['trend', 'bvAccount.proInsights', 'bvAccount.proInsightsSub'],
  ['clock', 'bvAccount.proHistory', 'bvAccount.proHistorySub'],
  ['camera', 'bvAccount.proScans', 'bvAccount.proScansSub'],
  ['download', 'bvAccount.proExports', 'bvAccount.proExportsSub'],
  ['tag', 'bvAccount.proTax', 'bvAccount.proTaxSub'],
  ['box', 'bvAccount.proLots', 'bvAccount.proLotsSub'],
  ['bell', 'bvAccount.proAlertsFirst', 'bvAccount.proAlertsFirstSub'],
  ['star', 'bvAccount.proSkin', 'bvAccount.proSkinSub'],
  ['heart', 'bvAccount.proWall', 'bvAccount.proWallSub'],
];

// Thanks wall: Pro members with a public profile. Optional — an empty or
// failed list just leaves the section out.
async function loadSupporters() {
  try { return (await api('/api/users/supporters'))?.supporters || []; } catch { return []; }
}

function wallHTML(list) {
  if (!list.length) return '';
  return `<section class="bv-prowall" aria-labelledby="proWallTitle">
      <h2 class="bv-h2" id="proWallTitle">${escapeHtml(t('bvAccount.proWallTitle'))}</h2>
      <ul class="bv-prowall__list">${list.map((p) => `<li><a href="#/u/${encodeURIComponent(p.handle)}">${icon('star', { size: 14 })}<span>${escapeHtml(p.name)}</span></a></li>`).join('')}</ul>
    </section>`;
}

function benefitsHTML() {
  return `<ul class="bv-probenefits">${BENEFITS.map(([ic, title, sub]) => `<li>${icon(ic, { size: 22 })}<span><span class="bv-probenefits__title">${escapeHtml(t(title))}</span><span class="bv-probenefits__sub">${escapeHtml(t(sub))}</span></span></li>`).join('')}</ul>`;
}

// The plan cards are the picker: tapping one selects it, Continue buys it
// straight through Google Play.
function plansHTML(prices) {
  const annual = prices.find((p) => p.type === 'ANNUAL');
  const monthly = prices.find((p) => p.type === 'MONTHLY');
  const lifetime = prices.find((p) => p.type === 'LIFETIME');
  if (!annual && !monthly && !lifetime) return '';
  const selected = defaultPlan(prices);
  const card = (p, title, note) => p ? `<button type="button" class="bv-proplan${p.type === selected ? ' is-best' : ''}" data-plan="${p.type}" aria-pressed="${p.type === selected}"><span class="bv-proplan__title">${escapeHtml(t(title))}</span><span class="bv-proplan__price bv-num">${escapeHtml(p.price)}</span><span class="bv-proplan__note">${escapeHtml(t(note))}</span></button>` : '';
  return `<div class="bv-proplans" role="group" aria-label="${escapeHtml(t('bvAccount.planPick'))}">${card(annual, 'bvAccount.planYearly', 'bvAccount.planBest')}${card(monthly, 'bvAccount.planMonthly', 'bvAccount.planCancel')}${card(lifetime, 'bvAccount.planLifetime', 'bvAccount.planOnce')}</div>`;
}

// Yearly is preselected when offered; Lifetime (a one-time Play product) only
// when it is the sole plan.
function defaultPlan(prices) {
  return ['ANNUAL', 'MONTHLY', 'LIFETIME'].find((type) => prices.some((p) => p.type === type)) || 'ANNUAL';
}

const PURCHASE_ERRORS = {
  not_allowed: 'bvAccount.proErrNotAllowed',
  not_available: 'bvAccount.proErrNotAvailable',
  already_owned: 'bvAccount.proErrOwned',
  network: 'bvAccount.proErrNetwork',
  setup: 'bvAccount.proErrSetup',
};

export async function renderPro() {
  const root = $('#root');
  if (!root) return;
  const me = await loadMe();
  const native = isNativeBilling();
  const active = !!me.is_supporter;
  const patreon = state.config?.patreon_url;
  const [prices, supporters] = await Promise.all([native && !active ? proPlanPrices() : [], loadSupporters()]);
  if (location.hash.split('?')[0] !== '#/pro') return;

  let actions;
  if (active) {
    actions = `<div class="bv-proactive" role="status">${icon('star', { size: 22 })}<span><span class="bv-probenefits__title">${escapeHtml(t('bvAccount.proYouHave'))}</span><span class="bv-probenefits__sub">${escapeHtml(t('bvAccount.proThanks'))}</span></span></div>
      ${native ? btn(t('bvAccount.proManage'), { kind: 'outline', full: true, id: 'rcManageBtn' }) : patreon ? btn(t('bvAccount.proManagePatreon'), { kind: 'outline', full: true, href: patreon, attrs: { target: '_blank', rel: 'noopener' } }) : ''}`;
  } else if (native) {
    actions = `${plansHTML(prices)}
      ${btn(t('bvAccount.proContinue'), { full: true, size: 'lg', id: 'rcUpgradeBtn', disabled: !proPurchaseReady() })}
      ${btn(t('bvAccount.proRestore'), { kind: 'text', full: true, id: 'rcRestoreBtn' })}
      <p class="bv-profoot">${escapeHtml(t('bvAccount.proBilledPlay'))}</p>`;
  } else if (patreon) {
    actions = `${btn(t('bvAccount.proPatreon'), { full: true, size: 'lg', href: patreon, attrs: { target: '_blank', rel: 'noopener' }, cls: 'patreon-btn' })}
      <p class="bv-profoot">${escapeHtml(t('bvAccount.proPatreonNote'))}</p>`;
  } else {
    actions = `<p class="bv-profoot">${escapeHtml(t('bvAccount.proUnavailable'))}</p>`;
  }

  root.innerHTML = `<main class="bv-page no-nav bv-pro" id="proPage">
      ${topbar({ title: t('bvAccount.proTitle'), sub: t('bvAccount.proSub'), back: '#/me' })}
      <section class="bv-procard" aria-label="${escapeHtml(t('bvAccount.proWhat'))}">${benefitsHTML()}</section>
      <div class="bv-proactions">${actions}</div>
      ${wallHTML(supporters)}
    </main>`;

  let plan = defaultPlan(prices);
  root.querySelectorAll('.bv-proplan[data-plan]').forEach((b) => b.addEventListener('click', () => {
    haptic('light');
    plan = b.dataset.plan;
    root.querySelectorAll('.bv-proplan[data-plan]').forEach((o) => {
      const on = o === b;
      o.classList.toggle('is-best', on);
      o.setAttribute('aria-pressed', String(on));
    });
  }));
  $('#rcUpgradeBtn')?.addEventListener('click', async (e) => {
    haptic('medium');
    const button = e.currentTarget;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    const r = await purchaseProPlan(plan);
    if (button.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); }
    if (r.ok && r.active) {
      state.me = null;
      celebrate(t('bvAccount.proWelcome'), { quip: t('bvAccount.proWelcomeQuip'), hue: 300 });
      go('#/me');
    } else if (!r.ok && r.reason !== 'cancelled') {
      const key = PURCHASE_ERRORS[r.reason];
      toast(key ? t(key) : r.detail ? t('bvAccount.proErrStore', { detail: r.detail }) : t('bvAccount.proStoreDown'), 'error');
    }
  });
  $('#rcRestoreBtn')?.addEventListener('click', async () => {
    haptic('light');
    const restored = await restorePurchases();
    toast(t(restored ? 'bvAccount.proRestored' : 'bvAccount.proNothingRestore'), restored ? 'success' : 'info');
    if (restored) { state.me = null; renderPro(); }
  });
  $('#rcManageBtn')?.addEventListener('click', () => { haptic('light'); presentCustomerCenter(); });
}
