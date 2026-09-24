// Vault-area markup helpers (2026 redesign): the shared top bar, the layout
// switch, sort button, option/action sheets and the set row / figure tile the
// Sets, Minifigs, Lists and Build tabs render. Built on ui/kit.js and
// ui/set-ui.js; screen styles live in the `area: vault` block of /bv.css.
//
// Escaping follows kit.js: plain text parameters are escaped here, `…Html`
// parameters are trusted markup the caller built.
import { escapeHtml, thumbImg, fmtMoney, getExchangeRate } from '../utils.js';
import { state } from '../state.js';
import { t } from '../lib/i18n.js';
import { estMark, marketValueForCondition, displayValueOf } from '../lib/pure.js';
import { showSheet, hideSheet } from '../components/sheet.js';
import { icon, iconBtn, topbar, searchBar, attrs, pill, figSvg, sheetBody, seg, delta, row as kitRow } from './kit.js';
import { setThumb, setMeta, figTint } from './set-ui.js';

const esc = (value) => escapeHtml(value == null ? '' : String(value));

/**
 * Per-copy value of a holding. Used holdings are worth their used-market
 * price; new/sealed keep the blended fair value via the shared displayValueOf
 * chain (market_value → blended_value → current_value) so the vault, room,
 * catalog and set page show ONE number.
 */
export function holdingValue(x) {
  if (String(x?.condition || '').startsWith('used')) {
    return Number(marketValueForCondition(x, x.condition)) || displayValueOf(x);
  }
  return displayValueOf(x);
}

/** Vault root top bar: large title, search toggle and "More options". */
export function vaultTopbar({ title = t('nav.vault'), searchOpen = false, searchLabel = t('bvVault.searchVault'), searchControls = 'vaultSearchRow', moreLabel = t('bvVault.moreOptions') } = {}) {
  const search = iconBtn({ icon: searchOpen ? 'x' : 'search', label: searchOpen ? t('bvVault.closeSearch') : searchLabel, id: 'vaultSearchBtn', attrs: { 'aria-expanded': String(!!searchOpen), 'aria-controls': searchControls } });
  const more = iconBtn({ icon: 'more', label: moreLabel, id: 'vaultMoreBtn', attrs: { 'aria-haspopup': 'dialog' } });
  return topbar({ title, actionsHtml: search + more });
}

/** Inline search field shown under the top bar while searching. */
export function vaultSearchRow({ id, value = '', placeholder, label, name, rowId = 'vaultSearchRow', hidden = false } = {}) {
  return `<div class="vault-search" id="${esc(rowId)}"${hidden ? ' hidden' : ''}>${searchBar({ id, value, placeholder, label, name })}</div>`;
}

/** Sort trigger: "⇅ Value ▾". */
export function sortButton(label, { id = 'vaultSortBtn' } = {}) {
  return `<button type="button" class="vault-sort"${attrs({ id, 'aria-haspopup': 'dialog', 'aria-label': t('bvVault.sortCurrent', { sort: label }) })}>${icon('sort', { size: 18 })}<span>${esc(label)}</span>${icon('down', { size: 16 })}</button>`;
}

/** List | Grid | Room segmented control (Room opens the 3D room). */
export function layoutSeg(current = 'list') {
  const items = [
    { value: 'list', label: t('bvVault.layoutList'), ariaLabel: t('bvVault.layoutList'), icon: 'list', current: current === 'list', attrs: { 'data-layout': 'list' } },
    { value: 'grid', label: t('bvVault.layoutGrid'), ariaLabel: t('bvVault.layoutGrid'), icon: 'grid', current: current === 'grid', attrs: { 'data-layout': 'grid' } },
    { href: '#/room', label: t('bvVault.layoutRoom'), ariaLabel: t('bvVault.layoutRoom'), icon: 'room', current: false, attrs: { 'data-vault-view': 'room' } },
  ];
  return seg(items, { label: t('bvVault.layout'), full: false, cls: 'vault-layout' });
}

/** Toolbar row: sort on the left, whatever else on the right. */
export function vaultToolbar(leftHtml, rightHtml = '') {
  return `<div class="vault-toolbar">${leftHtml}${rightHtml}</div>`;
}

/**
 * Radio list in a bottom sheet (sort orders, series, …). `onPick(value)` runs
 * after the sheet closes.
 */
