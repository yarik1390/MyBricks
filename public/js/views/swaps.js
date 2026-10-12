// Swaps (#/swaps): offer vault sets for swap and get matched with collectors
// who have a set you wishlisted or want one you offer. A swap request carries
// the sets each way and a note on how to reach you; the other side accepts with
// their own note or declines. Data: /api/swaps (worker/src/routes/swaps.ts).
import { $, escapeHtml, toast, haptic, proxyImg, setBtnLoading } from '../utils.js';
import { state } from '../state.js';
import { api } from '../api.js';
import { t } from '../lib/i18n.js';
import { topbar, btn, pill, card, sheetBody, skeletonRows } from '../ui/kit.js';
import { showSheet, hideSheet, confirmSheet } from '../components/sheet.js';

const onScreen = () => location.hash.split('?')[0] === '#/swaps';
const STATUS = { pending: ['Waiting for an answer', 'info'], accepted: ['Accepted', 'gain'], declined: ['Declined', 'loss'], cancelled: ['Withdrawn', 'neutral'] };

const chipList = (sets) => `<ul class="bv-swaps__sets">${sets.map((s) => `<li>
  ${s.image_url ? `<img src="${escapeHtml(proxyImg(s.image_url))}" alt="" loading="lazy" decoding="async">` : ''}
  <span><span class="bv-num">${escapeHtml(s.set_num)}</span> ${escapeHtml(s.name || '')}</span></li>`).join('')}</ul>`;

function tradeHTML(data) {
  return card(`<h2 class="bv-h3">Up for swap</h2>
    ${data.for_trade.length
      ? `<ul class="bv-swaps__trade">${data.for_trade.map((s) => `<li><span><span class="bv-num">${escapeHtml(s.set_num)}</span> ${escapeHtml(s.name || '')}</span>
          <button type="button" class="bv-btn bv-btn--text bv-btn--sm" data-untrade="${escapeHtml(s.set_num)}" aria-label="${escapeHtml(t('swaps.stopOffering', { name: s.name || s.set_num }))}">Remove</button></li>`).join('')}</ul>`
      : '<p class="bv-field__help">Nothing offered yet. Pick sets from your vault you would swap away.</p>'}
    ${btn('Add from your vault', { kind: 'tonal', icon: 'plus', id: 'swapAddTrade', full: true })}`, { cls: 'bv-swaps__card' });
}

function matchHTML(m, i) {
  return `<li class="bv-swaps__match">
    <div class="bv-swaps__who"><a href="#/u/${encodeURIComponent(m.handle)}">${escapeHtml(m.name || m.handle)}</a>
      ${m.they_have.length && m.they_want.length ? pill('Both ways', 'gain') : ''}</div>
    ${m.they_have.length ? `<p class="bv-swaps__label">Has sets on your wishlist</p>${chipList(m.they_have)}` : ''}
    ${m.they_want.length ? `<p class="bv-swaps__label">Wants sets you offer</p>${chipList(m.they_want)}` : ''}
    ${btn('Propose a swap', { kind: 'outline', id: `swapPropose${i}`, full: true, attrs: { 'data-propose': String(i) } })}
  </li>`;
}

function requestHTML(r) {
  const [label, tone] = STATUS[r.status] || [r.status, 'neutral'];
  const incoming = r.direction === 'incoming';
  return `<li class="bv-swaps__req" data-req="${Number(r.id)}">
    <div class="bv-swaps__who">${escapeHtml(incoming ? t('swaps.from', { name: r.with_name || r.with_handle || '' }) : t('swaps.to', { name: r.with_name || r.with_handle || '' }))} ${pill(label, tone)}</div>
    ${r.i_give.length ? `<p class="bv-swaps__label">You give</p>${chipList(r.i_give)}` : ''}
    ${r.i_get.length ? `<p class="bv-swaps__label">You get</p>${chipList(r.i_get)}` : ''}
    ${r.message ? `<p class="bv-swaps__note"><span class="bv-swaps__label">${incoming ? 'Their note' : 'Your note'}</span>${escapeHtml(r.message)}</p>` : ''}
    ${r.reply ? `<p class="bv-swaps__note"><span class="bv-swaps__label">${incoming ? 'Your reply' : 'Their reply'}</span>${escapeHtml(r.reply)}</p>` : ''}
    ${r.status === 'pending' ? `<div class="bv-btn-row">${incoming
      ? `${btn('Decline', { kind: 'text', attrs: { 'data-decline': String(r.id) } })}${btn('Accept', { attrs: { 'data-accept': String(r.id) } })}`
      : btn('Withdraw', { kind: 'text', attrs: { 'data-cancel': String(r.id) } })}</div>` : ''}
  </li>`;
}

