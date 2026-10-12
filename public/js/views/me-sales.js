// Sales & taxes (#/me/sales): every sale the collector recorded, per year —
// proceeds, fees, cost of the units sold and the realized gain split into
// long-term (held over a year) and short-term. The yearly summary is open to
// everyone; the per-sale list and the CSV / PDF report are Pro. Below it, the
// public "value check": how close our values were to what collectors actually
// sold for. Data: GET /api/sales and /api/sales/value-check.
import { $, $$, escapeHtml, haptic, toast, fmtMoney, capturedMoneyContext } from '../utils.js';
import { state } from '../state.js';
import { api } from '../api.js';
import { t } from '../lib/i18n.js';
import { topbar, btn, card, seg, skeletonRows } from '../ui/kit.js';
import { confirmSheet } from '../components/sheet.js';
import { getCapacitorPlugin, isNativeCapacitor } from '../lib/native-auth.js';
import { loadMe } from './me-shared.js';

const onScreen = () => location.hash.split('?')[0] === '#/me/sales';
let year = null;
let data = null;
let check = null;

const money = (usd) => fmtMoney(Number(usd) || 0, { cents: 0 });
const signed = (usd) => `${Number(usd) > 0 ? '+' : Number(usd) < 0 ? '−' : ''}${fmtMoney(Math.abs(Number(usd) || 0), { cents: 0 })}`;
const tone = (usd) => (Number(usd) > 0.5 ? 'bv-up' : Number(usd) < -0.5 ? 'bv-down' : '');

function summaryHTML(s) {
  const line = (label, value, cls = '') => `<div class="bv-sales__line"><span>${escapeHtml(label)}</span><span class="bv-num ${cls}">${escapeHtml(value)}</span></div>`;
  return card(`
    <div class="bv-sales__hero"><span class="bv-label">Realized gain</span><span class="bv-num bv-sales__big ${tone(s.gain)}">${escapeHtml(signed(s.gain))}</span></div>
    ${line('Sales', String(s.sales))}
    ${line('Proceeds', money(s.proceeds))}
    ${line('Fees and shipping', money(s.fees))}
    ${line('Cost of what you sold', money(s.cost))}
    <div class="bv-sales__split">
      ${line('Long-term (held over a year)', signed(s.long_term_gain), tone(s.long_term_gain))}
      ${line('Short-term', signed(s.short_term_gain), tone(s.short_term_gain))}
      ${s.unknown_term_gain ? line('No purchase date', signed(s.unknown_term_gain), tone(s.unknown_term_gain)) : ''}
    </div>
    ${s.missing_cost ? `<p class="bv-field__help">Some sales have no price paid recorded, so they count in proceeds but not in the gain. Add the price on the set page to include them.</p>` : ''}
  `, { cls: 'bv-sales__summary' });
}

function rowsHTML(rows) {
  if (!rows.length) return `<p class="bv-foot">No sales recorded this year.</p>`;
  return `<ul class="bv-sales__list">${rows.map((r) => `<li class="bv-sales__row" data-sale="${Number(r.id)}">
      <span class="bv-sales__body">
        <a class="bv-sales__name" href="#/set/${encodeURIComponent(r.set_num)}">${escapeHtml(r.name || r.set_num)}</a>
        <span class="bv-sales__meta">${escapeHtml([r.sold_at, r.set_num, Number(r.quantity) > 1 ? `×${r.quantity}` : '', r.term === 'long' ? t('sales.longTerm') : r.term === 'short' ? t('sales.shortTerm') : ''].filter(Boolean).join(' · '))}</span>
        <span class="bv-sales__meta">${escapeHtml([t('sales.net', { amount: money(r.net_proceeds) }), r.cost_basis != null ? t('sales.cost', { amount: money(r.cost_basis) }) : t('sales.costMissing')].join(' · '))}</span>
      </span>
      <span class="bv-num bv-sales__gain ${tone(r.gain)}">${escapeHtml(r.gain == null ? '—' : signed(r.gain))}</span>
      <button type="button" class="bv-btn bv-btn--text bv-btn--sm" data-sale-remove aria-label="Remove this sale">Remove</button>
    </li>`).join('')}</ul>`;
}

function checkHTML(c) {
  if (!c) return '';
  const body = c.ready
    ? `<p>${escapeHtml(t('sales.checkReady', { sales: Number(c.sales), w10: Number(c.within_10_pct), w20: Number(c.within_20_pct), miss: Number(c.median_abs_error_pct) }))}</p>`
    : `<p>${escapeHtml(t('sales.checkPending', { min: Number(c.min_sales), sales: Number(c.sales) }))}</p>`;
  return `<h2 class="bv-h2">How close our values are</h2>${card(`${body}<p class="bv-field__help">Each sale is compared with the value we showed on the day it sold. Every sale you record makes this check, and our prices, more accurate.</p>`, { cls: 'bv-sales__check' })}`;
}

