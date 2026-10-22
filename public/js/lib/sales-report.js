// Sales & taxes exports (views/me-sales.js): a CSV for a spreadsheet or an
// accountant, and a one-table A4 PDF built on the device with pdf-writer.js.
// Amounts arrive in USD and are converted to the collector's currency by the
// `money` formatter the caller passes; the CSV carries plain numbers in that
// currency plus the currency code, so a spreadsheet can sum them.
import { PdfDocument, A4, winAnsiSupported } from './pdf-writer.js';

// English report wording. Callers pass `label` built from the salesReport
// locale strings; anything missing falls back to these.
export const SALES_REPORT_EN = {
  soldOn: 'Sold on', setNumber: 'Set number', set: 'Set', quantity: 'Quantity', condition: 'Condition',
  boughtOn: 'Bought on', daysHeld: 'Days held', term: 'Term', salePrice: 'Sale price ({currency})',
  feesCol: 'Fees ({currency})', netCol: 'Net proceeds ({currency})', costCol: 'Cost ({currency})', gainCol: 'Gain ({currency})',
  longTerm: 'Long-term', shortTerm: 'Short-term',
  heading: 'BRICKSVAULT · SALES REPORT', docTitle: 'Sales {year}', sales: 'Sales', proceeds: 'Proceeds', fees: 'Fees',
  costSold: 'Cost of units sold', realizedGain: 'Realized gain', longTermHeld: 'Long-term (held over a year)',
  noPurchaseDate: 'No purchase date', missingCost: '{count} sale(s) have no price paid recorded and are left out of the gain.',
  colSold: 'Sold', colQty: 'Qty', colNet: 'Net proceeds', colCost: 'Cost', colGain: 'Gain',
  bought: 'bought {date}', longTermShort: 'long-term', shortTermShort: 'short-term',
  generated: 'Generated {date} by BricksVault', notTaxAdvice: "Not tax advice: check your country's rules.",
};

/** label(key, vars) over `strings`, English for missing keys. */
export function salesLabels(strings = {}) {
  return (key, vars = {}) => String(strings[key] || SALES_REPORT_EN[key] || key)
    .replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k])));
}

/** The PDF uses the built-in Helvetica (Latin only): Cyrillic, CJK and
 * Devanagari wording would come out transliterated or blank, so those
 * languages get the English PDF wording (the CSV is always translated). */
