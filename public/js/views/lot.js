// Lot checker (#/lot): is a bundle of sets (a garage-sale box, a marketplace
// listing) worth its asking price? Paste the listing or search sets, set each
// one's condition, enter the price and get the value and a verdict.
// Data: POST /api/lot/parse and /api/lot/value (worker/src/routes/lot.ts).
// Free members check up to 3 sets per lot; Pro has no limit.
import { $, escapeHtml, fmtMoney, toast, haptic, proxyImg, setBtnLoading, CURRENCY_SYMBOLS, capturedMoneyContext } from '../utils.js';
import { state } from '../state.js';
import { api } from '../api.js';
import { t } from '../lib/i18n.js';
import { topbar, btn, pill, field, card } from '../ui/kit.js';
import { localMoneyToUsd } from '../lib/money-input.js';

const CONDITIONS = [
  ['sealed', 'Sealed'],
  ['used', 'Used, complete'],
  ['incomplete', 'Incomplete'],
];
const VERDICT = {
  great: ['Great deal', 'gain'],
  good: ['Good deal', 'gain'],
  fair: ['Fair price', 'info'],
  overpriced: ['Overpriced', 'loss'],
};
const STORE_KEY = 'bv_lot_items';
const onScreen = () => location.hash.split('?')[0] === '#/lot';

let items = [];
let result = null;

function loadItems() {
  try { items = JSON.parse(sessionStorage.getItem(STORE_KEY) || '[]').filter((i) => i?.set_num).slice(0, 60); } catch { items = []; }
}
function saveItems() {
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify(items)); } catch {}
}

function addSet(s) {
  const found = items.find((i) => i.set_num === s.set_num);
  if (found) found.qty = Math.min(99, (found.qty || 1) + 1);
  else items.push({ set_num: s.set_num, name: s.name || s.set_num, image_url: s.image_url || null, condition: 'sealed', qty: 1 });
  result = null;
  saveItems();
}

