// Family vault (#/family): a household whose members see one combined vault
// and who owns what. Create one and share the invite code, or join with a
// code. Data: /api/family (worker/src/routes/family.ts).
import { $, escapeHtml, fmtMoney, toast, haptic, proxyImg, setBtnLoading } from '../utils.js';
import { api } from '../api.js';
import { t } from '../lib/i18n.js';
import { topbar, btn, pill, field, card, skeletonRows } from '../ui/kit.js';
import { confirmSheet } from '../components/sheet.js';

const onScreen = () => location.hash.split('?')[0] === '#/family';
let filter = 'all';

function setupHTML() {
  return `<p class="bv-family__lead">Share one vault with the people you collect with. Everyone keeps their own sets; the family vault shows them together, with who owns what.</p>
    ${card(`<h2 class="bv-h3">Start a family vault</h2>
      ${field({ id: 'famName', label: 'Name', placeholder: 'e.g. The Smiths', maxlength: 60 })}
      ${btn('Create', { icon: 'plus', id: 'famCreate', full: true })}`, { cls: 'bv-family__card' })}
    ${card(`<h2 class="bv-h3">Join with a code</h2>
      ${field({ id: 'famCode', label: 'Invite code', placeholder: 'ABCD2345', mono: true, autocomplete: 'off', maxlength: 16 })}
      ${btn('Join', { kind: 'tonal', id: 'famJoin', full: true })}`, { cls: 'bv-family__card' })}`;
}

function memberHTML(m, owner) {
  return `<li class="bv-family__member">
    <span class="bv-family__who">${escapeHtml(m.name)} ${m.role === 'owner' ? pill('Owner', 'info') : ''}</span>
    <span class="bv-family__stat bv-num">${escapeHtml(t('family.memberStat', { sets: m.sets, value: fmtMoney(m.value) }))}</span>
    ${owner && !m.is_me ? `<button type="button" class="bv-btn bv-btn--text bv-btn--sm" data-fam-remove="${Number(m.member_id)}" aria-label="${escapeHtml(t('family.removeMember', { name: m.name }))}">Remove</button>` : ''}
  </li>`;
}

function setHTML(s) {
  return `<li class="bv-family__set">
    <a href="#/set/${encodeURIComponent(s.set_num)}" class="bv-family__setlink">
      ${s.image_url ? `<img src="${escapeHtml(proxyImg(s.image_url))}" alt="" loading="lazy" decoding="async">` : '<span class="bv-family__noimg"></span>'}
      <span class="bv-family__setbody">
        <span class="bv-family__setname">${escapeHtml(s.name || s.set_num)}</span>
        <span class="bv-family__owners">${s.owners.map((o) => escapeHtml(o.quantity > 1 ? `${o.name} ×${o.quantity}` : o.name)).join(', ')}</span>
      </span>
      <span class="bv-family__value bv-num">${escapeHtml(fmtMoney(s.value))}</span>
    </a>
  </li>`;
}

function familyHTML(data) {
  const h = data.household;
  const owner = h.role === 'owner';
  const sets = filter === 'shared' ? data.vault.sets.filter((s) => s.owners.length > 1) : data.vault.sets;
  return `${card(`<div class="bv-family__totals">
        <div><span class="bv-family__label">Family value</span><span class="bv-family__big bv-num">${escapeHtml(fmtMoney(data.vault.total_value))}</span></div>
        <div><span class="bv-family__label">Sets</span><span class="bv-family__big bv-num">${Number(data.vault.total_sets)}</span></div>
      </div>`, { cls: 'bv-family__card' })}
    <h2 class="bv-h2">Members</h2>
    <ul class="bv-family__members">${data.members.map((m) => memberHTML(m, owner)).join('')}</ul>
    ${card(`<span class="bv-family__label">Invite code</span>
      <div class="bv-family__code"><span class="bv-num" id="famInvite">${escapeHtml(h.invite_code)}</span>
        ${btn('Share', { kind: 'tonal', size: 'sm', icon: 'share', id: 'famShare' })}</div>
      <p class="bv-field__help">Anyone with this code can join and see the family vault, including values.</p>
      ${owner ? btn('New code', { kind: 'text', size: 'sm', id: 'famRotate' }) : ''}`, { cls: 'bv-family__card' })}
    <h2 class="bv-h2">Family vault</h2>
    <div class="bv-family__filters" role="group" aria-label="Filter">
      <button type="button" class="bv-chip${filter === 'all' ? ' is-on' : ''}" data-fam-filter="all" aria-pressed="${filter === 'all'}">All sets</button>
      <button type="button" class="bv-chip${filter === 'shared' ? ' is-on' : ''}" data-fam-filter="shared" aria-pressed="${filter === 'shared'}">Owned by more than one of you</button>
    </div>
    ${sets.length ? `<ul class="bv-family__sets">${sets.map(setHTML).join('')}</ul>` : '<p class="bv-field__help">No sets here yet.</p>'}
    ${btn('Leave family vault', { kind: 'danger', id: 'famLeave', full: true })}`;
}

