// Swaps (#/swaps): offer vault sets for swap and get matched with collectors
// who have a set you wishlisted or want one you offer. A swap request carries
// the sets each way and an optional note; both sides then talk in a private
// chat on that request, so nobody has to post an email or phone number.
// Contact details are refused until a swap is accepted and need a "Send
// anyway" after that. Every request can be deleted from your list, matches can
// be hidden, and collectors can be blocked or reported.
// Data: /api/swaps (worker/src/routes/swaps.ts).
import { $, escapeHtml, toast, haptic, proxyImg, setBtnLoading } from '../utils.js';
import { state } from '../state.js';
import { api } from '../api.js';
import { t, tPlural } from '../lib/i18n.js';
import { findContactDetails } from '../lib/pure.js';
import { topbar, btn, pill, card, sheetBody, skeletonRows } from '../ui/kit.js';
import { showSheet, hideSheet, confirmSheet } from '../components/sheet.js';

const onScreen = () => location.hash.split('?')[0] === '#/swaps';
const STATUS = {
  pending: ['Waiting for an answer', 'info'],
  accepted: ['Accepted', 'gain'],
  completed: ['Swap complete', 'gain'],
  declined: ['Declined', 'loss'],
  cancelled: ['Withdrawn', 'neutral'],
};
const REPORT_REASONS = [
  ['scam', 'Scam or asked for money first'],
  ['harassment', 'Rude or harassing'],
  ['spam', 'Spam'],
  ['no_show', 'Did not send their sets'],
  ['other', 'Something else'],
];

