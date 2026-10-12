// "Your copies" on the set page's Manage tab: each physical copy of a set with
// its own condition, price paid, date, source and shelf, and a sale per copy.
// Backed by /api/collection/:id/copies (worker/src/routes/copies.ts); the
// holding stays the aggregate of its copies, so the rest of the app keeps
// reading one row per set.
import { escapeHtml, toast, fmtMoney, haptic, setBtnLoading, CURRENCY_SYMBOLS, capturedMoneyContext, readFileAsDataURL, resizeImage } from '../utils.js';
import { api } from '../api.js';
import { showSheet, hideSheet, confirmSheet } from './sheet.js';
import { icon, field, sheetBody } from '../ui/kit.js';
import { localMoneyToUsd, usdMoneyInputValue } from '../lib/money-input.js';
import { t } from '../lib/i18n.js';

const CONDITIONS = [
  ['sealed', 'Sealed (MISB)'],
  ['new', 'New, opened'],
  ['used_good', 'Used — good'],
  ['used_acceptable', 'Used — acceptable'],
];
const BOX_GRADES = [
  ['mint', 'Mint'],
  ['near_mint', 'Near mint'],
  ['good', 'Good'],
  ['fair', 'Fair'],
  ['poor', 'Poor'],
];
const boxGradeLabel = (g) => (BOX_GRADES.find(([v]) => v === g) || [g, ''])[1];
const SOURCES = ['Store', 'BrickLink', 'eBay', 'Facebook Marketplace', 'Trade', 'Gift', 'Other'];
const conditionLabel = (c) => (CONDITIONS.find(([v]) => v === c) || [c, c])[1];
const symbol = (ctx) => CURRENCY_SYMBOLS[ctx.currency] || '$';

function copyRowHTML(copy, index) {
  const bits = [
    conditionLabel(copy.condition),
    copy.box_grade ? t('copies.boxGrade', { grade: boxGradeLabel(copy.box_grade) }) : '',
    copy.purchase_price != null ? t('copies.paid', { price: fmtMoney(copy.purchase_price) }) : 'Price not set',
    copy.purchased_at ? copy.purchased_at.slice(0, 10) : '',
    copy.storage_location || '',
  ].filter(Boolean);
  return `<li class="bv-copies__row" data-copy-id="${Number(copy.id)}">
    <span class="bv-copies__num bv-num">#${index + 1}</span>
    <span class="bv-copies__body">
      <span class="bv-copies__meta">${bits.map(escapeHtml).join(' · ')}</span>
      ${copy.notes ? `<span class="bv-copies__notes">${escapeHtml(copy.notes)}</span>` : ''}
    </span>
    <span class="bv-copies__actions">
      <button type="button" class="bv-btn bv-btn--text bv-btn--sm" data-copy-edit aria-label="${escapeHtml(t('copies.editN', { index: index + 1 }))}">${icon('edit', { size: 18 })}<span>Edit</span></button>
      <button type="button" class="bv-btn bv-btn--text bv-btn--sm" data-copy-sell aria-label="${escapeHtml(t('copies.sellN', { index: index + 1 }))}">${icon('tag', { size: 18 })}<span>Sell</span></button>
    </span>
  </li>`;
}