function paint(data) {
  const root = $('#root');
  if (!root || !onScreen()) return;
  const incoming = data.requests.filter((r) => r.direction === 'incoming');
  const outgoing = data.requests.filter((r) => r.direction === 'outgoing');
  root.innerHTML = `<main class="bv-page no-nav bv-swaps" id="swapsPage">
    ${topbar({ title: 'Swaps', sub: 'Trade sets with other collectors', back: '#/me' })}
    ${card(`<label class="bv-swaps__switch"><span><span class="bv-swaps__switchtitle">Open to swaps</span>
        <span class="bv-field__help">Collectors who are also open see your handle and the sets you offer when they match your wishlist. Nothing else is shared.</span></span>
        <input type="checkbox" role="switch" id="swapOpen" ${data.open ? 'checked' : ''}></label>
      ${!data.has_handle ? '<p class="bv-field__help">You need a public handle first. Set it in <a href="#/me">your profile</a>.</p>' : ''}`, { cls: 'bv-swaps__card' })}
    ${tradeHTML(data)}
    ${incoming.length ? `<h2 class="bv-h2">Requests for you</h2><ul class="bv-swaps__list">${incoming.map(requestHTML).join('')}</ul>` : ''}
    <h2 class="bv-h2">Matches</h2>
    ${!data.open
      ? '<p class="bv-field__help">Turn on Open to swaps to see matches.</p>'
      : data.matches.length
        ? `<ul class="bv-swaps__list">${data.matches.map(matchHTML).join('')}</ul>`
        : '<p class="bv-field__help">No matches yet. Add sets you would swap away and keep your wishlist up to date. We match you as more collectors join.</p>'}
    ${outgoing.length ? `<h2 class="bv-h2">Your requests</h2><ul class="bv-swaps__list">${outgoing.map(requestHTML).join('')}</ul>` : ''}
    <p class="bv-foot">BricksVault introduces you; you arrange shipping or a meetup yourselves. Only swap with people you trust.</p>
  </main>`;
  wire(data);
}

async function reload() {
  try { paint(await api('/api/swaps')); } catch (e) { toast(e?.message || 'Swaps could not load.', 'error'); }
}

function noteField(id, label) {
  return `<div class="bv-field"><label for="${id}">${escapeHtml(label)}</label><div class="bv-field__box">
    <textarea id="${id}" rows="3" maxlength="500" placeholder="${escapeHtml('e.g. email, Discord or city for a meetup')}"></textarea></div></div>`;
}

function proposeSheet(m, data) {
  const box = (name, s, checked) => `<label class="bv-swaps__pick"><input type="checkbox" name="${name}" value="${escapeHtml(s.set_num)}" ${checked ? 'checked' : ''}>
    <span><span class="bv-num">${escapeHtml(s.set_num)}</span> ${escapeHtml(s.name || '')}</span></label>`;
  const wanted = new Set(m.they_want.map((s) => s.set_num));
  showSheet(sheetBody({
    title: t('swaps.proposeTo', { name: m.name || m.handle }),
    inner: `<form id="swapForm" class="bv-form" novalidate>
      <p class="bv-swaps__label">You give</p>
      ${data.for_trade.length ? data.for_trade.map((s) => box('give', s, wanted.has(s.set_num))).join('') : '<p class="bv-field__help">You have no sets up for swap.</p>'}
      <p class="bv-swaps__label">You get</p>
      ${m.they_have.length ? m.they_have.map((s) => box('get', s, true)).join('') : '<p class="bv-field__help">They have nothing from your wishlist up for swap. You can still offer sets they want.</p>'}
      ${noteField('swapNote', 'Note: how to reach you')}
      ${btn('Send request', { type: 'submit', full: true, id: 'swapSend' })}
    </form>`,
  }));
  $('#swapForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const picked = (name) => [...document.querySelectorAll(`#swapForm input[name="${name}"]:checked`)].map((i) => i.value);
    const body = { to: m.handle, give: picked('give'), get: picked('get'), message: $('#swapNote')?.value.trim() || '' };
    if (!body.give.length && !body.get.length) { toast('Pick at least one set.', 'error'); return; }
    if (!body.message) { toast('Add a note with how to reach you.', 'error'); return; }
    const b = $('#swapSend');
    setBtnLoading(b, true);
    try {
      await api('/api/swaps/requests', { method: 'POST', body });
      hideSheet();
      haptic('medium');
      toast('Swap request sent', 'success');
      reload();
    } catch (err) { setBtnLoading(b, false); toast(err?.message || 'Could not send.', 'error'); }
  });
}

function acceptSheet(id) {
  showSheet(sheetBody({
    title: 'Accept this swap',
    inner: `<form id="swapAcceptForm" class="bv-form" novalidate>
      <p class="bv-field__help">They will see your note, so share how to reach you.</p>
      ${noteField('swapReply', 'Your note')}
      ${btn('Accept', { type: 'submit', full: true, id: 'swapAcceptBtn' })}
    </form>`,
  }));
  $('#swapAcceptForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const reply = $('#swapReply')?.value.trim() || '';
    if (!reply) { toast('Add a note with how to reach you.', 'error'); return; }
    const b = $('#swapAcceptBtn');
    setBtnLoading(b, true);
    try {
      await api(`/api/swaps/requests/${id}/respond`, { method: 'POST', body: { accept: true, reply } });
      hideSheet();
      toast('Swap accepted', 'success');
      reload();
    } catch (err) { setBtnLoading(b, false); toast(err?.message || 'Could not answer.', 'error'); }
  });
}

