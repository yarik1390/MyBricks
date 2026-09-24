// Wishlist (#/wishlist) — 2026 redesign. Sets you want, how far each is from
// the price you'd pay, and an alert card when one gets there. Tapping a row
// opens its price alert sheet (target, quick chips, per-set switches); the
// alert card offers Dismiss / I bought it / Offers. Every action stays on this
// screen with a snackbar + Undo.
import { $, $$, haptic, escapeHtml, toast, snackbar, bricklinkBuyURL, bvIDB, celebrate, mount, capturedMoneyContext, CURRENCY_SYMBOLS } from '../utils.js';
import { state, invalidatePortfolio } from '../state.js';
import { api, getSessionUserId, outboxEnqueue } from '../api.js';
import { buyWindow, withDisplayValue } from '../lib/pure.js';
import { amazonSlotHTML, hydrateAmazonSlots } from '../lib/amazon-affiliate.js';
import { localMoneyToUsd, usdMoneyInputValue } from '../lib/money-input.js';
// refreshNavBadge is shared with the vault view, so it stays in portfolio.js
// (the only back-import; portfolio.js never imports this module).
import { refreshNavBadge } from './portfolio.js';
import { t, tPlural } from '../lib/i18n.js';
import { topbar, iconBtn, icon, btn, pill, bar, toggle, field, row, emptyState, sheetBody, skeletonRows } from '../ui/kit.js';
import { setThumb, money0 } from '../ui/set-ui.js';
import { setPageFab } from '../components/collector-shell.js';
import { showSheet, hideSheet } from '../components/sheet.js';

const SEEN_DROPS_KEY = 'bv_seen_drop_alerts';
const SORT_KEY = 'bv_wl_sort';
const SORTS = [['recent', 'bvAlerts.sortRecent'], ['gap', 'bvAlerts.sortGap'], ['value', 'bvAlerts.sortValue'], ['name', 'bvAlerts.sortName']];
// Alert kinds that belong to wishlisted sets; the rest (spikes, sell targets)
// live in the Vault's What changed feed.
const WISH_ALERTS = new Set(['drop', 'deal', 'preorder', 'retiring']);
const onWishlist = () => location.hash.split('?')[0] === '#/wishlist';

// Fire the celebration once per never-before-seen price-drop alert. Seen ids
// persist (capped) so revisiting doesn't re-celebrate.
function celebrateNewDropAlerts(dropAlerts) {
  if (!dropAlerts?.length) return;
  let seen;
  try { seen = new Set(JSON.parse(localStorage.getItem(SEEN_DROPS_KEY) || '[]')); }
  catch { seen = new Set(); }
  const fresh = dropAlerts.filter(a => a.id != null && !seen.has(String(a.id)));
  if (fresh.length) {
    const n = fresh.length;
    const msg = tPlural('bvAlerts.targetsHit', n, { count: n });
    const quip = n > 1 ? t('bvAlerts.targetsHitQuip') : t('bvAlerts.targetHitQuip', { name: fresh[0].set_name || fresh[0].set_num });
    setTimeout(() => celebrate(msg, { quip, hue: 150 }), 400);
  }
  for (const a of dropAlerts) if (a.id != null) seen.add(String(a.id));
  try { localStorage.setItem(SEEN_DROPS_KEY, JSON.stringify([...seen].slice(-200))); } catch {}
}

const alertKind = (a) => a.alert_type || 'drop';
const itemFor = (setNum) => (state.wishlist || []).find(w => w.set_num === setNum);
const sortPref = () => { try { return localStorage.getItem(SORT_KEY) || 'recent'; } catch { return 'recent'; } };

function sortedItems() {
  const sort = sortPref();
  const items = (state.wishlist || []).map(withDisplayValue);
  const gapOf = w => (Number(w.target_price) > 0 && Number(w.current_value) > 0) ? (w.current_value - w.target_price) / w.target_price : Infinity;
  if (sort === 'gap') items.sort((a, b) => gapOf(a) - gapOf(b));
  else if (sort === 'value') items.sort((a, b) => (b.current_value || 0) - (a.current_value || 0));
  else if (sort === 'name') items.sort((a, b) => String(a.name || a.set_num).localeCompare(String(b.name || b.set_num)));
  return items; // "recent" keeps API order (added_at desc)
}

