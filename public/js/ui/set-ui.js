// Shared set / minifigure presentation for the 2026 redesign.
//
// Vault, Discover, Wishlist, What changed and the set page all show sets the
// same way: a brick placeholder tinted by theme with the photo layered on top,
// name, "Theme · number · Retired" meta, the canonical display value and a
// change chip. Keeping it here means one fix lands everywhere.
import { escapeHtml, fmtMoney, setHue, thumbImg } from '../utils.js';
import { displayValueOf } from '../lib/pure-core.js';
import { t } from '../lib/i18n.js';
import { thumb, delta, attrs, figSvg, icon } from './kit.js';

/** Placeholder tint for a set (stable per theme). */
export function setColor(set = {}) {
  return `hsl(${setHue(set)} 52% 56%)`;
}

/** Whole-currency amount in the user's currency ("$850"). */
export function money0(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return fmtMoney(Math.round(Number(value)), { cents: 0 });
}

/** Signed whole-currency amount ("+$42", "−$4"). */
export function moneySigned(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const v = Math.round(Number(value));
  return `${v < 0 ? '−' : '+'}${money0(Math.abs(v))}`;
}

/** The value every surface shows for a set (market → blended → current). */
export function setValue(set = {}) {
  return displayValueOf(set);
}

/** <img> for a set photo; the app's global loader reveals it over the tile. */
export function setImg(set = {}, width = 200) {
  const url = set.image_url;
  if (!url || typeof url !== 'string' || url.startsWith('data:')) return '';
  return `<img class="set-photo" src="${escapeHtml(thumbImg(url, width))}" alt="" loading="lazy" decoding="async">`;
}

/** Square set thumbnail (52dp in rows, larger on the set page). */
export function setThumb(set = {}, { size = 52, radius, cls = '' } = {}) {
  return thumb({ color: setColor(set), imgHtml: setImg(set, Math.min(400, size * 3)), size, radius, cls });
}

/** "Star Wars · 75192-1 · Retired" */
export function setMeta(set = {}, { retired = true } = {}) {
  const parts = [set.theme, set.set_num];
  if (retired && (set.retired === 1 || set.retired === true)) parts.push(t('bvCommon.retired'));
  return parts.filter(Boolean).join(' · ');
}

/** Percent gain of value over what was paid, or null when unknown. */
export function gainPct(value, paid) {
  const v = Number(value), p = Number(paid);
  if (!(p > 0) || !Number.isFinite(v)) return null;
  return ((v - p) / p) * 100;
}

/**
 * List row for a set. By default the trailing column shows the display value
 * and either the change vs purchase price or an "Add price" hint.
 */
export function setRow(set = {}, {
  href = `#/set/${encodeURIComponent(set.set_num || '')}`,
  value = setValue(set),
  valueHtml,
  deltaPct,
  hint,
  meta = setMeta(set),
  endHtml,
  id,
  cls = '',
  qty = 0,
  attrs: extra = {},
} = {}) {
  const chip = deltaPct != null && Number.isFinite(Number(deltaPct))
    ? delta(Number(deltaPct), { srUp: t('bvCommon.upPct', { pct: Math.abs(Number(deltaPct)).toFixed(1) }), srDown: t('bvCommon.downPct', { pct: Math.abs(Number(deltaPct)).toFixed(1) }) })
    : (hint ? `<span class="bv-setrow__hint">${escapeHtml(hint)}</span>` : '');
  const end = endHtml ?? `<span class="bv-setrow__end"><span class="bv-setrow__value">${valueHtml ?? escapeHtml(money0(value))}</span>${chip}</span>`;
  const name = `${escapeHtml(set.name || set.set_num || '')}${qty > 1 ? ` <span class="bv-pill bv-pill--ink">×${qty}</span>` : ''}`;
  return `<a class="bv-setrow${cls ? ` ${cls}` : ''}"${attrs({ href, id, 'data-set-num': set.set_num, ...extra })}>${setThumb(set)}`
    + `<span class="bv-setrow__body"><span class="bv-setrow__name">${name}</span><span class="bv-setrow__meta">${escapeHtml(meta)}</span></span>${end}</a>`;
}