async function vaultSheet(data) {
  let items = state.portfolio?.items && !state.portfolio._loadFailed ? state.portfolio.items : null;
  if (!items) {
    try { items = (await api('/api/collection')).items || []; } catch { toast('Your vault could not load.', 'error'); return; }
  }
  const offered = new Set(data.for_trade.map((s) => s.set_num));
  const rows = items.filter((i) => !i.sold_at).sort((a, b) => (Number(b.quantity) || 1) - (Number(a.quantity) || 1));
  showSheet(sheetBody({
    title: 'Offer sets for swap',
    inner: `<div class="bv-field"><div class="bv-field__box"><input id="swapVaultFilter" type="search" placeholder="Filter by name or number" aria-label="Filter by name or number"></div></div>
      <p class="bv-field__help">Sets you own more than one of are listed first.</p>
      <div class="bv-swaps__vault" id="swapVault">${rows.map((i) => `<label class="bv-swaps__pick" data-text="${escapeHtml(`${i.set_num} ${i.name || ''}`.toLowerCase())}">
        <input type="checkbox" value="${escapeHtml(i.set_num)}" ${offered.has(i.set_num) ? 'checked' : ''}>
        <span><span class="bv-num">${escapeHtml(i.set_num)}</span> ${escapeHtml(i.name || '')}${Number(i.quantity) > 1 ? ` ×${Number(i.quantity)}` : ''}</span></label>`).join('')}</div>`,
  }));
  $('#swapVaultFilter')?.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('#swapVault [data-text]').forEach((el) => { el.hidden = !!q && !el.dataset.text.includes(q); });
  });
  $('#swapVault')?.addEventListener('change', async (e) => {
    const input = e.target.closest('input[type="checkbox"]');
    if (!input) return;
    try {
      await api('/api/swaps/trade', { method: 'POST', body: { set_num: input.value, for_trade: input.checked } });
      haptic('light');
    } catch (err) { input.checked = !input.checked; toast(err?.message || 'Could not save.', 'error'); }
  });
  document.getElementById('sheet')?.addEventListener('sheet:closing', () => setTimeout(reload, 0), { once: true });
}

function wire(data) {
  $('#swapOpen')?.addEventListener('change', async (e) => {
    try {
      await api('/api/swaps/prefs', { method: 'POST', body: { open: e.target.checked } });
      haptic('light');
      reload();
    } catch (err) { e.target.checked = !e.target.checked; toast(err?.message || 'Could not save.', 'error'); }
  });
  $('#swapAddTrade')?.addEventListener('click', () => vaultSheet(data));
  $('#swapsPage')?.addEventListener('click', async (e) => {
    const un = e.target.closest('[data-untrade]');
    if (un) {
      try { await api('/api/swaps/trade', { method: 'POST', body: { set_num: un.dataset.untrade, for_trade: false } }); reload(); } catch (err) { toast(err?.message || 'Could not save.', 'error'); }
      return;
    }
    const p = e.target.closest('[data-propose]');
    if (p) { proposeSheet(data.matches[Number(p.dataset.propose)], data); return; }
    const acc = e.target.closest('[data-accept]');
    if (acc) { acceptSheet(acc.dataset.accept); return; }
    const dec = e.target.closest('[data-decline]');
    if (dec) {
      const ok = await confirmSheet({ title: 'Decline this swap?', confirmLabel: 'Decline', danger: true });
      if (!ok) return;
      try { await api(`/api/swaps/requests/${dec.dataset.decline}/respond`, { method: 'POST', body: { accept: false } }); reload(); } catch (err) { toast(err?.message || 'Could not answer.', 'error'); }
      return;
    }
    const can = e.target.closest('[data-cancel]');
    if (can) {
      try { await api(`/api/swaps/requests/${can.dataset.cancel}/cancel`, { method: 'POST' }); reload(); } catch (err) { toast(err?.message || 'Could not withdraw.', 'error'); }
    }
  });
}

export async function renderSwaps() {
  const root = $('#root');
  if (!root) return;
  root.innerHTML = `<main class="bv-page no-nav bv-swaps" aria-busy="true">${topbar({ title: 'Swaps', back: '#/me' })}<div class="bv-group__box bv-gap">${skeletonRows(3)}</div></main>`;
  try {
    paint(await api('/api/swaps'));
  } catch {
    if (!onScreen()) return;
    root.innerHTML = `<main class="bv-page no-nav bv-swaps">${topbar({ title: 'Swaps', back: '#/me' })}
      <p class="bv-foot" role="alert">Swaps could not load.</p>${btn(t('common.retry'), { icon: 'refresh', id: 'swapsRetry', full: true })}</main>`;
    $('#swapsRetry')?.addEventListener('click', renderSwaps);
  }
}