// ---------------------------------------------------------------- alert card
function alertCopy(a) {
  const name = a.set_name || itemFor(a.set_num)?.name || a.set_num;
  const kind = alertKind(a);
  const now = Number(itemFor(a.set_num) ? withDisplayValue(itemFor(a.set_num)).current_value : a.current_value) || Number(a.current_value) || 0;
  if (kind === 'deal') return { title: t('bvAlerts.alertDealTitle', { name }), sub: t('bvAlerts.alertDealSub') };
  if (kind === 'preorder') return { title: t('bvAlerts.alertStockTitle', { name }), sub: t('bvAlerts.alertStockSub') };
  if (kind === 'retiring') return { title: t('bvAlerts.alertRetiringTitle', { name }), sub: t('bvAlerts.alertRetiringSub') };
  const target = Number(a.target_price) || 0;
  const price = Number(a.current_value) || now;
  return {
    title: t('bvAlerts.alertDropTitle', { name, price: money0(price) }),
    sub: t(price < target ? 'bvAlerts.alertDropBelow' : 'bvAlerts.alertDropAt', { target: money0(target) }),
  };
}

function alertCardHTML(a) {
  const { title, sub } = alertCopy(a);
  const owned = state.ownedSetNums?.has?.(a.set_num);
  return `<section class="bv-wlalert" aria-label="${escapeHtml(t('bvAlerts.alertLabel'))}" data-alert-id="${escapeHtml(String(a.id ?? ''))}" data-set="${escapeHtml(a.set_num)}">
      <div class="bv-wlalert__head">${icon('bell', { size: 22 })}<div class="bv-wlalert__text"><span class="bv-wlalert__title">${escapeHtml(title)}</span><span class="bv-wlalert__sub">${escapeHtml(sub)}</span></div></div>
      <div class="bv-wlalert__acts">
        <button type="button" class="bv-wlalert__btn" data-wl-dismiss="${escapeHtml(String(a.id ?? ''))}">${escapeHtml(t('bvAlerts.dismiss'))}</button>
        ${owned ? '' : `<button type="button" class="bv-wlalert__btn bv-wlalert__btn--soft" data-wl-bought="${escapeHtml(a.set_num)}">${icon('check', { size: 16, stroke: 2.4 })}<span>${escapeHtml(t('bvAlerts.boughtIt'))}</span></button>`}
        <a class="bv-wlalert__btn bv-wlalert__btn--ink" href="${escapeHtml(bricklinkBuyURL(a.set_num))}" target="_blank" rel="noopener" aria-label="${escapeHtml(t('bvAlerts.offersFor', { name: a.set_name || a.set_num }))}"><span>${escapeHtml(t('bvAlerts.offers'))}</span>${icon('ext', { size: 16 })}</a>
      </div>
    </section>`;
}

// -------------------------------------------------------------------- rows
function bwLabel(w) {
  const bw = buyWindow(w);
  if (!bw || Number(w.current_value) <= Number(w.target_price)) return '';
  if (bw.state === 'near') return t('bvAlerts.bwNear');
  if (bw.state === 'approaching') return tPlural('bvAlerts.bwWeeks', bw.weeks, { count: bw.weeks });
  return t('bvAlerts.bwAway');
}

function rowTagsHTML(w) {
  const tags = [];
  if (w.lego_availability === 'pre_order') tags.push(pill(t('bvAlerts.tagPreorder'), 'info'));
  else if (w.lego_availability === 'coming_soon') tags.push(pill(t('bvAlerts.tagComingSoon'), 'info'));
  else if (w.lego_availability === 'back_order') tags.push(pill(t('bvAlerts.tagBackOrder')));
  if (!w.retired && (Number(w.lego_retiring_soon) === 1 || w.lego_retiring_soon === true || Number(w.retirement_risk_score) >= 70)) tags.push(pill(t('bvAlerts.tagRetiring'), 'loss', { icon: 'clock' }));
  const bw = bwLabel(w);
  if (bw) tags.push(`<span class="bv-wlrow__hint">${escapeHtml(bw)}</span>`);
  return tags.length ? `<span class="bv-wlrow__tags">${tags.join('')}</span>` : '';
}

