// Promotions calendar (#/promos): LEGO gifts with purchase, double Insiders
// points weeks and sales, on now and coming up. Read daily from LEGO.com
// (worker/src/jobs/promotions-refresh.ts); the admin can add, fix or hide an
// entry here. Data: GET /api/promotions (+ /admin for the admin).
import { $, $$, escapeHtml, fmtMoney, toast, haptic, proxyImg } from '../utils.js';
import { state } from '../state.js';
import { api } from '../api.js';
import { t } from '../lib/i18n.js';
import { topbar, btn, pill, field, sheetBody, emptyState, skeletonRows } from '../ui/kit.js';
import { showSheet, hideSheet } from '../components/sheet.js';

const onScreen = () => location.hash.split('?')[0] === '#/promos';
const KINDS = [
  ['gwp', 'Gift with purchase'],
  ['double_points', 'Double Insiders points'],
  ['sale', 'Sale'],
  ['other', 'Other'],
];
const kindLabel = (k) => (KINDS.find(([v]) => v === k) || KINDS[3])[1];
const kindTone = (k) => (k === 'gwp' ? 'acc' : k === 'double_points' ? 'info' : 'neutral');

function fmtDay(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function whenText(p, upcoming) {
  if (upcoming) return p.ends_on ? t('promos.fromTo', { start: fmtDay(p.starts_on), end: fmtDay(p.ends_on) }) : t('promos.starts', { date: fmtDay(p.starts_on) });
  return p.ends_on ? t('promos.until', { date: fmtDay(p.ends_on) }) : t('promos.whileItLasts');
}

function promoHTML(p, { upcoming = false, admin = false } = {}) {
  const meta = [whenText(p, upcoming), p.min_spend ? t('promos.spend', { amount: fmtMoney(p.min_spend, { cents: 0 }) }) : ''].filter(Boolean).join(' · ');
  const gift = p.gift_set_num
    ? `<a class="bv-promo__gift" href="#/set/${encodeURIComponent(p.gift_set_num)}">
        ${p.gift_image ? `<img src="${escapeHtml(proxyImg(p.gift_image))}" alt="" loading="lazy" decoding="async">` : ''}
        <span>${escapeHtml(p.gift_name || p.gift_set_num)}</span></a>`
    : '';
  return `<li class="bv-promo${Number(p.hidden) ? ' is-hidden' : ''}" data-promo="${Number(p.id)}">
    <div class="bv-promo__head">${pill(kindLabel(p.kind), kindTone(p.kind))}${Number(p.hidden) ? pill('Hidden', 'neutral') : ''}</div>
    <h3 class="bv-promo__title">${escapeHtml(p.title)}</h3>
    ${meta ? `<p class="bv-promo__meta">${escapeHtml(meta)}</p>` : ''}
    ${p.details ? `<p class="bv-promo__details">${escapeHtml(p.details)}</p>` : ''}
    ${gift}
    <div class="bv-promo__actions">
      ${p.url ? `<a class="bv-btn bv-btn--text bv-btn--sm" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">Details</a>` : ''}
      ${admin ? `<button type="button" class="bv-btn bv-btn--text bv-btn--sm" data-promo-edit>Edit</button>
        <button type="button" class="bv-btn bv-btn--text bv-btn--sm" data-promo-hide>${Number(p.hidden) ? 'Show' : 'Hide'}</button>` : ''}
    </div>
  </li>`;
}

function editSheet(p, onSaved) {
  const v = (x) => (x == null ? '' : String(x));
  showSheet(sheetBody({
    title: p ? 'Edit promotion' : 'Add a promotion',
    inner: `<form id="promoForm" class="bv-promoform" novalidate>
      ${field({ id: 'pTitle', label: 'Title', value: v(p?.title) })}
      <label class="bv-field"><span class="bv-field__label">Type</span>
        <select id="pKind" class="bv-field__input">${KINDS.map(([k, l]) => `<option value="${k}"${(p?.kind || 'gwp') === k ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select></label>
      ${field({ id: 'pStart', label: 'Starts', type: 'date', value: v(p?.starts_on) })}
      ${field({ id: 'pEnd', label: 'Ends', type: 'date', value: v(p?.ends_on) })}
      ${field({ id: 'pSpend', label: 'Minimum spend (USD)', type: 'number', value: v(p?.min_spend) })}
      ${field({ id: 'pGift', label: 'Gift set number', value: v(p?.gift_set_num), placeholder: '40573' })}
      ${field({ id: 'pDetails', label: 'Details', value: v(p?.details) })}
      ${field({ id: 'pUrl', label: 'Link', type: 'url', value: v(p?.url) })}
      ${btn('Save', { type: 'submit', full: true, id: 'pSave' })}
    </form>`,
  }));
  $('#promoForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      title: $('#pTitle').value, kind: $('#pKind').value, starts_on: $('#pStart').value || null, ends_on: $('#pEnd').value || null,
      min_spend: $('#pSpend').value ? Number($('#pSpend').value) : null, gift_set_num: $('#pGift').value || null,
      details: $('#pDetails').value || null, url: $('#pUrl').value || null,
    };
    try {
      await api(p ? `/api/promotions/admin/${p.id}` : '/api/promotions/admin', { method: p ? 'PATCH' : 'POST', body });
      hideSheet();
      toast('Saved', 'success');
      onSaved();
    } catch (err) { toast(err?.message || 'Could not save.', 'error'); }
  });
}

