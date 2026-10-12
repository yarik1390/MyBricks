// "Compare stores" on the set page: today's price at LEGO.com, Walmart and
// Target (cheapest in stock first), what each store check found, the eBay
// asking price and BrickLink sales we already hold, plus links to
// check the price anywhere else. A set nobody checked recently is checked on
// the spot for signed-in members. Data: GET /api/stores/:setnum and
// POST /api/stores/:setnum/check (worker/src/routes/stores.ts).
// Store prices are US prices in USD; fmtMoney shows them in the user's currency.
import { escapeHtml, fmtMoney } from '../utils.js';
import { api, isGuestMode } from '../api.js';
import { state } from '../state.js';
import { icon, pill } from '../ui/kit.js';
import { t, tPlural } from '../lib/i18n.js';
import { amazonOfferIsFresh } from '../lib/amazon-affiliate.js';

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

// A marketplace figure we already hold: eBay's median asking price, or
// BrickLink's average recent new sale. Not a single listing, so no Best tag.
function marketRowHTML(m) {
  const note = m.kind === 'sold'
    ? (m.count ? tPlural('stores.blSold', m.count) : t('stores.blSoldPlain'))
    : (m.count ? tPlural('stores.ebayAsk', m.count) : t('stores.ebayAskPlain'));
  return `<li class="bv-stores__row">
    <a class="bv-stores__link" href="${escapeHtml(m.url)}" target="_blank" rel="noopener">
      <span class="bv-stores__name">${escapeHtml(m.label)}</span>
      <span class="bv-stores__note">${escapeHtml(note)}</span>
      <span class="bv-num bv-stores__price">${escapeHtml(fmtMoney(m.price))}</span>
      ${icon('ext', { size: 16 })}
    </a>
  </li>`;
}

// A store we checked (or are checking) that has no price to show.
function statusRowHTML(s, checking) {
  const note = t(checking ? 'stores.checking' : s.status === 'not_listed' ? 'stores.notListed' : 'stores.unchecked');
  return `<li class="bv-stores__row is-out"${checking ? ' aria-busy="true"' : ''}>
    <a class="bv-stores__link" href="${escapeHtml(s.url)}" target="_blank" rel="noopener">
      <span class="bv-stores__name">${escapeHtml(s.label)}</span>
      <span class="bv-stores__note">${escapeHtml(note)}</span>
      <span class="bv-stores__price">—</span>
      ${icon('ext', { size: 16 })}
    </a>
  </li>`;
}

// Amazon (Associates): a tagged search link, or the live Creators API price when
// one under 23 hours old is held. Off until the platform is approved
// (GET /api/sets/:set/amazon answers available: false).
function amazonRowHTML(a) {
  const price = a.mode === 'creators_api' && amazonOfferIsFresh(a) ? Number(a.price) : null;
  return `<li class="bv-stores__row">
    <a class="bv-stores__link" href="${escapeHtml(a.url)}" target="_blank" rel="sponsored nofollow noopener">
      <span class="bv-stores__name">Amazon</span>
      <span class="bv-stores__note">${escapeHtml(a.availability || '')}</span>
      <span class="bv-num bv-stores__price">${escapeHtml(new Intl.NumberFormat(undefined, { style: 'currency', currency: a.currency || 'EUR' }).format(price))}</span>
      ${icon('ext', { size: 16 })}
    </a>
  </li>`;
}

export function storePricesHTML(data, { checking = false, amazon = null } = {}) {
  const offers = data?.offers || [];
  const stores = data?.stores || [];
  const priced = new Set(offers.map((o) => o.store));
  const statusRows = stores.filter((s) => !priced.has(s.store));
  const market = data?.market || [];
  const links = (data?.links || []).filter((l) => !stores.some((s) => s.store === l.store) && !market.some((m) => m.store === l.store));
  const az = amazon?.available && amazon.url ? amazon : null;
  const azPriced = !!az && az.mode === 'creators_api' && amazonOfferIsFresh(az);
  if (az && !azPriced) links.push({ store: 'amazon', label: 'Amazon', url: az.url, sponsored: true });
  if (!offers.length && !statusRows.length && !market.length && !links.length && !azPriced) return '';
  const value = Number(data.value) || 0;
  const bestIndex = offers.findIndex((o) => o.in_stock);
  const usd = (state.me?.currency || 'USD') === 'USD';
  const usStores = stores.length > 0;
  return `<section class="detail-card bv-stores" aria-labelledby="storesTitle">
    <div class="detail-card-title" id="storesTitle">Compare stores</div>
    ${offers.length || statusRows.length || market.length || azPriced
      ? `<ul class="bv-stores__list">${offers.map((o, i) => offerRowHTML(o, i === bestIndex, value)).join('')}${azPriced ? amazonRowHTML(az) : ''}${statusRows.map((s) => statusRowHTML(s, checking && s.status === 'unchecked')).join('')}${market.map(marketRowHTML).join('')}</ul>`
      : '<p class="bv-stores__empty">No store has a price for this set today.</p>'}
    ${links.length ? `<div class="bv-stores__more"><span class="bv-label">Check the price at</span>
      <div class="bv-stores__chips">${links.map((l) => `<a class="bv-chip" href="${escapeHtml(l.url)}" target="_blank" rel="${l.sponsored ? 'sponsored nofollow noopener' : 'noopener'}">${escapeHtml(l.label)}${icon('ext', { size: 14 })}</a>`).join('')}</div></div>` : ''}
    ${usStores
      ? `<p class="bv-stores__foot">${usd
        ? 'Walmart and Target are US stores. Prices are checked daily, before tax and shipping.'
        : 'Walmart and Target are US stores, so their dollar prices are converted to your currency. Checked daily, before tax, shipping and import costs.'}</p>`
      : ''}
    ${market.length
      ? `<p class="bv-stores__foot">${usd
        ? 'eBay and BrickLink figures come from US listings and sales of new sets. Check the listing for its own price and shipping.'
        : 'eBay and BrickLink figures come from US listings and sales of new sets, converted to your currency. Check the listing for its own price and shipping.'}</p>`
      : ''}
    ${az ? `<p class="bv-stores__foot">${escapeHtml(az.disclosure || 'As an Amazon Associate, Brickvault earns from qualifying purchases.')}${azPriced && az.price_disclaimer ? ` ${escapeHtml(az.price_disclaimer)}` : ''}</p>` : ''}
  </section>`;
}

/** Fill `el` with the card; silent on failure (the set page must not depend on it). */
export async function mountStorePrices(el, setNum) {
  if (!el) return;
  try {
    const market = encodeURIComponent(state.me?.retail_market || 'FR');
    const [data, amazon] = await Promise.all([
      api(`/api/stores/${encodeURIComponent(setNum)}`),
      api(`/api/sets/${encodeURIComponent(setNum)}/amazon?market=${market}`, { retry: false }).catch(() => null),
    ]);
    if (!el.isConnected) return;
    const due = (data?.stores || []).some((s) => s.status === 'unchecked');
    const canCheck = due && !isGuestMode();
    el.innerHTML = storePricesHTML(data, { checking: canCheck, amazon });
    if (!canCheck) return;
    const fresh = await api(`/api/stores/${encodeURIComponent(setNum)}/check`, { method: 'POST', retry: false }).catch(() => null);
    if (!el.isConnected) return;
    el.innerHTML = storePricesHTML(fresh || data, { amazon });
  } catch { el.innerHTML = ''; }
}