function wishRowHTML(w) {
  const now = Number(w.current_value) || 0;
  const target = Number(w.target_price) || 0;
  const hit = target > 0 && now > 0 && now <= target;
  const pct = hit ? 100 : (target > 0 && now > 0 ? Math.max(8, Math.min(100, (target / now) * 100)) : 0);
  const name = w.name || w.set_num;
  const status = !target
    ? `<span class="bv-wlrow__lbl">${escapeHtml(t('bvAlerts.noTarget'))}</span><span class="bv-wlrow__set">${escapeHtml(t('bvAlerts.setTarget'))}</span>`
    : `${hit ? `<span class="bv-wlrow__hit">${escapeHtml(t('bvAlerts.atTarget'))}</span>` : `<span class="bv-wlrow__lbl">${escapeHtml(t('bvAlerts.toGo', { amount: money0(now - target) }))}</span>`}<span class="bv-wlrow__lbl">${escapeHtml(t('bvAlerts.target', { price: money0(target) }))}</span>`;
  return `<button type="button" class="bv-wlrow${hit ? ' is-hit' : ''}" data-wl-set="${escapeHtml(w.set_num)}" aria-label="${escapeHtml(t('bvAlerts.rowLabel', { name }))}">
      ${setThumb(w, { size: 52 })}
      <span class="bv-wlrow__body">
        <span class="bv-wlrow__top"><span class="bv-wlrow__name">${escapeHtml(name)}</span><span class="bv-wlrow__value">${escapeHtml(now > 0 ? money0(now) : '—')}</span></span>
        ${target ? bar(pct, { label: t('bvAlerts.progressLabel', { price: money0(target) }) }) : ''}
        <span class="bv-wlrow__foot">${status}</span>
        ${rowTagsHTML(w)}
      </span>
    </button>`;
}

// ------------------------------------------------------------------ screen
function pageHTML({ loading = false } = {}) {
  const items = sortedItems();
  const alerts = (state.wishlistAlerts || []).filter(a => WISH_ALERTS.has(alertKind(a)));
  const others = (state.wishlistAlerts || []).length - alerts.length;
  const cards = alerts.slice(0, 2).map(alertCardHTML).join('');
  const more = Math.max(0, alerts.length - 2) + others;
  const actions = iconBtn({ icon: 'sort', label: t('bvAlerts.sortBy', { sort: t(SORTS.find(([k]) => k === sortPref())?.[1] || 'bvAlerts.sortRecent') }), id: 'wlSortBtn' })
    + iconBtn({ icon: 'more', label: t('bvAlerts.moreOptions'), id: 'wlMoreBtn' });
  const sub = items.length ? tPlural('bvAlerts.setsSub', items.length, { count: items.length }) : t('bvAlerts.emptySub');
  let body;
  if (loading) body = `<div class="bv-wllist" aria-busy="true">${skeletonRows(3)}</div>`;
  else if (!items.length) {
    body = emptyState({
      icon: 'heart',
      title: t('bvAlerts.emptyTitle'),
      body: t('bvAlerts.emptyBody'),
      actionsHtml: btn(t('bvAlerts.browse'), { href: '#/add', icon: 'search', full: true }) + btn(t('bvAlerts.scan'), { href: '#/pile', icon: 'scan', kind: 'tonal', full: true }),
    });
  } else {
    body = `<div class="bv-wllist">${items.map(wishRowHTML).join('')}</div>`;
  }
  return `<main class="bv-page has-fab bv-wishlist" id="wishlistPage">
      ${topbar({ title: t('bvAlerts.wishlist'), sub, actionsHtml: actions })}
      ${cards}
      ${more > 0 ? `<a class="bv-wlmore" href="#/changes">${icon('bell', { size: 18 })}<span>${escapeHtml(tPlural('bvAlerts.moreUpdates', more, { count: more }))}</span>${icon('chev', { size: 18 })}</a>` : ''}
      ${body}
    </main>`;
}

function paint(opts) {
  const root = $('#root');
  if (!root || !onWishlist()) return;
  mount(root, pageHTML(opts));
  const page = $('#wishlistPage');
  if (page && !page._wlWired) { page._wlWired = true; page.addEventListener('click', onPageClick); }
}

