// What changed (#/changes) — the Vault's inbox since the collector last looked:
// wishlist target hits and sell targets ("Needs you"), LEGO.com retirement news
// for owned and wished-for sets, and the biggest 7-day movers. It replaces the
// old alerts sheet: alerts are marked read on view, as before.
import { $, escapeHtml, haptic } from '../utils.js';
import { state } from '../state.js';
import { api, getSessionUserId } from '../api.js';
import { t, tPlural, getLocale } from '../lib/i18n.js';
import { changeItems, clipHistory } from '../lib/vault-insights.js';
import { topbar, iconBtn, icon, card, sectionTitle, emptyState, btn, sparkline, delta as deltaChip, skeletonRows } from '../ui/kit.js';
import { setThumb } from '../ui/set-ui.js';
import { moneyWhole, moneyWholeSigned } from '../ui/vault-ui.js';

const esc = (v) => escapeHtml(v == null ? '' : String(v));
const onChanges = () => location.hash.split('?')[0] === '#/changes';

// What this visit shows. Captured once on entry: viewing marks alerts read and
// resets the "since" window, and a background refresh must not empty the page.
let visit = null;

export async function renderChanges() {
  const root = $('#root');
  if (!root) return;
  const bell = iconBtn({ icon: 'bell', label: t('bvVault.alertSettings'), href: '#/me/notifications', id: 'changesSettings' });
  if (!state.portfolio) root.innerHTML = `<main class="bv-page no-nav vault-changes" aria-busy="true">${topbar({ title: t('bvVault.whatChanged'), back: 'history', actionsHtml: bell })}${skeletonRows(4)}</main>`;
  const portfolio = await import('./portfolio.js');
  await portfolio.loadPortfolioData();
  if (!onChanges()) return;
  const days = portfolio.changesWindow();
  const { owned, wished } = portfolio.retiringSets();
  visit = {
    owner: getSessionUserId(),
    days,
    alerts: (state.wishlistAlerts || []).slice(),
    retiringOwned: owned,
    retiringWished: wished,
    data: null,
  };
  paint(portfolio, bell);
  markRead(portfolio, [...owned, ...wished].map(r => r.set_num));
  const data = await portfolio.fetchVaultChanges(days).catch(() => null);
  if (!onChanges() || !visit || visit.owner !== getSessionUserId()) return;
  visit.data = data;
  paint(portfolio, bell);
}

// Viewing IS reading: the badge exists to say "something new" — once this
// screen has shown the alerts, clear them. Offline we deliberately skip: the
// server never learned they were seen, so the badge honestly persists.
function markRead(portfolio, retiringNums) {
  portfolio.markChangesSeen(retiringNums);
  if (!navigator.onLine) return;
  const ids = (visit?.alerts || []).map(a => a.id).filter(Boolean);
  if (!ids.length) return;
  state.wishlistAlerts = [];
  portfolio.refreshNavBadge();
  for (const id of ids) api(`/api/wishlist/${id}`, { method: 'POST' }).catch(() => {});
}

function sinceDate(data) {
  const iso = data?.since || new Date(Date.now() - (visit?.days || 7) * 86400000).toISOString().slice(0, 10);
  return iso;
}

function eventCard({ kind, iconName, title, sub, action, href, accent = false, setNum }) {
  return `<div class="changes-event${accent ? ' is-accent' : ''}"${setNum ? ` data-set-num="${esc(setNum)}"` : ''} data-kind="${esc(kind)}">
    <span class="changes-event__icon" aria-hidden="true">${icon(iconName, { size: 20 })}</span>
    <span class="changes-event__text"><span class="changes-event__title">${esc(title)}</span><span class="changes-event__sub">${esc(sub)}</span></span>
    ${btn(action, { kind: 'tonal', size: 'sm', href })}
  </div>`;
}

function alertEvent(item) {
  const a = item.alert;
  const name = item.name;
  const num = encodeURIComponent(a.set_num || '');
  if (item.kind === 'sell_target') {
    return eventCard({ kind: 'sell_target', iconName: 'tag', accent: true, setNum: a.set_num,
      title: t('bvVault.alertSellTitle', { name, price: moneyWhole(a.current_value) }),
      sub: t('bvVault.alertSellSub', { target: moneyWhole(a.target_price) }),
      action: t('bvVault.actionSell'), href: `#/set/${num}/sell` });
  }
  if (item.kind === 'spike') {
    const paid = Number(a.purchase_price ?? a.target_price);
    const pct = paid > 0 ? Math.round(((Number(a.current_value) - paid) / paid) * 100) : null;
    return eventCard({ kind: 'spike', iconName: 'trend', accent: true, setNum: a.set_num,
      title: pct != null ? t('bvVault.alertSpikeTitle', { name, pct: `${pct}%` }) : t('bvVault.changeSpike', { name }),
      sub: t('bvVault.alertSpikeSub', { price: moneyWhole(a.current_value), paid: paid > 0 ? moneyWhole(paid) : '—' }),
      action: t('bvVault.actionSell'), href: `#/set/${num}/sell` });
  }
  return eventCard({ kind: 'drop', iconName: 'heart', accent: true, setNum: a.set_num,
    title: t('bvVault.alertDropTitle', { name, price: moneyWhole(a.current_value) }),
    sub: t('bvVault.alertDropSub', { target: moneyWhole(a.target_price) }),
    action: t('bvVault.actionOffers'), href: '#/wishlist' });
}