function paint(data, admin) {
  const root = $('#root');
  if (!root || !onScreen()) return;
  const today = new Date().toISOString().slice(0, 10);
  const all = admin ? data.promotions || [] : [...(data.now || []), ...(data.upcoming || [])];
  const now = all.filter((p) => !p.starts_on || p.starts_on <= today);
  const upcoming = all.filter((p) => p.starts_on && p.starts_on > today);
  const list = (rows, opts) => `<ul class="bv-promos__list">${rows.map((p) => promoHTML(p, { ...opts, admin })).join('')}</ul>`;
  root.innerHTML = `<main class="bv-page no-nav bv-promos" id="promosPage">
    ${topbar({ title: 'Promotions', sub: 'Gifts, double points and sales at LEGO', back: '#/me' })}
    ${admin ? `<div class="bv-promos__admin">${btn('Add a promotion', { kind: 'outline', icon: 'plus', id: 'promoAdd', full: true })}</div>` : ''}
    ${!all.length ? emptyState({ icon: 'cal', title: 'No promotions right now', body: 'We check LEGO.com every day. New gifts with purchase and double points weeks show up here.' }) : ''}
    ${now.length ? `<h2 class="bv-h2">On now</h2>${list(now, {})}` : ''}
    ${upcoming.length ? `<h2 class="bv-h2">Coming up</h2>${list(upcoming, { upcoming: true })}` : ''}
    ${all.length ? '<p class="bv-foot">US offers from LEGO.com. Check the details before you buy: stock and terms can change.</p>' : ''}
  </main>`;
  const reload = () => load();
  $('#promoAdd')?.addEventListener('click', () => editSheet(null, reload));
  $$('#promosPage [data-promo-edit]').forEach((b) => b.addEventListener('click', () => {
    const p = all.find((x) => Number(x.id) === Number(b.closest('[data-promo]')?.dataset.promo));
    if (p) editSheet(p, reload);
  }));
  $$('#promosPage [data-promo-hide]').forEach((b) => b.addEventListener('click', async () => {
    const p = all.find((x) => Number(x.id) === Number(b.closest('[data-promo]')?.dataset.promo));
    if (!p) return;
    haptic('light');
    try {
      await api(`/api/promotions/admin/${p.id}`, { method: 'PATCH', body: { hidden: !Number(p.hidden) } });
      reload();
    } catch (err) { toast(err?.message || 'Could not save.', 'error'); }
  }));
}

async function load() {
  const admin = !!state.me?.is_admin;
  try {
    paint(await api(admin ? '/api/promotions/admin' : '/api/promotions'), admin);
  } catch {
    const root = $('#root');
    if (!root || !onScreen()) return;
    root.innerHTML = `<main class="bv-page no-nav bv-promos">${topbar({ title: 'Promotions', back: '#/me' })}
      <p class="bv-foot" role="alert">Promotions could not load.</p>${btn(t('common.retry'), { icon: 'refresh', id: 'promosRetry', full: true })}</main>`;
    $('#promosRetry')?.addEventListener('click', load);
  }
}

export async function renderPromotions() {
  const root = $('#root');
  if (!root) return;
  root.innerHTML = `<main class="bv-page no-nav bv-promos" aria-busy="true">${topbar({ title: 'Promotions', back: '#/me' })}<div class="bv-group__box bv-gap">${skeletonRows(3)}</div></main>`;
  await load();
}