export async function renderWishlist() {
  setPageFab({ label: t('bvAlerts.add'), icon: 'plus', href: '#/add' });
  const cached = Array.isArray(state.wishlist) && state.wishlist.length;
  paint({ loading: !cached });
  try {
    const wl = await api('/api/wishlist');
    const cutoff = Date.now() - 15000;
    for (const [setNum, ts] of Object.entries(state.recentWishlistDeletes || {})) {
      if (ts < cutoff) delete state.recentWishlistDeletes[setNum];
    }
    state.wishlist = (wl.wishlist || []).filter(w => !state.recentWishlistDeletes?.[w.set_num]);
    state.wishlistAlerts = wl.unread_alerts || [];
    bvIDB.set('wishlist', { data: { wishlist: state.wishlist, alerts: state.wishlistAlerts }, ts: Date.now(), userId: getSessionUserId() }).catch(() => {});
  } catch (_e) {
    // Offline: render whatever hydrateFromIDB restored rather than erroring out.
    if (!navigator.onLine) toast(state.wishlist?.length ? t('bvAlerts.offlineCached') : t('bvAlerts.offlineEmpty'), 'info');
    else toast(t('bvAlerts.loadFailed'), 'error');
  }
  if (!onWishlist()) return;
  refreshNavBadge();
  paint();
  // A wishlisted set reaching its target is a real win — celebrate the first
  // time each drop alert is seen.
  celebrateNewDropAlerts((state.wishlistAlerts || []).filter(a => alertKind(a) === 'drop'));
  // Deep link from a push notification: #/wishlist?alert=<set_num>.
  const deep = new URLSearchParams(location.hash.split('?')[1] || '').get('alert');
  if (deep && itemFor(deep)) openPriceAlert(deep);
}

function onPageClick(e) {
  const el = e.target.closest('[data-wl-set], [data-wl-dismiss], [data-wl-bought], #wlSortBtn, #wlMoreBtn');
  if (!el) return;
  if (el.id === 'wlSortBtn') return openSortSheet();
  if (el.id === 'wlMoreBtn') return openMoreSheet();
  if (el.dataset.wlSet) { haptic('light'); return openPriceAlert(el.dataset.wlSet); }
  if (el.dataset.wlDismiss !== undefined) return dismissAlert(el.closest('.bv-wlalert'));
  if (el.dataset.wlBought) return boughtIt(el.dataset.wlBought, el.closest('.bv-wlalert'));
}

// ---------------------------------------------------------------- actions
async function markAlertsRead(ids) {
  const set = new Set(ids.map(String));
  state.wishlistAlerts = (state.wishlistAlerts || []).filter(a => !set.has(String(a.id)));
  refreshNavBadge();
  await Promise.all(ids.map(id => api(`/api/wishlist/${encodeURIComponent(id)}`, { method: 'POST' }).catch(() => {})));
}

async function dismissAlert(card) {
  if (!card) return;
  if (!navigator.onLine) { toast(t('bvAlerts.offlineMarkRead'), 'info'); return; }
  haptic('light');
  const id = card.dataset.alertId;
  const item = itemFor(card.dataset.set);
  if (id) await markAlertsRead([id]);
  // Dismissing a target hit also acknowledges the row, as the old ✓ did.
  if (item?.id != null && Number(item.target_price) > 0 && Number(withDisplayValue(item).current_value) <= Number(item.target_price) && !item.acknowledged_at) {
    item.acknowledged_at = new Date().toISOString();
    api(`/api/wishlist/${encodeURIComponent(item.id)}/acknowledge-alert`, { method: 'POST' }).catch(() => {});
  }
  paint();
}