export function pdfLabels(strings = {}) {
  const all = Object.keys(SALES_REPORT_EN).every((k) => !strings[k] || winAnsiSupported(strings[k]));
  return salesLabels(all ? strings : {});
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * @param {{ rows: any[], currency: string, rate: number, label?: (key: string, vars?: any) => string }} input  rate = USD → currency
 */
export function salesCsv({ rows, currency, rate, label = salesLabels() }) {
  const conv = (usd) => (usd == null ? '' : (Math.round(Number(usd) * rate * 100) / 100).toFixed(2));
  const head = [label('soldOn'), label('setNumber'), label('set'), label('quantity'), label('condition'), label('boughtOn'), label('daysHeld'), label('term'),
    label('salePrice', { currency }), label('feesCol', { currency }), label('netCol', { currency }), label('costCol', { currency }), label('gainCol', { currency })];
  const lines = [head.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([
      r.sold_at, r.set_num, r.name || '', r.quantity, r.condition || '', r.purchased_at || '',
      r.held_days ?? '', r.term === 'long' ? label('longTerm') : r.term === 'short' ? label('shortTerm') : '',
      conv(r.sold_price), conv(r.sold_fees || 0), conv(r.net_proceeds), conv(r.cost_basis), conv(r.gain),
    ].map(csvCell).join(','));
  }
  // BOM: Excel opens a BOM-less CSV as ANSI and garbles non-Latin text.
  return `\uFEFF${lines.join('\n')}\n`;
}

const M = 40;
const INK = '#252820';
const MUTE = '#5b5f53';
const LINE = '#dadcd1';

/**
 * @param {{ owner: string, year: number, summary: any, rows: any[], money: (usd: number) => string, date: string, label?: (key: string, vars?: any) => string }} input
 * @returns {Uint8Array}
 */
export function salesPdf({ owner, year, summary, rows, money, date, label = salesLabels() }) {
  const doc = new PdfDocument({ title: `${label('docTitle', { year })} — ${owner}`, author: owner });
  const W = A4.width;
  const H = A4.height;
  const right = W - M;
  const bottom = H - M - 24;
  let page = doc.addPage();
  let y = M + 12;

  page.text(M, y, label('heading'), { size: 9, bold: true, color: '#6b5000' });
  y += 26;
  page.text(M, y, `${owner} · ${year}`, { size: 20, bold: true, maxWidth: right - M });
  y += 22;
  const lines = [
    [label('sales'), String(summary.sales)],
    [label('proceeds'), money(summary.proceeds)],
    [label('fees'), money(summary.fees)],
    [label('costSold'), money(summary.cost)],
    [label('realizedGain'), money(summary.gain)],
    [`  ${label('longTermHeld')}`, money(summary.long_term_gain)],
    [`  ${label('shortTerm')}`, money(summary.short_term_gain)],
  ];
  if (summary.unknown_term_gain) lines.push([`  ${label('noPurchaseDate')}`, money(summary.unknown_term_gain)]);
  page.rect(M, y, right - M, lines.length * 16 + 14, { fill: '#f7f5ee', stroke: LINE, lineWidth: 0.75 });
  y += 20;
  for (const [label, value] of lines) {
    page.text(M + 12, y, label, { size: 10, color: label.startsWith('  ') ? MUTE : INK });
    page.text(right - 12, y, value, { size: 10, bold: !label.startsWith('  '), align: 'right' });
    y += 16;
  }
  y += 12;
  if (summary.missing_cost) {
    page.text(M, y, label('missingCost', { count: summary.missing_cost }), { size: 9, color: MUTE, maxWidth: right - M });
    y += 16;
  }

  const cols = { date: M, set: M + 62, qty: right - 230, net: right - 160, cost: right - 85, gain: right };
  const header = () => {
    page.text(cols.date, y, label('colSold'), { size: 8.5, bold: true, color: MUTE });
    page.text(cols.set, y, label('set'), { size: 8.5, bold: true, color: MUTE });
    page.text(cols.qty, y, label('colQty'), { size: 8.5, bold: true, color: MUTE, align: 'right' });
    page.text(cols.net, y, label('colNet'), { size: 8.5, bold: true, color: MUTE, align: 'right' });
    page.text(cols.cost, y, label('colCost'), { size: 8.5, bold: true, color: MUTE, align: 'right' });
    page.text(cols.gain, y, label('colGain'), { size: 8.5, bold: true, color: MUTE, align: 'right' });
    y += 6;
    page.line(M, y, right, y, { color: INK, lineWidth: 0.75 });
    y += 14;
  };
  header();
  for (const r of rows) {
    if (y + 26 > bottom) {
      page = doc.addPage();
      y = M + 12;
      header();
    }
    page.text(cols.date, y, r.sold_at, { size: 9 });
    page.text(cols.set, y, `${r.name || r.set_num}`, { size: 9, bold: true, maxWidth: cols.qty - cols.set - 30 });
    page.text(cols.set, y + 11, [r.set_num, r.purchased_at ? label('bought', { date: r.purchased_at }) : '', r.term === 'long' ? label('longTermShort') : r.term === 'short' ? label('shortTermShort') : ''].filter(Boolean).join(' · '), { size: 7.5, color: MUTE, maxWidth: cols.qty - cols.set - 30 });
    page.text(cols.qty, y, String(r.quantity), { size: 9, align: 'right' });
    page.text(cols.net, y, money(r.net_proceeds), { size: 9, align: 'right' });
    page.text(cols.cost, y, r.cost_basis == null ? '—' : money(r.cost_basis), { size: 9, align: 'right' });
    page.text(cols.gain, y, r.gain == null ? '—' : money(r.gain), { size: 9, bold: true, align: 'right' });
    y += 24;
    page.line(M, y - 10, right, y - 10, { color: LINE, lineWidth: 0.5 });
  }

  doc.pages.forEach((p, i) => {
    p.text(M, H - M, `${label('generated', { date })} · ${label('notTaxAdvice')}`, { size: 7.5, color: MUTE, maxWidth: right - M - 60 });
    p.text(right, H - M, `${i + 1} / ${doc.pages.length}`, { size: 7.5, color: MUTE, align: 'right' });
  });
  return doc.toBytes();
}