const TIME_FMT = { month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric' };

const chipList = (sets) => `<ul class="bv-swaps__sets">${sets.map((s) => `<li>
  ${s.image_url ? `<img src="${escapeHtml(proxyImg(s.image_url))}" alt="" loading="lazy" decoding="async">` : ''}
  <span><span class="bv-num">${escapeHtml(s.set_num)}</span> ${escapeHtml(s.name || '')}</span></li>`).join('')}</ul>`;

const reputation = (n) => (n > 0 ? pill(tPlural('swaps.swapsDone', n, { n }), 'gain') : pill('New to swaps', 'neutral'));

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
      ${m.they_have.length && m.they_want.length ? pill('Both ways', 'gain') : ''}${reputation(m.swaps_done || 0)}</div>
    ${m.they_have.length ? `<p class="bv-swaps__label">Has sets on your wishlist</p>${chipList(m.they_have)}` : ''}
    ${m.they_want.length ? `<p class="bv-swaps__label">Wants sets you offer</p>${chipList(m.they_want)}` : ''}
    <div class="bv-btn-row">
      ${btn('Hide', { kind: 'text', attrs: { 'data-hide': m.handle, 'aria-label': t('swaps.hideMatch', { name: m.name || m.handle }) } })}
      ${btn('Propose a swap', { kind: 'outline', id: `swapPropose${i}`, attrs: { 'data-propose': String(i) } })}
    </div>
  </li>`;
}

function requestActions(r) {
  const incoming = r.direction === 'incoming';
  const id = String(r.id);
  const chat = r.can_chat
    ? btn(r.unread ? tPlural('swaps.chatUnread', r.unread, { n: r.unread }) : 'Chat', { kind: r.unread ? 'primary' : 'tonal', icon: 'chat', attrs: { 'data-chat': id } })
    : '';
  const more = btn('', { kind: 'text', icon: 'more', attrs: { 'data-more': id, 'aria-label': 'More actions' } });
  if (r.status === 'pending') {
    return incoming
      ? `${btn('Decline', { kind: 'text', attrs: { 'data-decline': id } })}${chat}${btn('Accept', { attrs: { 'data-accept': id } })}${more}`
      : `${btn('Withdraw', { kind: 'text', attrs: { 'data-cancel': id } })}${chat}${more}`;
  }
  if (r.status === 'accepted') {
    return `${chat}${r.i_marked_done
      ? btn('Waiting for them', { kind: 'outline', disabled: true })
      : btn('Swap done', { kind: 'outline', icon: 'check', attrs: { 'data-done': id } })}${more}`;
  }
  return `${chat}${btn('Delete', { kind: 'text', icon: 'trash', attrs: { 'data-delete': id } })}${more}`;
}

function requestHTML(r) {
  const [label, tone] = STATUS[r.status] || [r.status, 'neutral'];
  const incoming = r.direction === 'incoming';
  return `<li class="bv-swaps__req" data-req="${Number(r.id)}">
    <div class="bv-swaps__who">${escapeHtml(incoming ? t('swaps.from', { name: r.with_name || r.with_handle || '' }) : t('swaps.to', { name: r.with_name || r.with_handle || '' }))} ${pill(label, tone)}${reputation(r.with_swaps_done || 0)}</div>
    ${r.i_give.length ? `<p class="bv-swaps__label">You give</p>${chipList(r.i_give)}` : ''}
    ${r.i_get.length ? `<p class="bv-swaps__label">You get</p>${chipList(r.i_get)}` : ''}
    ${r.message ? `<p class="bv-swaps__note"><span class="bv-swaps__label">${incoming ? 'Their note' : 'Your note'}</span>${escapeHtml(r.message)}</p>` : ''}
    ${r.reply ? `<p class="bv-swaps__note"><span class="bv-swaps__label">${incoming ? 'Your reply' : 'Their reply'}</span>${escapeHtml(r.reply)}</p>` : ''}
    ${r.status === 'accepted' && r.they_marked_done && !r.i_marked_done ? '<p class="bv-field__help">They marked this swap as done. Tap Swap done once you have your sets.</p>' : ''}
    <div class="bv-swaps__actions">${requestActions(r)}</div>
  </li>`;
}

function hiddenHTML(data) {
  if (!data.hidden?.length) return '';
  return `<details class="bv-swaps__hidden"><summary>${escapeHtml(tPlural('swaps.hiddenCount', data.hidden.length, { n: data.hidden.length }))}</summary>
    <ul class="bv-swaps__trade">${data.hidden.map((p) => `<li><span>${escapeHtml(p.name || p.handle)} ${p.kind === 'block' ? pill('Blocked', 'loss') : pill('Hidden', 'neutral')}</span>
      <button type="button" class="bv-btn bv-btn--text bv-btn--sm" data-unhide="${escapeHtml(p.handle)}">${p.kind === 'block' ? 'Unblock' : 'Show again'}</button></li>`).join('')}</ul></details>`;
}

const SAFETY = `<div class="bv-swaps__safety">
  <h2 class="bv-h3">Swap safely</h2>
  <ul>
    <li>Keep the conversation in the chat here until you trust them. You never need to post your email or phone number.</li>
    <li>Never pay a stranger in advance. A swap is sets for sets.</li>
    <li>Meet in a public place, or both ship with tracking on the same day.</li>
    <li>Check their completed swaps, and report anyone who asks for money or personal details.</li>
  </ul>
</div>`;

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
    ${hiddenHTML(data)}
    ${SAFETY}
  </main>`;
  wire(data);
  const chatId = new URLSearchParams(location.hash.split('?')[1] || '').get('chat');
  if (chatId) {
    history.replaceState(null, '', '#/swaps');
    const r = data.requests.find((x) => String(x.id) === chatId);
    if (r) chatSheet(r);
  }
}

async function reload() {
  try { paint(await api('/api/swaps')); } catch (e) { toast(e?.message || 'Swaps could not load.', 'error'); }
}

function noteField(id, label, placeholder) {
  return `<div class="bv-field"><label for="${id}">${escapeHtml(label)}</label><div class="bv-field__box">
    <textarea id="${id}" rows="3" maxlength="500" placeholder="${escapeHtml(placeholder)}"></textarea></div></div>`;
}

/**
 * Contact details before a swap is accepted are refused outright; after that
 * the sender confirms once. Returns { ok, confirm } for the request body.
 */