export function openChoiceSheet({ title, options = [], current, onPick, sub }) {
  const rows = options.map((o) => {
    const on = o.value === current;
    return `<button type="button" class="bv-row vault-choice" role="radio"${attrs({ 'aria-checked': String(on), 'data-choice': o.value })}>`
      + `<span class="bv-row__text"><span class="bv-row__title">${esc(o.label)}</span>${o.sub ? `<span class="bv-row__sub">${esc(o.sub)}</span>` : ''}</span>`
      + `<span class="vault-choice__mark" aria-hidden="true">${on ? icon('check', { size: 22 }) : ''}</span></button>`;
  }).join('');
  showSheet(sheetBody({ title, sub, inner: `<div class="bv-group__box vault-choices" role="radiogroup"${attrs({ 'aria-label': title })}>${rows}</div>` }));
  document.querySelectorAll('#sheet [data-choice]').forEach((btn) => btn.addEventListener('click', () => {
    const value = btn.getAttribute('data-choice');
    hideSheet();
    onPick?.(value);
  }));
}

/**
 * Action list in a bottom sheet ("More options"). groups: [{ title?, rows: [
 * { id, icon, label, sub, href, onClick, danger, trail } ] }]. Link rows close
 * the sheet through navigation; button rows close it, then run.
 */
export function openActionSheet({ title, sub, groups = [], id = 'vaultMoreSheet' }) {
  const handlers = new Map();
  let n = 0;
  const body = groups.filter((g) => g && g.rows?.some(Boolean)).map((g) => {
    const rows = g.rows.filter(Boolean).map((r) => {
      const key = `a${n++}`;
      if (r.onClick) handlers.set(key, r.onClick);
      return kitRow({ icon: r.icon, title: r.label, sub: r.sub, href: r.href, id: r.id, danger: r.danger, trail: r.trail, chevron: !!r.href, attrs: { 'data-action': key } });
    }).join('');
    return `<section class="vault-actions">${g.title ? `<h3 class="vault-actions__title">${esc(g.title)}</h3>` : ''}<div class="bv-group__box">${rows}</div></section>`;
  }).join('');
  showSheet(sheetBody({ title, sub, id, inner: body }));
  document.querySelectorAll('#sheet [data-action]').forEach((el) => el.addEventListener('click', (event) => {
    const fn = handlers.get(el.getAttribute('data-action'));
    if (!fn) { hideSheet(); return; }
    event.preventDefault();
    hideSheet();
    fn(event);
  }));
}

/**
 * Whole units of the user's currency. set-ui's money0 rounds the USD amount
 * before converting, which leaves cents on screen in other currencies ("€80.96");
 * this rounds after conversion so every Vault figure is whole.
 */
export function moneyWhole(value) {
  const v = Number(value);
  if (value == null || !Number.isFinite(v)) return '—';
  let currency = state.me?.currency;
  if (!currency) {
    try { currency = JSON.parse(localStorage.getItem('bv_guest_prefs') || '{}')?.currency || localStorage.getItem('bv_currency'); } catch { currency = null; }
  }
  const rate = getExchangeRate(currency || 'USD') || 1;
  return fmtMoney(Math.round(v * rate) / rate, { cents: 0 });
}
/** Signed whole units ("+$42", "−$4"). */
export function moneyWholeSigned(value) {
  const v = Number(value);
  if (value == null || !Number.isFinite(v)) return '—';
  const text = moneyWhole(Math.abs(v));
  return `${v < 0 ? '−' : '+'}${text}`;
}

/** "~$850" for formula estimates, "$850" for market values. */
export function valueText(item, value) {
  return `${estMark(item)}${moneyWhole(value)}`;
}

/**
 * Vault list row. Same anatomy as set-ui's setRow, but the whole row is one
 * stretched link (or a checkbox in selection mode) so the "Add price" hint can
 * be its own 48dp link to the "Your copy" editor.
 */