// "I bought it": move the set into the vault at the alert price, off the
// wishlist, in one step — Undo puts both back.
async function boughtIt(setNum, card) {
  const item = itemFor(setNum);
  if (!item) return;
  const alertRow = (state.wishlistAlerts || []).find(a => a.set_num === setNum);
  const price = Number(alertRow?.current_value) || Number(withDisplayValue(item).current_value) || 0;
  const name = item.name || setNum;
  haptic('medium');
  state.wishlist = state.wishlist.filter(w => w.set_num !== setNum);
  state.recentWishlistDeletes[setNum] = Date.now();
  if (card?.dataset.alertId) markAlertsRead([card.dataset.alertId]);
  paint();
  const body = { set_num: setNum, quantity: 1, ...(price > 0 ? { purchase_price: Math.round(price * 100) / 100 } : {}) };
  let collectionId = null;
  try {
    const res = await api('/api/collection', { method: 'POST', body });
    collectionId = res?.item?.id ?? null;
    if (item.id != null) await api(`/api/wishlist/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
  } catch (err) {
    if (!navigator.onLine) {
      outboxEnqueue({ path: '/api/collection', method: 'POST', body });
      if (item.id != null) outboxEnqueue({ path: `/api/wishlist/${encodeURIComponent(item.id)}`, method: 'DELETE' });
    } else {
      state.wishlist = [item, ...state.wishlist];
      delete state.recentWishlistDeletes[setNum];
      paint();
      toast(t('common.errorWithDetails', { error: err.message || err }), 'error');
      return;
    }
  }
  state.ownedSetNums?.add?.(setNum);
  invalidatePortfolio();
  snackbar(t('bvAlerts.movedToVault', { name }), {
    type: 'success',
    duration: 7000,
    actions: [
      { label: t('bvAlerts.editPrice'), onClick: () => { location.hash = `#/set/${encodeURIComponent(setNum)}/edit`; } },
      ...(collectionId != null ? [{ label: t('common.undo'), kind: 'undo', onClick: async () => {
        try {
          await api(`/api/collection/${encodeURIComponent(collectionId)}`, { method: 'DELETE' });
          await api('/api/wishlist', { method: 'POST', body: { set_num: setNum, target_price: Number(item.target_price) > 0 ? Number(item.target_price) : null } });
          state.ownedSetNums?.delete?.(setNum);
          delete state.recentWishlistDeletes[setNum];
          invalidatePortfolio();
          if (onWishlist()) renderWishlist();
        } catch { toast(t('common.actionFailed'), 'error'); }
      } }] : []),
    ],
  });
}

function openSortSheet() {
  const current = sortPref();
  showSheet(sheetBody({
    title: t('bvAlerts.sortTitle'),
    inner: `<div class="bv-group__box">${SORTS.map(([key, label]) => `<button type="button" class="bv-row bv-sortrow" data-wl-sort="${key}" aria-pressed="${current === key}"><span class="bv-row__text"><span class="bv-row__title">${escapeHtml(t(label))}</span></span><span class="bv-row__trail">${current === key ? icon('check', { size: 20 }) : ''}</span></button>`).join('')}</div>`,
  }));
  $$('#sheet [data-wl-sort]').forEach(b => b.addEventListener('click', () => {
    try { localStorage.setItem(SORT_KEY, b.dataset.wlSort); } catch {}
    haptic('light');
    hideSheet();
    paint();
  }));
}

function openMoreSheet() {
  const totalAlerts = (state.wishlistAlerts || []).length;
  showSheet(sheetBody({
    title: t('bvAlerts.wishlist'),
    inner: `<div class="bv-group__box">
        ${totalAlerts ? row({ icon: 'check', title: t('bvAlerts.markAllRead'), sub: tPlural('wishlist.unreadAlerts', totalAlerts), id: 'wlMarkAllRead', chevron: false }) : ''}
        ${row({ icon: 'bell', title: t('bvAlerts.notificationSettings'), href: '#/me/notifications', id: 'wlNotifSettings' })}
        ${row({ icon: 'clock', title: t('bvAlerts.retiringSoon'), href: '#/retiring' })}
        ${row({ icon: 'search', title: t('bvAlerts.browse'), href: '#/add' })}
      </div>`,
  }));
  $$('#sheet a.bv-row').forEach(a => a.addEventListener('click', () => hideSheet()));
  $('#wlMarkAllRead')?.addEventListener('click', async () => {
    haptic('medium');
    // Offline the POSTs can't land — clearing the list would just "un-clear"
    // on the next load with no explanation. Be honest instead of optimistic.
    if (!navigator.onLine) { toast(t('bvAlerts.offlineMarkRead'), 'info'); return; }
    hideSheet();
    await markAlertsRead((state.wishlistAlerts || []).map(a => a.id).filter(id => id != null));
    paint();
  });
}

