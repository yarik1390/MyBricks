// BricksVault Pro (#/pro) — 2026 redesign. What Pro adds, the price, and one
// way to get it: Google Play billing through RevenueCat in the installed app,
// Patreon on the web. Members see their status and how to manage it. Billing
// logic is unchanged — this screen only calls the existing helpers.
import { $, escapeHtml, haptic, toast, celebrate } from '../utils.js';
import { state } from '../state.js';
import { t } from '../lib/i18n.js';
import { topbar, icon, btn } from '../ui/kit.js';
import { go } from '../router.js';
import { isNativeBilling, proPurchaseReady, presentProPaywall, restorePurchases, presentCustomerCenter, proPlanPrices } from '../lib/revenuecat-native.js';
import { loadMe } from './me-shared.js';

const BENEFITS = [
  ['trend', 'bvAccount.proInsights', 'bvAccount.proInsightsSub'],
  ['clock', 'bvAccount.proHistory', 'bvAccount.proHistorySub'],
  ['camera', 'bvAccount.proScans', 'bvAccount.proScansSub'],
  ['download', 'bvAccount.proExports', 'bvAccount.proExportsSub'],
  ['star', 'bvAccount.proSkin', 'bvAccount.proSkinSub'],
];

function benefitsHTML() {
  return `<ul class="bv-probenefits">${BENEFITS.map(([ic, title, sub]) => `<li>${icon(ic, { size: 22 })}<span><span class="bv-probenefits__title">${escapeHtml(t(title))}</span><span class="bv-probenefits__sub">${escapeHtml(t(sub))}</span></span></li>`).join('')}</ul>`;
}

function plansHTML(prices) {
  const annual = prices.find((p) => p.type === 'ANNUAL');
  const monthly = prices.find((p) => p.type === 'MONTHLY');
  if (!annual && !monthly) return '';
  const card = (p, title, note, best) => p ? `<div class="bv-proplan${best ? ' is-best' : ''}"><span class="bv-proplan__title">${escapeHtml(t(title))}</span><span class="bv-proplan__price bv-num">${escapeHtml(p.price)}</span><span class="bv-proplan__note">${escapeHtml(t(note))}</span></div>` : '';
  return `<div class="bv-proplans">${card(annual, 'bvAccount.planYearly', 'bvAccount.planBest', true)}${card(monthly, 'bvAccount.planMonthly', 'bvAccount.planCancel', false)}</div>`;
}

export async function renderPro() {
  const root = $('#root');
  if (!root) return;
  const me = await loadMe();
  const native = isNativeBilling();
  const active = !!me.is_supporter;
  const patreon = state.config?.patreon_url;
  const prices = native && !active ? await proPlanPrices() : [];
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
    </main>`;

  $('#rcUpgradeBtn')?.addEventListener('click', async () => {
    haptic('medium');
    const r = await presentProPaywall();
    if (r.ok && r.active) {
      state.me = null;
      celebrate(t('bvAccount.proWelcome'), { quip: t('bvAccount.proWelcomeQuip'), hue: 300 });
      go('#/me');
    } else if (!r.ok && r.reason !== 'cancelled') toast(t('bvAccount.proStoreDown'), 'error');
  });
  $('#rcRestoreBtn')?.addEventListener('click', async () => {
    haptic('light');
    const restored = await restorePurchases();
    toast(t(restored ? 'bvAccount.proRestored' : 'bvAccount.proNothingRestore'), restored ? 'success' : 'info');
    if (restored) { state.me = null; renderPro(); }
  });
  $('#rcManageBtn')?.addEventListener('click', () => { haptic('light'); presentCustomerCenter(); });
}