function retiringEvent(item) {
  const r = item.row;
  const href = `#/set/${encodeURIComponent(r.set_num)}`;
  if (item.kind === 'retiringOwned') {
    return eventCard({ kind: 'retiringOwned', iconName: 'clock', setNum: r.set_num, title: r.name || r.set_num,
      sub: tPlural('bvVault.retiringOwnedSub', Math.max(1, Number(r.quantity) || 1)), action: t('bvVault.actionHold'), href });
  }
  return eventCard({ kind: 'retiringWished', iconName: 'clock', setNum: r.set_num, title: r.name || r.set_num,
    sub: t('bvVault.retiringWishedSub'), action: t('bvVault.actionBuy'), href });
}

function heroCard(data, count) {
  const p = state.portfolio || {};
  const total = moneyWhole(p.total_value ?? 0);
  const d = data && data.delta != null ? Number(data.delta) : null;
  const hist = clipHistory(state.portfolioHistory || [], Math.max(14, visit?.days || 7)).map(s => Number(s.total_value)).filter(Number.isFinite);
  const spark = sparkline(hist, { width: 340, height: 34 });
  const sub = [t('bvVault.collectionNow', { value: total })];
  if (count) sub.push(tPlural('bvVault.needsLook', count));
  if (d == null) {
    return card(`<span class="changes-hero__value bv-num">${esc(total)}</span><span class="changes-hero__sub">${esc(t('bvVault.noHistoryYet'))}</span>${spark}`, { cls: 'changes-hero' });
  }
  const tone = d > 0.5 ? 'bv-up' : d < -0.5 ? 'bv-down' : '';
  const chip = data.pct != null ? deltaChip(Number(data.pct), { srUp: t('bvCommon.upPct', { pct: Math.abs(Number(data.pct)).toFixed(1) }), srDown: t('bvCommon.downPct', { pct: Math.abs(Number(data.pct)).toFixed(1) }) }) : '';
  return card(`<span class="changes-hero__line"><span class="changes-hero__value bv-num ${tone}">${esc(moneyWholeSigned(d))}</span>${chip}</span><span class="changes-hero__sub">${esc(sub.join(' · '))}</span>${spark}`, { cls: 'changes-hero' });
}

function moverRow(m) {
  const tone = m.delta >= 0 ? 'bv-up' : 'bv-down';
  return `<a class="changes-mover" href="#/set/${encodeURIComponent(m.set_num)}" data-set-num="${esc(m.set_num)}">${setThumb(m, { size: 40, radius: 10 })}<span class="changes-mover__name">${esc(m.name || m.set_num)}</span><span class="bv-num changes-mover__delta ${tone}">${esc(moneyWholeSigned(m.delta))}</span>${deltaChip(Number(m.pct), { srUp: t('bvCommon.upPct', { pct: Math.abs(Number(m.pct)).toFixed(1) }), srDown: t('bvCommon.downPct', { pct: Math.abs(Number(m.pct)).toFixed(1) }) })}</a>`;
}

function paint(portfolio, bell) {
  if (!visit) return;
  const data = visit.data;
  const items = changeItems({ alerts: visit.alerts, retiringOwned: visit.retiringOwned, retiringWished: visit.retiringWished });
  const alerts = items.filter(i => i.alert);
  const retiring = items.filter(i => i.row);
  const movers = (data?.movers || []).filter(m => Number.isFinite(Number(m.delta)));
  const since = portfolio.sinceLabel(sinceDate(data));
  let dateText = '';
  try { dateText = new Date(`${sinceDate(data)}T12:00:00`).toLocaleDateString(getLocale(), { day: 'numeric', month: 'short' }); } catch { dateText = ''; }
  const sub = dateText ? t('bvVault.changesSub', { since, date: dateText }) : since;
  const quiet = !alerts.length && !retiring.length && !movers.length;
  const hasSets = (state.portfolio?.items || []).length > 0;
  $('#root').innerHTML = `<main class="bv-page no-nav vault-changes" id="changesPage">
    ${topbar({ title: t('bvVault.whatChanged'), sub, back: 'history', actionsHtml: bell })}
    ${hasSets ? heroCard(data, alerts.length + retiring.length) : ''}
    ${alerts.length ? `${sectionTitle(t('bvVault.needsYou'))}<div class="changes-list">${alerts.map(alertEvent).join('')}</div>` : ''}
    ${retiring.length ? `${sectionTitle(t('bvVault.retiringTitle'))}<div class="changes-list">${retiring.map(retiringEvent).join('')}</div>` : ''}
    ${movers.length ? `${sectionTitle(tPlural('bvVault.moversTitle', Number(data?.mover_days) || 7))}<div class="changes-movers">${movers.map(moverRow).join('')}</div>` : ''}
    ${quiet ? emptyState({ icon: 'bell', title: t('bvVault.quietTitle'), body: t('bvVault.quietBody'), actionsHtml: btn(t('bvVault.alertSettings'), { href: '#/me/notifications', kind: 'tonal', icon: 'bell' }) }) : ''}
  </main>`;
  $('#changesPage')?.addEventListener('click', (e) => { if (e.target.closest('a')) haptic('light'); });
}