function paint(data) {
  const root = $('#root');
  if (!root || !onScreen()) return;
  root.innerHTML = `<main class="bv-page no-nav bv-family" id="familyPage">
    ${topbar({ title: data.household ? data.household.name : 'Family vault', sub: data.household ? 'Family vault' : '', back: '#/me' })}
    ${data.household ? familyHTML(data) : setupHTML()}
  </main>`;
  wire(data);
}

async function run(btnEl, call, done) {
  setBtnLoading(btnEl, true);
  try { const r = await call(); haptic('light'); done?.(r); } catch (e) { setBtnLoading(btnEl, false); toast(e?.message || 'Something went wrong.', 'error'); }
}

function wire(data) {
  $('#famCreate')?.addEventListener('click', () => run($('#famCreate'), () => api('/api/family', { method: 'POST', body: { name: $('#famName')?.value || '' } }), (r) => { toast('Family vault created', 'success'); paint(r); }));
  $('#famJoin')?.addEventListener('click', () => run($('#famJoin'), () => api('/api/family/join', { method: 'POST', body: { code: $('#famCode')?.value || '' } }), (r) => { toast('You joined the family vault', 'success'); paint(r); }));
  $('#famRotate')?.addEventListener('click', () => run($('#famRotate'), () => api('/api/family/code', { method: 'POST' }), (r) => { toast('New invite code ready. The old one no longer works.', 'success'); paint(r); }));
  $('#famShare')?.addEventListener('click', async () => {
    const code = data.household?.invite_code || '';
    const payload = { title: t('family.shareTitle'), text: t('family.shareText', { code }) };
    try {
      if (navigator.share) { await navigator.share(payload); return; }
    } catch (e) { if (e?.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(code); toast('Invite code copied', 'success'); } catch { toast(code, 'info'); }
  });
  $('#famLeave')?.addEventListener('click', async () => {
    const ok = await confirmSheet({ title: 'Leave the family vault?', message: 'Your sets stay in your own vault. You can join again with a code.', confirmLabel: 'Leave', danger: true });
    if (!ok) return;
    run($('#famLeave'), () => api('/api/family/leave', { method: 'POST' }), (r) => { toast('You left the family vault', 'info'); paint(r); });
  });
  $('#familyPage')?.addEventListener('click', async (e) => {
    const f = e.target.closest('[data-fam-filter]');
    if (f) { filter = f.dataset.famFilter; paint(data); return; }
    const rm = e.target.closest('[data-fam-remove]');
    if (!rm) return;
    const ok = await confirmSheet({ title: 'Remove this member?', message: 'Their sets leave the family vault. They keep their own vault.', confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    try { paint(await api(`/api/family/members/${rm.dataset.famRemove}`, { method: 'DELETE' })); } catch (err) { toast(err?.message || 'Could not remove.', 'error'); }
  });
}

export async function renderFamily() {
  const root = $('#root');
  if (!root) return;
  root.innerHTML = `<main class="bv-page no-nav bv-family" aria-busy="true">${topbar({ title: 'Family vault', back: '#/me' })}<div class="bv-group__box bv-gap">${skeletonRows(3)}</div></main>`;
  try {
    paint(await api('/api/family'));
  } catch {
    if (!onScreen()) return;
    root.innerHTML = `<main class="bv-page no-nav bv-family">${topbar({ title: 'Family vault', back: '#/me' })}
      <p class="bv-foot" role="alert">The family vault could not load.</p>${btn(t('common.retry'), { icon: 'refresh', id: 'famRetry', full: true })}</main>`;
    $('#famRetry')?.addEventListener('click', renderFamily);
  }
}
