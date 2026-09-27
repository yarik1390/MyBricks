// Retiring soon (#/retiring): sets LEGO.com lists as retiring, split into the
// ones you own, the ones on your wishlist and the whole catalog, each with a
// plain buy-window read. Data comes from the daily LEGO.com stock check
// (lego_retiring_soon / lego_in_stock) plus the retirement-risk model.
import { $, $$, escapeHtml, haptic } from '../utils.js';
import { t, tPlural } from '../lib/i18n.js';
import { state } from '../state.js';
import { api } from '../api.js';
import { topbar, iconBtn, tabs, pill, emptyState, skeletonRows, btn } from '../ui/kit.js';
import { setRow, money0, setValue } from '../ui/set-ui.js';

const TABS = ['yours', 'wishlist', 'all'];
let _tab = 'yours';
let _gen = 0;

const isRetiring = (s) => !s.retired && (s.lego_retiring_soon === 1 || s.lego_retiring_soon === true || Number(s.retirement_risk_score) >= 70);

function exitLabel(s) {
  const ts = s.exit_date ? Date.parse(s.exit_date) : NaN;
  if (Number.isFinite(ts)) return t('bvAdd.retiringOn', { date: new Date(ts).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) });
  return s.lego_retiring_soon ? t('bvAdd.retiringSoonLower') : t('bvAdd.likelyToRetire');
}

// Owned → Hold (retirement usually lifts value); wanted and at/under target or
// a live buy signal → Buy window; wanted otherwise → Fair price.
function pillFor(s, kind) {
  if (kind === 'yours') return pill(t('bvAdd.pillHold'));
  const target = Number(s.target_price);
  const value = setValue(s);
  if (s.deal_signal === 'buy' || (target > 0 && value > 0 && value <= target)) return pill(t('bvAdd.pillBuyWindow'), 'acc');
  return kind === 'wishlist' ? pill(t('bvAdd.pillFairPrice')) : '';
}

function rowFor(s, kind) {
  const meta = [s.theme, s.set_num, kind === 'yours' && Number(s.quantity) > 0 ? t('bvAdd.ownedCount', { count: s.quantity }) : exitLabel(s)].filter(Boolean).join(' · ');
  return setRow(s, {
    meta,
    endHtml: `<span class="bv-setrow__end"><span class="bv-setrow__value">${escapeHtml(money0(setValue(s)))}</span>${pillFor(s, kind)}</span>`,
  });
}

async function loadLists() {
  const [coll, wish, all] = await Promise.all([
    state.portfolio?.items ? Promise.resolve(state.portfolio) : api('/api/collection').catch(() => null),
    Array.isArray(state.wishlist) && state.wishlist.length ? Promise.resolve({ wishlist: state.wishlist }) : api('/api/wishlist').catch(() => null),
    api('/api/sets/search?retiring=1&sort=value_desc&limit=60').catch(() => null),
  ]);
  return {
    yours: (coll?.items || []).filter(isRetiring),
    wishlist: (wish?.wishlist || []).filter(isRetiring),
    all: all?.sets || [],
  };
}

function listHTML(lists) {
  if (_tab === 'yours' || _tab === 'wishlist') {
    const items = lists[_tab];
    if (!items.length) {
      return emptyState({
        icon: _tab === 'yours' ? 'vault' : 'heart',
        title: t(_tab === 'yours' ? 'bvAdd.noneRetiringYours' : 'bvAdd.noneRetiringWish'),
        body: t('bvAdd.noneRetiringBody'),
        actionsHtml: btn(t('bvAdd.seeAllRetiring'), { kind: 'tonal', full: true, id: 'retiringSeeAll' }),
      });
    }
    return `<h2 class="bv-h2">${escapeHtml(t(_tab === 'yours' ? 'bvAdd.youOwnHeading' : 'bvAdd.onWishlistHeading'))}</h2><div class="bv-group__box bv-gap">${items.map((s) => rowFor(s, _tab)).join('')}</div>`;
  }
  if (!lists.all.length) return emptyState({ icon: 'clock', title: t('bvAdd.noneRetiringAll') });
  return `<h2 class="bv-h2">${escapeHtml(tPlural('bvAdd.retiringCount', lists.all.length, { count: lists.all.length }))}</h2><div class="bv-group__box bv-gap">${lists.all.map((s) => rowFor(s, 'all')).join('')}</div>`;
}

export async function renderRetiring() {
  const root = $('#root');
  if (!root) return;
  const gen = ++_gen;
  const shell = (inner) => `<main class="bv-page no-nav bv-retiring" id="retiringPage">
      ${topbar({ title: t('bvAdd.retiringSoon'), sub: t('bvAdd.retiringSub'), back: 'history', actionsHtml: iconBtn({ icon: 'bell', label: t('bvAdd.retiringAlerts'), href: '#/me/notifications' }) })}
      ${tabs(TABS.map((id) => ({ label: t({ yours: 'bvAdd.tabYours', wishlist: 'bvAdd.tabWishlist', all: 'common.all' }[id]), value: id, selected: _tab === id, attrs: { id: `retiringTab-${id}`, 'aria-controls': 'retiringPanel' } })), { label: t('bvAdd.retiringSoon'), id: 'retiringTabs', cls: 'bv-tabs--seg' })}
      <div id="retiringPanel" role="tabpanel" aria-labelledby="retiringTab-${_tab}">${inner}</div>
      <p class="bv-foot">${escapeHtml(t('bvAdd.retiringFoot'))}</p>
    </main>`;
  root.innerHTML = shell(`<div class="bv-group__box bv-gap">${skeletonRows(3)}</div>`);
  const lists = await loadLists();
  if (gen !== _gen || location.hash !== '#/retiring') return;
  // Land on the most useful tab the first time: yours → wishlist → all.
  if (!lists[_tab].length && _tab !== 'all') _tab = lists.yours.length ? 'yours' : lists.wishlist.length ? 'wishlist' : 'all';
  const paint = () => {
    root.innerHTML = shell(listHTML(lists));
    $$('#retiringTabs [data-value]').forEach((b) => b.addEventListener('click', () => {
      if (_tab === b.dataset.value) return;
      _tab = b.dataset.value;
      haptic('light');
      paint();
      $(`#retiringTab-${_tab}`)?.focus();
    }));
    $('#retiringSeeAll')?.addEventListener('click', () => { _tab = 'all'; paint(); });
  };
  paint();
}