function itemHTML(i, idx) {
  const valued = result?.items?.find((r) => r.set_num === i.set_num && r.condition === i.condition);
  return `<li class="bv-lot__item" data-idx="${idx}">
    ${i.image_url ? `<img class="bv-lot__img" src="${escapeHtml(proxyImg(i.image_url))}" alt="" loading="lazy" decoding="async">` : '<span class="bv-lot__img"></span>'}
    <span class="bv-lot__body">
      <span class="bv-lot__name">${escapeHtml(i.name)}</span>
      <span class="bv-lot__meta bv-num">${escapeHtml(i.set_num)}${valued ? ` · ${valued.value != null ? escapeHtml(fmtMoney(valued.value)) : 'No price yet'}` : ''}</span>
      <span class="bv-lot__controls">
        <select data-lot-cond aria-label="Condition">${CONDITIONS.map(([v, l]) => `<option value="${v}"${i.condition === v ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>
        <input data-lot-qty type="number" min="1" max="99" inputmode="numeric" value="${Number(i.qty) || 1}" aria-label="Quantity">
        <button type="button" class="bv-btn bv-btn--text bv-btn--sm" data-lot-remove>Remove</button>
      </span>
    </span>
  </li>`;
}

function resultHTML() {
  if (!result) return '';
  const [label, tone] = VERDICT[result.verdict] || [];
  const rows = [
    ['Worth', fmtMoney(result.total)],
    ['You keep after selling fees', fmtMoney(result.resale_keep)],
    result.asking_usd != null ? ['Asking price', fmtMoney(result.asking_usd)] : null,
    result.margin != null ? [result.margin >= 0 ? 'Room to profit' : 'Short by', fmtMoney(Math.abs(result.margin))] : null,
  ].filter(Boolean);
  return card(`<div class="bv-lot__verdict">${label ? pill(label, tone) : ''}</div>
    <dl class="bv-lot__sum">${rows.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd class="bv-num">${escapeHtml(v)}</dd></div>`).join('')}</dl>
    ${result.unpriced ? `<p class="bv-field__help">${escapeHtml(t('lot.unpriced', { missing: result.unpriced }))}</p>` : ''}
    ${result.asking_usd == null ? '<p class="bv-field__help">Enter the asking price to get a verdict.</p>' : ''}`, { cls: 'bv-lot__result', id: 'lotResult' });
}

function paint() {
  const root = $('#root');
  if (!root || !onScreen()) return;
  const ctx = capturedMoneyContext();
  const pro = !!state.me?.is_supporter;
  const asking = $('#lotAsking')?.value || '';
  root.innerHTML = `<main class="bv-page no-nav bv-lot" id="lotPage">
    ${topbar({ title: 'Lot checker', sub: 'Is that bundle worth the price?', back: '#/me' })}
    <section class="bv-lot__add">
      <div class="bv-field"><label for="lotText">Paste a listing</label><div class="bv-field__box">
        <textarea id="lotText" rows="3" placeholder="e.g. LEGO lot: 75313 AT-AT, 10497, castle 6086…"></textarea></div></div>
      ${btn('Find sets in the text', { kind: 'tonal', icon: 'search', id: 'lotParse', full: true })}
      ${field({ id: 'lotSearch', label: 'Or search a set', placeholder: 'Name or set number', icon: 'search', autocomplete: 'off' })}
      <ul class="bv-lot__hits" id="lotHits"></ul>
    </section>
    <h2 class="bv-h2">In this lot</h2>
    ${items.length
      ? `<ul class="bv-lot__list" id="lotList">${items.map(itemHTML).join('')}</ul>`
      : '<p class="bv-field__help">No sets yet. Paste the listing or search above.</p>'}
    ${!pro ? `<p class="bv-field__help">Free checks cover small lots of up to three sets. <a href="#/pro">Pro</a> checks lots of any size.</p>` : ''}
    ${field({ id: 'lotAsking', label: 'Asking price', value: asking, placeholder: '0.00', mono: true, prefix: CURRENCY_SYMBOLS[ctx.currency] || '$', inputmode: 'decimal', autocomplete: 'off' })}
    ${btn('Check this lot', { icon: 'check', id: 'lotCheck', full: true, disabled: !items.length })}
    ${resultHTML()}
    <p class="bv-foot">Values come from recent market prices. Incomplete sets count at about 60% of a complete used one.</p>
  </main>`;
  wire();
}

let searchTimer = 0;
function wire() {
  $('#lotParse')?.addEventListener('click', async () => {
    const text = $('#lotText')?.value || '';
    if (!text.trim()) { toast('Paste the listing text first.', 'error'); return; }
    const b = $('#lotParse');
    setBtnLoading(b, true);
    try {
      const r = await api('/api/lot/parse', { method: 'POST', body: { text } });
      (r.sets || []).forEach(addSet);
      if (!r.sets?.length) toast('No set numbers found in that text.', 'info');
      else haptic('light');
      paint();
    } catch (e) { setBtnLoading(b, false); toast(e?.message || 'Could not read the listing.', 'error'); }
  });
  $('#lotSearch')?.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    const hits = $('#lotHits');
    if (q.length < 2) { if (hits) hits.innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      try {
        const r = await api(`/api/sets/search?q=${encodeURIComponent(q)}&limit=6`);
        if (!onScreen() || $('#lotSearch')?.value.trim() !== q || !hits) return;
        const sets = r.sets || [];
        hits.innerHTML = sets.map((s, i) => `<li><button type="button" class="bv-lot__hit" data-hit="${i}">
          <span class="bv-num">${escapeHtml(s.set_num)}</span> ${escapeHtml(s.name || '')}${s.year ? ` <span class="bv-lot__meta">(${Number(s.year)})</span>` : ''}</button></li>`).join('');
        hits.onclick = (ev) => {
          const hit = ev.target.closest('[data-hit]');
          if (!hit) return;
          addSet(sets[Number(hit.dataset.hit)]);
          haptic('light');
          paint();
        };
      } catch {}
    }, 250);
  });
  const list = $('#lotList');
  list?.addEventListener('change', (e) => {
    const idx = Number(e.target.closest('[data-idx]')?.dataset.idx);
    const it = items[idx];
    if (!it) return;
    if (e.target.matches('[data-lot-cond]')) it.condition = e.target.value;
    if (e.target.matches('[data-lot-qty]')) it.qty = Math.min(99, Math.max(1, Math.floor(Number(e.target.value) || 1)));
    result = null;
    saveItems();
  });
  list?.addEventListener('click', (e) => {
    if (!e.target.closest('[data-lot-remove]')) return;
    items.splice(Number(e.target.closest('[data-idx]')?.dataset.idx), 1);
    result = null;
    saveItems();
    paint();
  });
  $('#lotCheck')?.addEventListener('click', async () => {
    const ctx = capturedMoneyContext();
    const price = localMoneyToUsd($('#lotAsking')?.value, ctx);
    if (!price.valid) { toast('Enter a valid asking price.', 'error'); return; }
    const b = $('#lotCheck');
    setBtnLoading(b, true);
    try {
      result = await api('/api/lot/value', {
        method: 'POST',
        body: { items: items.map(({ set_num, condition, qty }) => ({ set_num, condition, qty })), asking_usd: price.blank ? null : price.usd },
      });
      haptic('medium');
      paint();
      $('#lotResult')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (e) {
      setBtnLoading(b, false);
      if (e?.status === 402) toast('Lots over 3 sets come with Pro.', 'info');
      else toast(e?.message || 'Could not check the lot.', 'error');
    }
  });
}

export async function renderLot() {
  loadItems();
  result = null;
  paint();
}
