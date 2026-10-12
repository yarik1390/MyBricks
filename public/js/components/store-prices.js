// "Compare stores" on the set page: today's price at LEGO.com, Walmart and
// Target when we hold one (cheapest in stock first), plus links to check the
// price anywhere else. Data: GET /api/stores/:setnum (worker/src/routes/stores.ts).
// Store prices are US prices in USD; fmtMoney shows them in the user's currency.
import { escapeHtml, fmtMoney } from '../utils.js';
import { api } from '../api.js';
import { icon, pill } from '../ui/kit.js';
import { t } from '../lib/i18n.js';

function offerRowHTML(o, best, value) {
  const below = value > 0 && o.in_stock ? Math.round((1 - o.price / value) * 100) : null;
  const note = !o.in_stock ? t('stores.outOfStock')
    : below != null && below >= 5 ? t('stores.belowValue', { pct: below })
    : below != null && below <= -5 ? t('stores.aboveValue', { pct: -below })
    : '';
  return `<li class="bv-stores__row${o.in_stock ? '' : ' is-out'}">
    <a class="bv-stores__link" href="${escapeHtml(o.url)}" target="_blank" rel="noopener sponsored">
      <span class="bv-stores__name">${escapeHtml(o.label)}${best ? ` ${pill(t('stores.best'), 'acc')}` : ''}</span>
      ${note ? `<span class="bv-stores__note">${escapeHtml(note)}</span>` : ''}
      <span class="bv-num bv-stores__price">${escapeHtml(fmtMoney(o.price))}</span>
      ${icon('ext', { size: 16 })}
    </a>
  </li>`;
}

export function storePricesHTML(data) {
  const offers = data?.offers || [];
  const links = data?.links || [];
  if (!offers.length && !links.length) return '';
  const value = Number(data.value) || 0;
  const bestIndex = offers.findIndex((o) => o.in_stock);
  return `<section class="detail-card bv-stores" aria-labelledby="storesTitle">
    <div class="detail-card-title" id="storesTitle">Compare stores</div>
    ${offers.length
      ? `<ul class="bv-stores__list">${offers.map((o, i) => offerRowHTML(o, i === bestIndex, value)).join('')}</ul>`
      : '<p class="bv-stores__empty">No store has a price for this set today.</p>'}
    ${links.length ? `<div class="bv-stores__more"><span class="bv-label">Check the price at</span>
      <div class="bv-stores__chips">${links.map((l) => `<a class="bv-chip" href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.label)}${icon('ext', { size: 14 })}</a>`).join('')}</div></div>` : ''}
    ${offers.length ? '<p class="bv-stores__foot">US store prices, checked daily, before tax and shipping.</p>' : ''}
  </section>`;
}

/** Fill `el` with the card; silent on failure (the set page must not depend on it). */
export async function mountStorePrices(el, setNum) {
  if (!el) return;
  try {
    const data = await api(`/api/stores/${encodeURIComponent(setNum)}`);
    if (!el.isConnected) return;
    el.innerHTML = storePricesHTML(data);
  } catch { el.innerHTML = ''; }
}