// --------------------------------------------------------- price alert sheet
export function openPriceAlert(setNum) {
  const raw = itemFor(setNum);
  if (!raw) return;
  const w = withDisplayValue(raw);
  const ctx = capturedMoneyContext();
  const symbol = CURRENCY_SYMBOLS[ctx.currency] || '$';
  const now = Number(w.current_value) || 0;
  const low = Number(w.blended_low || w.market_value_low) || 0;
  const high = Number(w.blended_high || w.market_value_high) || 0;
  const rrp = Number(w.retail_price) || 0;
  const name = w.name || w.set_num;
  const chips = [
    now > 0 ? { usd: Math.round(now * 0.95), label: t('bvAlerts.chipPct', { pct: 5, price: money0(now * 0.95) }) } : null,
    now > 0 ? { usd: Math.round(now * 0.9), label: t('bvAlerts.chipPct', { pct: 10, price: money0(now * 0.9) }) } : null,
    low > 0 && low < now ? { usd: Math.round(low), label: t('bvAlerts.chipLow', { price: money0(low) }) } : null,
    rrp > 0 ? { usd: rrp, label: t('bvAlerts.chipRrp', { price: money0(rrp) }) } : null,
  ].filter(Boolean).slice(0, 3);
  const meta = now > 0
    ? (low > 0 && high > low ? t('bvAlerts.nowRange', { price: money0(now), low: money0(low), high: money0(high) }) : t('bvAlerts.nowOnly', { price: money0(now) }))
    : t('bvAlerts.noPrice');
  const sw = (id, key, label) => `<div class="bv-alertsw"><span class="bv-alertsw__label" id="${id}-l">${escapeHtml(t(label))}</span>${toggle({ id, on: raw[key] !== 0 && raw[key] !== false, label: t(label) })}</div>`;
  showSheet(sheetBody({
    title: t('bvAlerts.priceAlert'),
    id: 'priceAlertSheet',
    inner: `<form class="bv-form bv-pricealert" id="priceAlertForm" novalidate>
        <a class="bv-pricealert__set" href="#/set/${encodeURIComponent(w.set_num)}" id="paOpenSet">${setThumb(w, { size: 48 })}<span class="bv-pricealert__text"><span class="bv-pricealert__name">${escapeHtml(name)}</span><span class="bv-pricealert__meta">${escapeHtml(meta)}</span></span>${icon('chev', { size: 20 })}</a>
        ${field({ id: 'paTarget', label: t('bvAlerts.targetPrice'), value: Number(w.target_price) > 0 ? usdMoneyInputValue(w.target_price, ctx) : '', placeholder: chips[1] ? usdMoneyInputValue(chips[1].usd, ctx) : '', mono: true, prefix: symbol, inputmode: 'decimal', autocomplete: 'off' })}
        ${chips.length ? `<div class="bv-chips bv-chips--wrap">${chips.map(c => `<button type="button" class="bv-chip" data-pa-price="${escapeHtml(usdMoneyInputValue(c.usd, ctx))}">${escapeHtml(c.label)}</button>`).join('')}</div>` : ''}
        <div class="bv-alertsws">
          ${sw('paNotifyTarget', 'notify_target', 'bvAlerts.tgTarget')}
          ${sw('paNotifyRetiring', 'notify_retiring', 'bvAlerts.tgRetiring')}
          ${sw('paNotifyStock', 'notify_stock', 'bvAlerts.tgStock')}
        </div>
        <div class="bv-pricealert__buy"><a class="bv-btn bv-btn--outline bv-btn--sm" href="${escapeHtml(bricklinkBuyURL(w.set_num))}" target="_blank" rel="noopener">${escapeHtml(t('bvAlerts.bricklink'))}${icon('ext', { size: 16 })}</a>${amazonSlotHTML(w.set_num, { compact: true })}</div>
        <button type="submit" class="bv-btn bv-btn--primary bv-btn--full bv-btn--lg" id="paSave">${escapeHtml(t('common.save'))}</button>
        <button type="button" class="bv-btn bv-btn--danger bv-btn--full" id="paRemove">${escapeHtml(t('bvAlerts.removeFromWishlist'))}</button>
      </form>`,
  }));
  hydrateAmazonSlots($('#sheet'), state.me?.retail_market || 'FR');
  $('#paOpenSet')?.addEventListener('click', () => hideSheet());
  $$('#sheet [data-pa-price]').forEach(b => b.addEventListener('click', () => {
    $('#paTarget').value = b.dataset.paPrice;
    $$('#sheet [data-pa-price]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    haptic('light');
  }));
  $$('#sheet .bv-toggle').forEach(tg => tg.addEventListener('click', () => {
    tg.setAttribute('aria-checked', String(tg.getAttribute('aria-checked') !== 'true'));
    haptic('light');
  }));
  $('#paRemove')?.addEventListener('click', () => { hideSheet(); removeFromWishlist(raw); });
  $('#priceAlertForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const parsed = localMoneyToUsd($('#paTarget').value, ctx, { positive: true });
    if (!parsed.valid) { toast(t('bvAlerts.targetInvalid'), 'error'); $('#paTarget').focus(); return; }
    const on = (id) => $(`#${id}`)?.getAttribute('aria-checked') === 'true';
    const patch = {
      target_price: parsed.blank ? null : Math.round(parsed.usd * 100) / 100,
      notify_target: on('paNotifyTarget'),
      notify_retiring: on('paNotifyRetiring'),
      notify_stock: on('paNotifyStock'),
    };
    await savePriceAlert(raw, patch);
  });
}

