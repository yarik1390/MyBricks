import { escapeHtml, fmtMoney } from '../utils.js';
import { whatIfLaunch } from '../lib/pure.js';
import { t, tPlural } from '../lib/i18n.js';

// Set page "What if you'd bought it at launch?": launch retail vs today's
// value vs the same money left in savings. Only real numbers — launch price
// and today's value — plus the 2-year forecast when the set has one.

const RATE = 0.03;

export function whatIfHTML(set, value, forecast2y = 0) {
  if (set?.coming_soon) return '';
  const w = whatIfLaunch({ rrp: set?.retail_price, year: set?.year, value, rate: RATE });
  if (!w) return '';
  const money = v => fmtMoney(v, { cents: 0 });
  const max = Math.max(w.value, w.savings, w.rrp);
  const row = (label, amount, cls) => `<div class="bv-whatif__row${cls ? ` bv-whatif__row--${cls}` : ''}">
      <span class="bv-whatif__lbl">${escapeHtml(label)}</span>
      <span class="bv-whatif__bar"><span style="width:${Math.max(4, (amount / max) * 100).toFixed(1)}%"></span></span>
      <span class="bv-whatif__amt">${escapeHtml(money(amount))}</span>
    </div>`;
  const pct = `${w.gainPct >= 0 ? '+' : '−'}${Math.abs(w.gainPct).toFixed(0)}%`;
  const verdict = w.beatSavings ? t('fun.whatIfBeat') : t('fun.whatIfLost');
  const nextYear = new Date().getUTCFullYear() + 2;
  return `<section class="bv-card bv-whatif" id="whatIfCard" aria-labelledby="whatIfTitle">
    <h3 class="bv-whatif__title" id="whatIfTitle">${escapeHtml(t('fun.whatIfTitle'))}</h3>
    <p class="bv-whatif__lead">${escapeHtml(t('fun.whatIfLead', { year: String(set.year), paid: money(w.rrp), value: money(w.value) }))} <strong class="bv-whatif__pct${w.gainPct >= 0 ? '' : ' bv-whatif__pct--down'}">${escapeHtml(pct)}</strong></p>
    ${row(t('fun.whatIfSet'), w.value, 'set')}
    ${row(t('fun.whatIfSavings', { rate: String(RATE * 100) }), w.savings)}
    ${row(t('fun.whatIfCash'), w.rrp)}
    <p class="bv-whatif__note">${escapeHtml(verdict)}${forecast2y > 0 ? ` ${escapeHtml(t('fun.whatIfForecast', { year: String(nextYear), value: money(forecast2y) }))}` : ''}</p>
    <p class="bv-whatif__fine">${escapeHtml(tPlural('fun.whatIfFine', w.years, { perYear: `${w.perYearPct >= 0 ? '+' : '−'}${Math.abs(w.perYearPct).toFixed(1)}%`}))}</p>
  </section>`;
}