/** Grid tile for a set (photo on top, name, meta, value). */
export function setTile(set = {}, { href = `#/set/${encodeURIComponent(set.set_num || '')}`, value = setValue(set), tagHtml = '', actionHtml = '', meta = setMeta(set, { retired: false }) } = {}) {
  return `<div class="bv-tile" data-set-num="${escapeHtml(set.set_num || '')}"><a class="bv-tile__link" href="${escapeHtml(href)}" aria-label="${escapeHtml(set.name || set.set_num || '')}"></a>`
    + `<span class="bv-tile__media">${`<svg class="bv-brick" viewBox="0 0 40 32" aria-hidden="true" style="width:56%;height:44%"><rect x="7" y="0" width="9" height="7" rx="2" fill="${setColor(set)}"/><rect x="24" y="0" width="9" height="7" rx="2" fill="${setColor(set)}"/><rect x="0" y="5" width="40" height="27" rx="4" fill="${setColor(set)}"/></svg>`}${setImg(set, 300)}${tagHtml ? `<span class="bv-tile__tag">${tagHtml}</span>` : ''}</span>`
    + `<span class="bv-tile__body"><span class="bv-tile__name">${escapeHtml(set.name || '')}</span><span class="bv-tile__meta">${escapeHtml(meta)}</span><span class="bv-tile__value">${escapeHtml(money0(value))}</span></span>${actionHtml}</div>`;
}

/** Minifigure placeholder colours when no photo exists. */
const FIG_TINTS = ['#3b3f48', '#d9502f', '#2f7fb3', '#7a4f2a', '#6b2b3a', '#c9a57a', '#1d1f22', '#b3462f'];
export function figTint(key = '') {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return FIG_TINTS[h % FIG_TINTS.length];
}

/** Grid tile for a minifigure. `photoUrl` is optional. */
export function figTile(fig = {}, { href = '#', value, meta = '', tagHtml = '', qty = 0, actionHtml = '', photoUrl } = {}) {
  const key = fig.fig_num || fig.name || '';
  const tint = figTint(key);
  const img = photoUrl ? `<img class="fig-photo" src="${escapeHtml(thumbImg(photoUrl, 240))}" alt="" loading="lazy" decoding="async">` : '';
  return `<div class="bv-tile bv-tile--fig"${attrs({ 'data-fig-num': fig.fig_num })}><a class="bv-tile__link" href="${escapeHtml(href)}" aria-label="${escapeHtml(fig.name || key)}"></a>`
    + `<span class="bv-tile__media">${figSvg({ torso: tint, legs: tint, size: 62 })}${img}${tagHtml ? `<span class="bv-tile__tag">${tagHtml}</span>` : ''}${qty > 1 ? `<span class="bv-tile__qty"><span class="bv-pill bv-pill--ink">×${qty}</span></span>` : ''}</span>`
    + `<span class="bv-tile__body"><span class="bv-tile__name">${escapeHtml(fig.name || key)}</span>${meta ? `<span class="bv-tile__meta">${escapeHtml(meta)}</span>` : ''}${value != null ? `<span class="bv-tile__value">${escapeHtml(money0(value))}</span>` : ''}</span>${actionHtml}</div>`;
}

/** Round add/owned toggle that sits on a tile's corner. */
export function tileAction({ owned = false, label, id, attrs: extra = {} } = {}) {
  return `<button type="button" class="bv-tile__act"${attrs({ id, 'aria-pressed': String(!!owned), 'aria-label': label, ...extra })}>${icon(owned ? 'check' : 'plus', { size: 18, stroke: 2.6 })}</button>`;
}