async function savePriceAlert(item, patch) {
  const before = { target_price: item.target_price, notify_target: item.notify_target, notify_retiring: item.notify_retiring, notify_stock: item.notify_stock, acknowledged_at: item.acknowledged_at };
  // Optimistic: the row updates as the sheet closes.
  Object.assign(item, {
    target_price: patch.target_price,
    notify_target: patch.notify_target ? 1 : 0,
    notify_retiring: patch.notify_retiring ? 1 : 0,
    notify_stock: patch.notify_stock ? 1 : 0,
    ...(patch.target_price !== before.target_price ? { acknowledged_at: null } : {}),
  });
  hideSheet();
  paint();
  haptic('medium');
  const path = `/api/wishlist/${encodeURIComponent(item.id)}`;
  try {
    await api(path, { method: 'PATCH', body: patch });
    toast(t('bvAlerts.alertSaved'), 'success');
  } catch (err) {
    if (!navigator.onLine) {
      outboxEnqueue({ path, method: 'PATCH', body: patch });
      toast(t('bvAlerts.savedOffline'), 'info');
      return;
    }
    Object.assign(item, before);
    paint();
    toast(t('common.errorWithDetails', { error: err.message || err }), 'error');
  }
}

async function removeFromWishlist(item) {
  const name = item.name || item.set_num;
  state.wishlist = state.wishlist.filter(w => w !== item);
  state.recentWishlistDeletes[item.set_num] = Date.now();
  paint();
  haptic('medium');
  let removed = false;
  try {
    await api(`/api/wishlist/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    removed = true;
  } catch (err) {
    if (!navigator.onLine) {
      outboxEnqueue({ path: `/api/wishlist/${encodeURIComponent(item.id)}`, method: 'DELETE' });
      removed = true;
    } else {
      state.wishlist = [item, ...state.wishlist];
      delete state.recentWishlistDeletes[item.set_num];
      paint();
      toast(t('common.errorWithDetails', { error: err.message || err }), 'error');
    }
  }
  if (!removed) return;
  snackbar(t('bvAlerts.removed', { name }), {
    actions: [{ label: t('common.undo'), kind: 'undo', onClick: async () => {
      try {
        await api('/api/wishlist', { method: 'POST', body: { set_num: item.set_num, target_price: Number(item.target_price) > 0 ? Number(item.target_price) : null, notes: item.notes || null } });
        delete state.recentWishlistDeletes[item.set_num];
        if (onWishlist()) renderWishlist();
      } catch { toast(t('common.actionFailed'), 'error'); }
    } }],
  });
}
