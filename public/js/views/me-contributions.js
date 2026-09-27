// Your contributions (#/me/contributions) — 2026 redesign. Photos, prices,
// reviews and data fixes the collector has shared, with their review status.
// Pending items can be withdrawn. Badges are a client-side reading of the
// approved count: Contributor at 5, Gold at 15.
import { $, $$, haptic, toast, escapeHtml } from '../utils.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { go } from '../router.js';
import { loadMe } from './me-shared.js';
import { t, tPlural, intlLocale } from '../lib/i18n.js';
import { topbar, seg, icon, pill, bar, btn, emptyState, skeletonRows } from '../ui/kit.js';

const CONTRIBUTOR_AT = 5;
const GOLD_AT = 15;
const onScreen = () => location.hash.split('?')[0] === '#/me/contributions';

let items = [];
let approvedTotal = 0;
let filter = 'all';

function kindKey(s) {
  if (s.type === 'photo') return 'photo';
  if (s.type === 'review') return 'review';
  return { price: 'price', barcode: 'barcode', image: 'image', partlist: 'partlist', metadata: 'metadata' }[s.kind] || 'data';
}
const KIND_LABEL = {
  photo: 'bvCommunity.kindPhoto', review: 'bvCommunity.kindReview', price: 'bvCommunity.kindPrice', barcode: 'bvCommunity.kindBarcode',
  image: 'bvCommunity.kindImage', partlist: 'bvCommunity.kindPartlist', metadata: 'bvCommunity.kindMetadata', data: 'bvCommunity.kindData',
};
const KIND_ICON = { photo: 'photo', review: 'chat', price: 'tag', barcode: 'scan', image: 'photo', partlist: 'list', metadata: 'edit', data: 'edit' };