async function contactCheck(text, accepted) {
  if (!findContactDetails(text).length) return { ok: true, confirm: false };
  if (!accepted) {
    toast('Keep contact details out until the swap is accepted. Use the chat to agree on the swap first.', 'error');
    return { ok: false };
  }
  const ok = await confirmSheet({
    title: 'Share contact details?',
    message: 'This looks like an email, phone number or messenger. Anyone you give it to can reach you outside BricksVault. You can keep everything in this chat instead.',
    confirmLabel: 'Send anyway',
  });
  return { ok, confirm: ok };
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
      ${noteField('swapNote', 'Note (optional)', 'e.g. box condition, or other sets you would add')}
      <p class="bv-field__help">No email or phone number needed. You can chat here once the request is sent.</p>
      ${btn('Send request', { type: 'submit', full: true, id: 'swapSend' })}
    </form>`,
  }));
  $('#swapForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const picked = (name) => [...document.querySelectorAll(`#swapForm input[name="${name}"]:checked`)].map((i) => i.value);
    const body = { to: m.handle, give: picked('give'), get: picked('get'), message: $('#swapNote')?.value.trim() || '' };
    if (!body.give.length && !body.get.length) { toast('Pick at least one set.', 'error'); return; }
    if (!(await contactCheck(body.message, false)).ok) return;
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
      <p class="bv-field__help">After you accept, agree on shipping or a meetup in the chat.</p>
      ${noteField('swapReply', 'Your note (optional)', 'e.g. when you could ship or meet')}
      ${btn('Accept', { type: 'submit', full: true, id: 'swapAcceptBtn' })}
    </form>`,
  }));
  $('#swapAcceptForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const reply = $('#swapReply')?.value.trim() || '';
    const check = await contactCheck(reply, true);
    if (!check.ok) { acceptSheet(id); return; }
    const b = $('#swapAcceptBtn');
    setBtnLoading(b, true);
    try {
      await api(`/api/swaps/requests/${id}/respond`, { method: 'POST', body: { accept: true, reply, confirm_contact: check.confirm } });
      hideSheet();
      toast('Swap accepted', 'success');
      reload();
    } catch (err) { setBtnLoading(b, false); toast(err?.message || 'Could not answer.', 'error'); }
  });
}

const fmtTime = (iso) => {
  const d = new Date(String(iso || '').replace(' ', 'T') + (String(iso || '').endsWith('Z') ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, TIME_FMT);
};

function messagesHTML(list) {
  if (!list.length) return '<p class="bv-swaps__chatempty">No messages yet. Say hi and agree on the swap here.</p>';
  return list.map((m) => `<div class="bv-swaps__msg${m.mine ? ' is-mine' : ''}"><p>${escapeHtml(m.body)}</p><time>${escapeHtml(fmtTime(m.created_at))}</time></div>`).join('');
}

async function chatSheet(r) {
  let chat;
  try { chat = await api(`/api/swaps/requests/${r.id}/messages`); } catch (err) { toast(err?.message || 'Chat could not load.', 'error'); return; }
  const accepted = chat.status === 'accepted' || chat.status === 'completed';
  showSheet(sheetBody({
    title: t('swaps.chatWith', { name: chat.with_name || chat.with_handle || '' }),
    id: 'swapChat',
    inner: `<p class="bv-field__help">${accepted
      ? 'Only the two of you see this chat. Share contact details only if you trust them.'
      : 'Only the two of you see this chat. Contact details unlock once the swap is accepted.'}</p>
      <div class="bv-swaps__chat" id="swapChatLog" role="log" aria-live="polite">${messagesHTML(chat.messages)}</div>
      ${chat.can_send ? `<form id="swapChatForm" class="bv-swaps__chatform" novalidate>
        <div class="bv-field__box"><textarea id="swapChatText" rows="2" maxlength="1000" aria-label="Message" placeholder="Write a message"></textarea></div>
        ${btn('Send', { type: 'submit', id: 'swapChatSend' })}
      </form>` : `<p class="bv-field__help">${chat.blocked ? 'You can no longer message this collector.' : 'This swap is closed, so the chat is read-only.'}</p>`}`,
  }));
  const log = $('#swapChatLog');
  const scroll = () => { if (log) log.scrollTop = log.scrollHeight; };
  scroll();
  let lastId = chat.messages.at(-1)?.id || 0;
  const refresh = async () => {
    if (!document.getElementById('swapChat') || document.hidden) return;
    try {
      const next = await api(`/api/swaps/requests/${r.id}/messages`);
      if ((next.messages.at(-1)?.id || 0) !== lastId && log) {
        lastId = next.messages.at(-1)?.id || 0;
        log.innerHTML = messagesHTML(next.messages);
        scroll();
      }
    } catch { /* keep the open chat as it is */ }
  };
  const timer = setInterval(refresh, 10000);
  document.getElementById('sheet')?.addEventListener('sheet:closing', () => { clearInterval(timer); setTimeout(reload, 0); }, { once: true });

  $('#swapChatForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#swapChatText');
    const text = input?.value.trim() || '';
    if (!text) return;
    const check = await contactCheck(text, accepted);
    if (!check.ok) {
      if (accepted) chatSheet(r).then(() => { const i = $('#swapChatText'); if (i) i.value = text; });
      return;
    }
    if (check.confirm) {
      // The confirm sheet replaced the chat; send, then reopen it.
      try {
        await api(`/api/swaps/requests/${r.id}/messages`, { method: 'POST', body: { body: text, confirm_contact: true } });
      } catch (err) { toast(err?.message || 'Could not send.', 'error'); }
      chatSheet(r);
      return;
    }
    const b = $('#swapChatSend');
    setBtnLoading(b, true);
    try {
      const res = await api(`/api/swaps/requests/${r.id}/messages`, { method: 'POST', body: { body: text } });
      if (input) input.value = '';
      chat.messages.push(res.message);
      lastId = res.message?.id || lastId;
      if (log) { log.innerHTML = messagesHTML(chat.messages); scroll(); }
      haptic('light');
    } catch (err) { toast(err?.message || 'Could not send.', 'error'); }
    setBtnLoading(b, false);
    input?.focus();
  });
}

function reportSheet(r) {
  showSheet(sheetBody({
    title: t('swaps.reportName', { name: r.with_name || r.with_handle || '' }),
    inner: `<form id="swapReportForm" class="bv-form" novalidate>
      <p class="bv-field__help">We review every report. Reporting also blocks them, so they cannot see or message you.</p>
      ${REPORT_REASONS.map(([v, label], i) => `<label class="bv-swaps__pick"><input type="radio" name="reason" value="${v}" ${i === 0 ? 'checked' : ''}><span>${escapeHtml(label)}</span></label>`).join('')}
      <div class="bv-field"><label for="swapReportText">What happened? (optional)</label><div class="bv-field__box">
        <textarea id="swapReportText" rows="3" maxlength="1000"></textarea></div></div>
      ${btn('Report and block', { type: 'submit', full: true, id: 'swapReportBtn', kind: 'danger-fill' })}
    </form>`,
  }));
  $('#swapReportForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = $('#swapReportBtn');
    setBtnLoading(b, true);
    try {
      await api(`/api/swaps/people/${encodeURIComponent(r.with_handle)}/report`, {
        method: 'POST',
        body: { reason: document.querySelector('#swapReportForm input[name="reason"]:checked')?.value, details: $('#swapReportText')?.value.trim() || '', request_id: r.id },
      });
      hideSheet();
      toast('Thanks. We will look into it.', 'success');
      reload();
    } catch (err) { setBtnLoading(b, false); toast(err?.message || 'Could not send.', 'error'); }
  });
}

function deleteCopy(r) {
  if (r.status === 'pending') return r.direction === 'incoming' ? 'This declines the request and removes it from your list.' : 'This withdraws the request and removes it from your list.';
  if (r.status === 'accepted') return 'This calls off the swap for both of you and removes it from your list. They get a notification.';
  return 'It disappears from your list. Once both of you delete it, the chat is gone for good.';
}

async function deleteRequest(r) {
  const ok = await confirmSheet({ title: 'Delete this swap?', message: deleteCopy(r), confirmLabel: 'Delete', danger: true });
  if (!ok) return;
  try { await api(`/api/swaps/requests/${r.id}`, { method: 'DELETE' }); toast('Swap deleted', 'success'); reload(); } catch (err) { toast(err?.message || 'Could not delete.', 'error'); }
}

async function blockPerson(r) {
  const ok = await confirmSheet({
    title: t('swaps.blockName', { name: r.with_name || r.with_handle || '' }),
    message: 'They will not show up in your matches and cannot send you requests or messages. Open swaps with them are called off.',
    confirmLabel: 'Block',
    danger: true,
  });
  if (!ok) return;
  try { await api(`/api/swaps/people/${encodeURIComponent(r.with_handle)}/block`, { method: 'POST' }); toast('Blocked', 'success'); reload(); } catch (err) { toast(err?.message || 'Could not save.', 'error'); }
}

function moreSheet(r) {
  const live = r.status === 'pending' || r.status === 'accepted';
  showSheet(sheetBody({
    title: t('swaps.swapWith', { name: r.with_name || r.with_handle || '' }),
    inner: `<div class="bv-swaps__menu">
      ${r.status === 'accepted' ? btn('Call off this swap', { kind: 'outline', full: true, id: 'swapMoreCancel' }) : ''}
      ${btn(live ? 'Delete from my list' : 'Delete', { kind: 'outline', icon: 'trash', full: true, id: 'swapMoreDelete' })}
      ${r.with_handle ? btn(t('swaps.blockName', { name: r.with_name || r.with_handle }), { kind: 'outline', full: true, id: 'swapMoreBlock' }) : ''}
      ${r.with_handle ? btn(t('swaps.reportName', { name: r.with_name || r.with_handle }), { kind: 'text', full: true, id: 'swapMoreReport', cls: 'bv-swaps__danger' }) : ''}
    </div>`,
  }));
  $('#swapMoreCancel')?.addEventListener('click', async () => {
    const ok = await confirmSheet({ title: 'Call off this swap?', message: 'The swap stays in your list as withdrawn. They get a notification.', confirmLabel: 'Call off', danger: true });
    if (!ok) return;
    try { await api(`/api/swaps/requests/${r.id}/cancel`, { method: 'POST' }); reload(); } catch (err) { toast(err?.message || 'Could not withdraw.', 'error'); }
  });
  $('#swapMoreDelete')?.addEventListener('click', () => deleteRequest(r));
  $('#swapMoreBlock')?.addEventListener('click', () => blockPerson(r));
  $('#swapMoreReport')?.addEventListener('click', () => reportSheet(r));
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
    const open = e.target.checked;
    let adult = false;
    if (open && !data.adult_confirmed) {
      // Swaps and chat are 18+ (Terms of Service). Asked once, remembered on the server.
      adult = await confirmSheet({
        title: 'Swaps are for adults',
        message: 'Swaps let you chat with and meet other collectors, so they are only for people aged 18 or older. By continuing you confirm you are 18 or older and agree to the swap rules in our Terms: trade only sets you own, keep it respectful, and report anything suspicious.',
        confirmLabel: "I'm 18 or older",
      });
      if (!adult) { e.target.checked = false; return; }
    }
    try {
      await api('/api/swaps/prefs', { method: 'POST', body: adult ? { open, adult: true } : { open } });
      haptic('light');
      reload();
    } catch (err) { e.target.checked = !e.target.checked; toast(err?.message || 'Could not save.', 'error'); }
  });
  $('#swapAddTrade')?.addEventListener('click', () => vaultSheet(data));
  const req = (id) => data.requests.find((r) => String(r.id) === String(id));
  $('#swapsPage')?.addEventListener('click', async (e) => {
    const un = e.target.closest('[data-untrade]');
    if (un) {
      try { await api('/api/swaps/trade', { method: 'POST', body: { set_num: un.dataset.untrade, for_trade: false } }); reload(); } catch (err) { toast(err?.message || 'Could not save.', 'error'); }
      return;
    }
    const p = e.target.closest('[data-propose]');
    if (p) { proposeSheet(data.matches[Number(p.dataset.propose)], data); return; }
    const hide = e.target.closest('[data-hide]');
    if (hide) {
      try { await api(`/api/swaps/people/${encodeURIComponent(hide.dataset.hide)}/hide`, { method: 'POST' }); haptic('light'); toast('Hidden from your matches', 'success'); reload(); } catch (err) { toast(err?.message || 'Could not save.', 'error'); }
      return;
    }
    const unhide = e.target.closest('[data-unhide]');
    if (unhide) {
      try { await api(`/api/swaps/people/${encodeURIComponent(unhide.dataset.unhide)}`, { method: 'DELETE' }); reload(); } catch (err) { toast(err?.message || 'Could not save.', 'error'); }
      return;
    }
    const chat = e.target.closest('[data-chat]');
    if (chat) { const r = req(chat.dataset.chat); if (r) chatSheet(r); return; }
    const more = e.target.closest('[data-more]');
    if (more) { const r = req(more.dataset.more); if (r) moreSheet(r); return; }
    const del = e.target.closest('[data-delete]');
    if (del) { const r = req(del.dataset.delete); if (r) deleteRequest(r); return; }
    const done = e.target.closest('[data-done]');
    if (done) {
      const ok = await confirmSheet({ title: 'Mark this swap as done?', message: 'Do this once you have their sets. When you both mark it done, it counts as a completed swap on both profiles.', confirmLabel: 'Swap done' });
      if (!ok) return;
      try {
        const res = await api(`/api/swaps/requests/${done.dataset.done}/done`, { method: 'POST', body: { done: true } });
        haptic('medium');
        toast(res?.completed ? 'Swap complete' : 'Marked as done', 'success');
        reload();
      } catch (err) { toast(err?.message || 'Could not save.', 'error'); }
      return;
    }
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