function editSheetHTML(copy, ctx, isNew) {
  return sheetBody({
    title: isNew ? 'Add a copy' : 'Edit copy',
    id: 'copySheet',
    inner: `<form class="bv-form" id="copyForm" novalidate>
      <div class="bv-field"><label for="copyCondition">Condition</label><div class="bv-field__box"><select id="copyCondition">
        ${CONDITIONS.map(([v, l]) => `<option value="${v}" ${copy.condition === v ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}
      </select></div></div>
      <div class="bv-form-grid">
        ${field({ id: 'copyPrice', label: 'Price paid', value: usdMoneyInputValue(copy.purchase_price, ctx), placeholder: '0.00', mono: true, prefix: symbol(ctx), inputmode: 'decimal', autocomplete: 'off' })}
        <div class="bv-field"><label for="copyDate">Purchase date</label><div class="bv-field__box"><input id="copyDate" type="date" value="${escapeHtml((copy.purchased_at || '').slice(0, 10))}"></div></div>
      </div>
      <div class="bv-field"><label for="copySource">Acquisition source</label><div class="bv-field__box"><select id="copySource">
        <option value="">— select —</option>
        ${SOURCES.map((s) => `<option value="${s}" ${copy.acquisition_source === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
      </select></div></div>
      <div class="bv-field"><label for="copyBoxGrade">Box condition</label><div class="bv-field__box"><select id="copyBoxGrade">
        <option value="">Not graded</option>
        ${BOX_GRADES.map(([v, l]) => `<option value="${v}" ${copy.box_grade === v ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}
      </select></div></div>
      <div class="bv-boxgrade">
        <label class="bv-btn bv-btn--tonal bv-btn--sm" id="copyGradeBtn">${icon('camera', { size: 18 })}<span>Grade from a photo</span>
          <input type="file" accept="image/*" capture="environment" id="copyGradePhoto" hidden></label>
        <p class="bv-field__help" id="copyGradeResult" role="status">${escapeHtml(copy.box_notes || 'Take a photo of the whole box. Pro, or your own AI key.')}</p>
      </div>
      ${field({ id: 'copyLocation', label: 'Where it is', value: copy.storage_location || '', placeholder: 'Shelf, box, room…', maxlength: 500 })}
      ${field({ id: 'copyNotes', label: 'Notes', value: copy.notes || '', placeholder: 'Box dents, receipt, signed…', maxlength: 500 })}
      <div class="bv-btn-row">
        ${isNew ? '' : '<button type="button" class="bv-btn bv-btn--danger" id="copyDelete">Remove copy</button>'}
        <button type="submit" class="bv-btn bv-btn--primary" id="copySave">${isNew ? 'Add copy' : 'Save'}</button>
      </div>
    </form>`,
  });
}

function sellSheetHTML(copy, ctx) {
  const today = new Date().toISOString().slice(0, 10);
  return sheetBody({
    title: 'Sell this copy',
    sub: [conditionLabel(copy.condition), copy.purchase_price != null ? t('copies.paid', { price: fmtMoney(copy.purchase_price) }) : ''].filter(Boolean).join(' · '),
    id: 'copySellSheet',
    inner: `<form class="bv-form" id="copySellForm" novalidate>
      ${field({ id: 'copySoldPrice', label: 'Sold for', placeholder: '0.00', mono: true, prefix: symbol(ctx), inputmode: 'decimal', autocomplete: 'off' })}
      <div class="bv-form-grid">
        <div class="bv-field"><label for="copySoldDate">Sale date</label><div class="bv-field__box"><input id="copySoldDate" type="date" value="${today}" max="${today}"></div></div>
        ${field({ id: 'copySoldFees', label: 'Fees and shipping', placeholder: '0', mono: true, prefix: symbol(ctx), inputmode: 'decimal', autocomplete: 'off' })}
      </div>
      <p class="bv-field__help">The other copies stay in your vault. Selling the last copy marks the set as sold.</p>
      <button type="submit" class="bv-btn bv-btn--primary bv-btn--full" id="copySellSave">${icon('tag', { size: 20 })}<span>Record sale</span></button>
    </form>`,
  });
}

/**
 * Mount the copies card into `root` for the holding `entry`. `onChange(item)`
 * runs after every change with the updated holding (null once sold out).
 */
export async function mountCopies(root, _set, entry, { onChange } = {}) {
  if (!root || !entry?.id) return;
  let copies = [];
  const base = `/api/collection/${encodeURIComponent(entry.id)}/copies`;

  const paint = () => {
    const differ = new Set(copies.map((c) => `${c.condition}|${c.purchase_price ?? ''}`)).size > 1;
    root.innerHTML = `<div class="bv-copies__head">
        <h3 class="bv-copies__title">Your copies <span class="bv-num">(${copies.length})</span></h3>
        <button type="button" class="bv-btn bv-btn--text bv-btn--sm" id="copyAdd">${icon('plus', { size: 18 })}<span>Add a copy</span></button>
      </div>
      <p class="bv-field__help">Track each copy on its own: condition, price paid, date and where it's kept. Sell one copy and keep the rest.</p>
      <ul class="bv-copies__list">${copies.map(copyRowHTML).join('')}</ul>`;
    // Purchase price and condition below apply to every copy; once copies
    // differ, those shared fields would overwrite them, so lock them.
    for (const id of ['mPrice', 'mCondition']) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.disabled = differ;
      el.title = differ ? 'Set this per copy in Your copies' : '';
    }
    const hint = document.getElementById('copiesDifferHint');
    if (hint) hint.hidden = !differ;
  };

  const apply = (res) => {
    copies = res.copies || [];
    if (res.item) paint();
    onChange?.(res.item || null);
  };

  const openEdit = (copy, isNew) => {
    const ctx = capturedMoneyContext();
    showSheet(editSheetHTML(copy, ctx, isNew));
    let boxNotes = copy.box_notes || null;
    document.getElementById('copyGradePhoto')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      const out = document.getElementById('copyGradeResult');
      const label = document.getElementById('copyGradeBtn');
      label?.classList.add('is-loading');
      if (out) out.textContent = 'Looking at the box…';
      try {
        const image = await resizeImage(await readFileAsDataURL(file), 1280);
        const r = await api('/api/grade/box', { method: 'POST', body: { image, set_num: entry.set_num }, retry: false });
        if (!r.is_box || !r.grade) {
          if (out) out.textContent = r.summary || 'That does not look like a LEGO box. Try again with the whole box in view.';
          return;
        }
        document.getElementById('copyBoxGrade').value = r.grade;
        boxNotes = [r.summary, ...(r.issues || [])].filter(Boolean).join(' · ').slice(0, 500) || null;
        if (out) {
          out.textContent = [
            t('copies.boxGrade', { grade: boxGradeLabel(r.grade) }),
            r.seal_intact === true ? 'Seals intact' : r.seal_intact === false ? 'Seals broken' : '',
            r.price_share != null && r.price_share < 1 ? t('copies.boxShare', { share: Math.round(r.price_share * 100) }) : '',
            boxNotes || '',
          ].filter(Boolean).join(' · ');
        }
        haptic('light');
      } catch (err) {
        if (err?.status === 402) {
          if (out) out.innerHTML = `${escapeHtml('Box grading comes with Pro, or add your own Gemini key in Settings.')} <a href="#/pro">Pro</a>`;
        } else if (out) out.textContent = err?.message || 'Could not grade this photo.';
      } finally {
        label?.classList.remove('is-loading');
      }
    });
    document.getElementById('copyForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const price = localMoneyToUsd(document.getElementById('copyPrice')?.value, ctx);
      if (!price.valid) { toast('Enter a valid price.', 'error'); return; }
      const body = {
        condition: document.getElementById('copyCondition').value,
        purchase_price: price.blank ? null : Math.round(price.usd * 100) / 100,
        purchased_at: document.getElementById('copyDate').value || null,
        acquisition_source: document.getElementById('copySource').value || null,
        storage_location: document.getElementById('copyLocation').value.trim() || null,
        notes: document.getElementById('copyNotes').value.trim() || null,
        box_grade: document.getElementById('copyBoxGrade').value || null,
        box_notes: boxNotes,
      };
      const btn = document.getElementById('copySave');
      setBtnLoading(btn, true);
      try {
        const res = await api(isNew ? base : `${base}/${copy.id}`, { method: isNew ? 'POST' : 'PATCH', body });
        hideSheet();
        haptic('light');
        apply(res);
        toast(isNew ? 'Copy added' : 'Copy saved', 'success');
      } catch (err) {
        setBtnLoading(btn, false);
        toast(err?.message || 'Could not save the copy.', 'error');
      }
    });
    document.getElementById('copyDelete')?.addEventListener('click', async () => {
      if (copies.length <= 1) { toast('This is the only copy. Remove the set instead.', 'error'); return; }
      const ok = await confirmSheet({ title: 'Remove this copy?', message: 'Its price, date and notes will be deleted.', confirmLabel: 'Remove', danger: true });
      if (!ok) return;
      try {
        apply(await api(`${base}/${copy.id}`, { method: 'DELETE' }));
        toast('Copy removed', 'success');
      } catch (err) { toast(err?.message || 'Could not remove the copy.', 'error'); }
    });
  };

  const openSell = (copy) => {
    const ctx = capturedMoneyContext();
    showSheet(sellSheetHTML(copy, ctx));
    document.getElementById('copySellForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const price = localMoneyToUsd(document.getElementById('copySoldPrice')?.value, ctx, { required: true, positive: true });
      const fee = localMoneyToUsd(document.getElementById('copySoldFees')?.value, ctx);
      if (!price.valid) { toast('Enter the price it sold for.', 'error'); return; }
      if (!fee.valid || (!fee.blank && fee.usd >= price.usd)) { toast('Fees must be below the sale price.', 'error'); return; }
      const body = { sold_price: Math.round(price.usd * 100) / 100, sold_at: document.getElementById('copySoldDate').value };
      if (!fee.blank && fee.usd > 0) body.sold_fees = Math.round(fee.usd * 100) / 100;
      const btn = document.getElementById('copySellSave');
      setBtnLoading(btn, true);
      try {
        const res = await api(`${base}/${copy.id}/sell`, { method: 'POST', body });
        hideSheet();
        haptic('heavy');
        toast(t('copies.soldToast', { price: fmtMoney(body.sold_price) }), 'success');
        apply(res);
      } catch (err) {
        setBtnLoading(btn, false);
        toast(err?.message || 'Could not record the sale.', 'error');
      }
    });
  };

  root.addEventListener('click', (e) => {
    if (e.target.closest('#copyAdd')) {
      const last = copies[copies.length - 1] || entry;
      openEdit({ condition: last.condition || 'sealed', purchase_price: null, purchased_at: null, acquisition_source: null, storage_location: last.storage_location || null, notes: null }, true);
      return;
    }
    const row = e.target.closest('[data-copy-id]');
    if (!row) return;
    const copy = copies.find((c) => String(c.id) === row.dataset.copyId);
    if (!copy) return;
    if (e.target.closest('[data-copy-edit]')) openEdit(copy, false);
    else if (e.target.closest('[data-copy-sell]')) openSell(copy);
  });

  try {
    const res = await api(base);
    copies = res.copies || [];
    paint();
  } catch {
    root.innerHTML = '<p class="bv-field__help">Copies could not load. Pull to refresh and try again.</p>';
  }
}