function when(str) {
  if (!str) return '';
  const d = new Date(String(str).includes('T') ? str : `${String(str).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short' });
}

function summaryHTML(approved) {
  const tier = approved >= GOLD_AT ? 'bvCommunity.tierGold' : approved >= CONTRIBUTOR_AT ? 'bvCommunity.tierContributor' : '';
  const next = approved >= GOLD_AT ? null : approved >= CONTRIBUTOR_AT ? GOLD_AT : CONTRIBUTOR_AT;
  const goal = next == null
    ? t('bvCommunity.goalDone')
    : tPlural(next === GOLD_AT ? 'bvCommunity.goalGold' : 'bvCommunity.goalContributor', next - approved, { count: next - approved });
  const pct = next == null ? 100 : (approved / next) * 100;
  return `<section class="bv-card bv-contribsum">
    <div class="bv-contribsum__top">
      <span class="bv-contribsum__num" aria-hidden="true">${approved}</span>
      <span class="bv-contribsum__text">
        <span class="bv-contribsum__label"><span aria-hidden="true">${escapeHtml(t('bvCommunity.approvedWord'))}</span>${tier ? `<span aria-hidden="true"> · </span>${icon('star', { size: 16, stroke: 2.4 })}<span>${escapeHtml(t(tier))}</span>` : ''}<span class="bv-sr bv-contribsum__sr">${escapeHtml(tPlural('contributions.approved', approved))}</span></span>
        <span class="bv-contribsum__goal">${escapeHtml(goal)}</span>
      </span>
    </div>
    ${bar(pct, { label: goal, acc: true })}
  </section>`;
}

function rowHTML(s) {
  const kind = kindKey(s);
  const name = s.set_name || s.set_num;
  const title = t('bvCommunity.contribTitle', { kind: t(KIND_LABEL[kind] || KIND_LABEL.data), name });
  let sub;
  let trail;
  if (s.status === 'pending') {
    sub = t('bvCommunity.waiting');
    trail = `<button type="button" class="bv-btn bv-btn--text bv-btn--sm contrib-withdraw">${escapeHtml(t('bvCommunity.withdraw'))}</button>`;
  } else if (s.status === 'approved') {
    const d = when(s.reviewed_at || s.created_at);
    sub = d ? t('bvCommunity.approvedOn', { date: d }) : t('bvCommunity.statusApproved');
    trail = pill(t('bvCommunity.statusApproved'), 'gain');
  } else {
    sub = s.review_note ? t('bvCommunity.notAddedNote', { note: s.review_note }) : t('bvCommunity.notAdded');
    trail = pill(t('bvCommunity.statusDeclined'), 'loss');
  }
  return `<div class="bv-contrib contrib-mine-row" data-type="${escapeHtml(s.type)}" data-id="${escapeHtml(String(s.id))}" data-status="${escapeHtml(s.status)}">
    <a class="bv-contrib__main" href="#/set/${encodeURIComponent(s.set_num)}/community">
      <span class="bv-contrib__ico">${icon(KIND_ICON[kind] || 'edit', { size: 20 })}</span>
      <span class="bv-contrib__text"><span class="bv-contrib__title">${escapeHtml(title)}</span><span class="bv-contrib__sub">${escapeHtml(sub)}</span></span>
    </a>
    ${trail}
  </div>`;
}

function bodyHTML() {
  const approved = approvedTotal;
  const pending = items.filter((s) => s.status === 'pending').length;
  if (!items.length) {
    return summaryHTML(approved) + emptyState({ icon: 'photo', title: t('bvCommunity.contribEmptyTitle'), body: t('bvCommunity.contribEmptyBody'), actionsHtml: btn(t('bvCommunity.openVault'), { href: '#/', kind: 'tonal' }) });
  }
  const shown = filter === 'all' ? items : items.filter((s) => s.status === filter);
  const segHtml = seg([
    { label: t('bvCommunity.filterAll'), value: 'all', current: filter === 'all', attrs: { 'data-cfilter': 'all' } },
    { label: pending ? t('bvCommunity.filterPendingN', { count: pending }) : t('bvCommunity.filterPending'), value: 'pending', current: filter === 'pending', attrs: { 'data-cfilter': 'pending' } },
    { label: t('bvCommunity.filterApproved'), value: 'approved', current: filter === 'approved', attrs: { 'data-cfilter': 'approved' } },
  ], { label: t('bvCommunity.filterLabel'), id: 'contribFilter' });
  const list = shown.length
    ? `<section class="bv-card bv-contribs">${shown.map(rowHTML).join('')}</section>`
    : `<p class="bv-pub__note">${escapeHtml(t(filter === 'pending' ? 'bvCommunity.noPending' : 'bvCommunity.noApproved'))}</p>`;
  return `${summaryHTML(approved)}<div class="bv-contrib__seg">${segHtml}</div>${list}`;
}

function paint() {
  const body = $('#contribMineBody');
  if (!body || !onScreen()) return;
  body.innerHTML = bodyHTML();
  $$('[data-cfilter]').forEach((b) => b.addEventListener('click', () => {
    if (filter === b.dataset.cfilter) return;
    haptic('light');
    filter = b.dataset.cfilter;
    paint();
  }));
  $$('.contrib-withdraw').forEach((b) => b.addEventListener('click', async () => {
    const row = b.closest('.contrib-mine-row');
    if (!row) return;
    b.disabled = true;
    try {
      await api(`/api/contributions/${row.dataset.type}/${row.dataset.id}`, { method: 'DELETE' });
      haptic('light');
      toast(t('bvCommunity.withdrawn'), 'success');
      items = items.filter((s) => !(String(s.id) === row.dataset.id && s.type === row.dataset.type));
      paint();
    } catch (e) {
      b.disabled = false;
      toast(e?.message || t('bvCommunity.withdrawFailed'), 'error');
    }
  }));
}

export async function renderMeContributions() {
  filter = 'all';
  const root = $('#root');
  if (!root) return;
  const shell = (inner) => `<main class="bv-page bv-contribpage">
      ${topbar({ title: t('bvCommunity.contribTitlePage'), sub: t('bvCommunity.contribSub'), back: '#/me', backLabel: t('bvAccount.backProfile') })}
      <div id="contribMineBody">${inner}</div>
    </main>`;
  if (!state.me) root.innerHTML = shell(`<section class="bv-card bv-contribs">${skeletonRows(4)}</section>`);
  const me = await loadMe();
  if (me?.is_guest) { go('#/me'); return; }
  if (!onScreen()) return;
  root.innerHTML = shell(`<section class="bv-card bv-contribs" aria-busy="true">${skeletonRows(4)}</section>`);
  try {
    const data = await api('/api/contributions/mine');
    items = data?.submissions || [];
    approvedTotal = Number(data?.approved_count ?? items.filter((s) => s.status === 'approved').length) || 0;
  } catch {
    const body = $('#contribMineBody');
    if (body && onScreen()) {
      body.innerHTML = emptyState({ icon: 'cloudOff', title: t('bvCommunity.loadFailedTitle'), body: t('bvCommunity.loadFailedBody'), actionsHtml: btn(t('bvCommunity.retry'), { kind: 'tonal', id: 'contribRetry' }), role: 'alert' });
      $('#contribRetry')?.addEventListener('click', renderMeContributions);
    }
    return;
  }
  paint();
}
