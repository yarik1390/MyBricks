// Coming soon (#/upcoming): sets LEGO has announced but not yet released, each
// with a bell that wishlists it (the wishlist is what sends the release and
// price alerts). It used to be a section on Discover; Discover now keeps only
// a shortcut tile so the catalog itself starts near the top.
import { $, escapeHtml, haptic, toast } from '../utils.js';
import { t } from '../lib/i18n.js';
import { state } from '../state.js';
import { api, getSessionUserId } from '../api.js';
import { topbar, icon, emptyState, skeletonRows, btn } from '../ui/kit.js';
import { setThumb, money0 } from '../ui/set-ui.js';

let _gen = 0;

/**
 * Upcoming releases, fetched once per session (Discover's tile shares it).
 * A failed fetch (offline included) rejects and stays unloaded, so it is
 * retried instead of passing for "nothing announced".
 */
export async function loadUpcoming() {
  if (state.catalog.upcomingLoaded) return state.catalog.upcoming || [];
  const r = await api('/api/upcoming');
  state.catalog.upcoming = r.upcoming || [];
  state.catalog.upcomingLoaded = true;
  return state.catalog.upcoming;
}

function notifyLabel(on) { return t(on ? 'bvAdd.notifying' : 'bvAdd.notifyMe'); }

function rowHTML(u, wish, signedIn) {
  const num = String(u.set_num || '');
  const on = wish.has(num);
  const meta = [num.replace(/-\d+$/, ''), u.theme, u.availability || t('bvCommon.comingSoon')].filter(Boolean).join(' · ');
  return `<div class="bv-setrow bv-comingsoon__row" data-cs-open="${escapeHtml(num)}" role="link" tabindex="0">
      ${setThumb(u)}
      <span class="bv-setrow__body"><span class="bv-setrow__name">${escapeHtml(String(u.name || num))}</span><span class="bv-setrow__meta">${escapeHtml(meta)}</span></span>
      <span class="bv-setrow__end bv-comingsoon__end">${u.price_usd ? `<span class="bv-setrow__value">${escapeHtml(money0(u.price_usd))}</span>` : ''}
        ${signedIn ? `<button type="button" class="bv-iconbtn bv-notify" data-cs-wish="${escapeHtml(num)}" data-cs-name="${escapeHtml(String(u.name || ''))}" aria-pressed="${on}" aria-label="${escapeHtml(notifyLabel(on))}" title="${escapeHtml(notifyLabel(on))}">${icon('bell', { size: 20 })}</button>` : ''}</span>
    </div>`;
}

function pageHTML(inner) {
  return `<main class="bv-page bv-retiring bv-upcoming" id="upcomingPage">
      ${topbar({ title: t('bvCommon.comingSoon'), sub: t('bvAdd.upcomingSub'), back: 'history' })}
      ${inner}
    </main>`;
}

function listHTML(list) {
  if (!list.length) return emptyState({ icon: 'bell', title: t('bvAdd.noUpcoming') });
  const wish = new Set((state.wishlist || []).map((w) => w.set_num));
  const signedIn = !!getSessionUserId();
  return `<div class="bv-group__box bv-gap" id="comingSoonList">${list.map((u) => rowHTML(u, wish, signedIn)).join('')}</div>`;
}

// Bell = wishlist the upcoming set (on) or drop it (off).
async function toggleNotify(btn) {
  const setNum = btn.dataset.csWish;
  const isOn = btn.getAttribute('aria-pressed') === 'true';
  haptic('light');
  try {
    if (isOn) {
      await api(`/api/wishlist/by-set/${encodeURIComponent(setNum)}`, { method: 'DELETE' });
      if (state.wishlist) state.wishlist = state.wishlist.filter((w) => w.set_num !== setNum);
    } else {
      await api('/api/wishlist', { method: 'POST', body: { set_num: setNum, name: btn.dataset.csName } });
      if (state.wishlist) state.wishlist.push({ set_num: setNum, name: btn.dataset.csName });
    }
    btn.setAttribute('aria-pressed', String(!isOn));
    btn.setAttribute('aria-label', notifyLabel(!isOn));
    btn.title = notifyLabel(!isOn);
  } catch (err) {
    toast(err.message || t('common.actionFailed'), 'error');
  }
}

function wire(page) {
  if (!page || page._csWired) return;
  page._csWired = true;
  page.addEventListener('click', (e) => {
    const bell = e.target.closest('[data-cs-wish]');
    if (bell) { e.stopPropagation(); toggleNotify(bell); return; }
    const row = e.target.closest('[data-cs-open]');
    if (row) location.hash = `#/set/${encodeURIComponent(row.dataset.csOpen)}`;
  });
  page.addEventListener('keydown', (e) => {
    const row = e.target.closest?.('[data-cs-open]');
    if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); row.click(); }
  });
}

function failedHTML() {
  return emptyState({
    icon: 'cloudOff',
    title: t('bvFirst.errorTitle'),
    body: t('bvFirst.errorBody'),
    actionsHtml: btn(t('bvFirst.retry'), { id: 'upcomingRetry', icon: 'refresh' }),
  });
}

export async function renderUpcoming() {
  const root = $('#root');
  if (!root) return;
  const gen = ++_gen;
  const cached = state.catalog.upcomingLoaded;
  root.innerHTML = pageHTML(cached ? listHTML(state.catalog.upcoming || []) : `<div class="bv-group__box bv-gap">${skeletonRows(4)}</div>`);
  wire($('#upcomingPage'));
  if (cached) return;
  let list = null;
  try { list = await loadUpcoming(); } catch { /* shown as a retryable error below */ }
  if (gen !== _gen || !location.hash.startsWith('#/upcoming')) return;
  root.innerHTML = pageHTML(list ? listHTML(list) : failedHTML());
  wire($('#upcomingPage'));
  $('#upcomingRetry')?.addEventListener('click', () => { haptic('light'); renderUpcoming(); });
}