export function vaultSetRow(item, { value, deltaPct, hintHref, hintLabel = t('bvVault.addPrice'), selecting = false, selected = false, qty = 1, id } = {}) {
  const setNum = item.set_num || '';
  const href = `#/set/${encodeURIComponent(setNum)}`;
  const name = esc(item.name || setNum);
  const chip = deltaPct != null && Number.isFinite(Number(deltaPct))
    ? delta(Number(deltaPct), { srUp: t('bvCommon.upPct', { pct: Math.abs(Number(deltaPct)).toFixed(1) }), srDown: t('bvCommon.downPct', { pct: Math.abs(Number(deltaPct)).toFixed(1) }) })
    : (hintHref && !selecting ? `<a class="bv-setrow__hint vault-row__hint" href="${esc(hintHref)}">${esc(hintLabel)}</a>` : '');
  const main = selecting
    ? `<button type="button" class="vault-row__link" role="checkbox" aria-checked="${selected ? 'true' : 'false'}">${name}</button>`
    : `<a class="vault-row__link" href="${esc(href)}">${name}</a>`;
  const check = selecting ? `<span class="vault-row__check" aria-hidden="true">${selected ? icon('check', { size: 16, stroke: 3 }) : ''}</span>` : '';
  return `<div class="bv-setrow vault-row${selected ? ' is-selected' : ''}"${attrs({ 'data-set-num': setNum, 'data-id': id ?? (item.id || setNum) })}>`
    + `<span class="vault-row__thumb">${setThumb(item)}${check}</span>`
    + `<span class="bv-setrow__body"><span class="bv-setrow__name">${main}${qty > 1 ? ` <span class="bv-pill bv-pill--ink">×${qty}</span>` : ''}</span><span class="bv-setrow__meta">${esc(setMeta(item))}</span></span>`
    + `<span class="bv-setrow__end"><span class="bv-setrow__value">${esc(valueText(item, value))}</span>${chip}</span></div>`;
}

/** Collectible-figure rarity label (existing catalogue keys). */
export function rarityLabel(rarity) {
  const value = String(rarity || 'common').toLowerCase();
  const suffix = value[0].toUpperCase() + value.slice(1);
  return t(`minifigs.filterSummaryRarity${suffix}`);
}

/** Legendary / Rare pill; common and uncommon figures carry none. */
export function rarityPill(rarity) {
  const r = String(rarity || '').toLowerCase();
  if (r === 'legendary') return pill(rarityLabel(r), 'acc');
  if (r === 'rare') return pill(rarityLabel(r), 'info');
  return '';
}

/** Figure illustration with the real photo layered on top when one exists. */
export function figArtHtml(fig = {}, { size = 62, width = 240 } = {}) {
  const tint = figTint(fig.fig_num || fig.name || '');
  const img = fig.image_url ? `<img class="fig-photo" src="${esc(thumbImg(String(fig.image_url), width))}" alt="" loading="lazy" decoding="async">` : '';
  return `${figSvg({ torso: tint, legs: tint, size })}${img}`;
}

/**
 * Minifigure grid tile that opens the figure sheet (a button, not a link).
 * `valueHtml` replaces the value line (e.g. a scarcity fact when unpriced).
 */
export function vaultFigTile(fig = {}, { meta = '', value, valueHtml, qty = 0, actionHtml = '', label } = {}) {
  const name = fig.name || fig.fig_num || '';
  const rar = rarityPill(fig.rarity);
  const valueLine = valueHtml != null ? valueHtml : (value > 0 ? `<span class="bv-tile__value">${esc(moneyWhole(value))}</span>` : '');
  return `<div class="bv-tile bv-tile--fig vault-fig"${attrs({ 'data-fig-num': fig.fig_num })}>`
    + `<button type="button" class="bv-tile__link" data-fig-open${attrs({ 'aria-label': label || name })}></button>`
    + `<span class="bv-tile__media">${figArtHtml(fig)}${rar ? `<span class="bv-tile__tag">${rar}</span>` : ''}${qty > 1 ? `<span class="bv-tile__qty"><span class="bv-pill bv-pill--ink">×${qty}</span></span>` : ''}</span>`
    + `<span class="bv-tile__body"><span class="bv-tile__name">${esc(name)}</span>${meta ? `<span class="bv-tile__meta">${esc(meta)}</span>` : ''}${valueLine}</span>${actionHtml}</div>`;
}

/** Thin card row linking elsewhere, e.g. "Missing price paid · 1 ›". */
export function countRow({ label, count, href, id, attrs: extra = {} }) {
  const tag = href ? 'a' : 'button';
  return `<${tag} class="vault-count-row"${attrs({ href, type: href ? null : 'button', id, ...extra })}><span>${esc(label)}</span><span class="vault-count-row__trail"><span class="bv-num">${esc(count)}</span>${icon('chev', { size: 18 })}</span></${tag}>`;
}