function paint(me) {
  const root = $('#root');
  if (!root || !onScreen()) return;
  const years = data.years || [year];
  root.innerHTML = `<main class="bv-page no-nav bv-sales" id="salesPage">
      ${topbar({ title: 'Sales & taxes', sub: 'Realized gains by year', back: '#/me' })}
      ${years.length > 1 ? `<div class="bv-sales__years">${seg(years.slice(0, 6).map((y) => ({ label: String(y), value: String(y), current: y === data.year, attrs: { 'data-year': String(y) } })), { label: 'Tax year' })}</div>` : ''}
      ${summaryHTML(data.summary)}
      <h2 class="bv-h2">${escapeHtml(t('sales.salesIn', { year: String(data.year) }))}</h2>
      ${data.pro
        ? `${rowsHTML(data.rows || [])}
           <div class="bv-btn-row bv-sales__actions">
             ${btn('Download CSV', { kind: 'outline', icon: 'download', id: 'salesCsv', disabled: !data.rows?.length })}
             ${btn('Save PDF report', { icon: 'download', id: 'salesPdf', disabled: !data.rows?.length })}
           </div>`
        : card(`<p>${escapeHtml(t('sales.locked'))}</p>${btn('Unlock with Pro', { icon: 'star', href: '#/pro', full: true })}`, { cls: 'bv-sales__locked' })}
      <p class="bv-foot">Long-term means held more than a year. Tax rules differ by country, so this is a record of your numbers, not tax advice.</p>
      ${checkHTML(check)}
    </main>`;
  $$('#salesPage [data-year]').forEach((b) => b.addEventListener('click', () => {
    const y = Number(b.dataset.year);
    if (y === data.year) return;
    haptic('light');
    year = y;
    load(me);
  }));
  $('#salesCsv')?.addEventListener('click', () => exportFile('csv'));
  $('#salesPdf')?.addEventListener('click', () => exportFile('pdf'));
  $$('#salesPage [data-sale-remove]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.closest('[data-sale]')?.dataset.sale;
    const ok = await confirmSheet({ title: 'Remove this sale?', message: 'Use this for a sale recorded by mistake. The set does not come back to your vault.', confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    try {
      await api(`/api/sales/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('Sale removed', 'success');
      load(me);
    } catch (err) { toast(err?.message || 'Could not remove the sale.', 'error'); }
  }));
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function saveBytes(bytes, name, mime) {
  if (isNativeCapacitor()) {
    const Filesystem = getCapacitorPlugin('Filesystem');
    const Share = getCapacitorPlugin('Share');
    if (!Filesystem?.writeFile) throw new Error('File saving is unavailable');
    const res = await Filesystem.writeFile({ path: name, data: toBase64(bytes), directory: 'CACHE', recursive: true });
    await Share?.share?.({ title: name, files: [res.uri] });
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function exportFile(kind) {
  if (!data?.rows?.length) return;
  haptic('medium');
  try {
    const { salesCsv, salesPdf } = await import('../lib/sales-report.js');
    const ctx = capturedMoneyContext();
    const name = `bricksvault-sales-${data.year}.${kind}`;
    if (kind === 'csv') {
      await saveBytes(new TextEncoder().encode(salesCsv({ rows: data.rows, currency: ctx.currency || 'USD', rate: Number(ctx.rate) || 1 })), name, 'text/csv');
    } else {
      const bytes = salesPdf({
        owner: state.me?.display_name || 'Collector',
        year: data.year,
        summary: data.summary,
        rows: data.rows,
        money: (usd) => fmtMoney(Number(usd) || 0, { cents: 0 }),
        generated: `Generated ${new Date().toISOString().slice(0, 10)} by BricksVault`,
      });
      await saveBytes(bytes, name, 'application/pdf');
    }
    toast('Report ready', 'success');
  } catch (err) {
    toast(t('common.errorWithDetails', { error: err?.message || err }), 'error');
  }
}

async function load(me) {
  try {
    const [d, c] = await Promise.all([
      api(`/api/sales${year ? `?year=${year}` : ''}`),
      check ? Promise.resolve(check) : api('/api/sales/value-check').catch(() => null),
    ]);
    data = d;
    check = c;
    year = d.year;
    paint(me);
  } catch {
    const root = $('#root');
    if (!root || !onScreen()) return;
    root.innerHTML = `<main class="bv-page no-nav bv-sales">${topbar({ title: 'Sales & taxes', back: '#/me' })}
      <p class="bv-foot" role="alert">Sales could not load.</p>${btn(t('common.retry'), { icon: 'refresh', id: 'salesRetry', full: true })}</main>`;
    $('#salesRetry')?.addEventListener('click', () => load(me));
  }
}

export async function renderMeSales() {
  const root = $('#root');
  if (!root) return;
  root.innerHTML = `<main class="bv-page no-nav bv-sales" aria-busy="true">${topbar({ title: 'Sales & taxes', back: '#/me' })}<div class="bv-group__box bv-gap">${skeletonRows(3)}</div></main>`;
  const me = await loadMe();
  await load(me);
}
