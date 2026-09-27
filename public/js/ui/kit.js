// BricksVault design-system markup helpers (2026 redesign).
//
// Pure string builders for the .bv-* components in /bv.css, so every screen
// renders the same buttons, chips, rows and cards. No DOM access, no state.
//
// Escaping convention: plain text parameters (label, title, sub, text …) are
// HTML-escaped here; parameters whose name ends in `Html` (and `inner`) are
// trusted markup the caller already built and escaped. Callers pass copy that
// is already localized with t() — this module owns no user-visible strings.
import { escapeHtml } from '../utils.js';
import { t } from '../lib/i18n.js';

const esc = (value) => escapeHtml(value == null ? '' : String(value));

// 24px outline icons, 2px stroke, round caps (Material Symbols–like geometry).
export const ICONS = {
  vault: '<path d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  heartFill: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill="currentColor"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  more: '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 9v6M11 9v6M14 9v6M17 9v6"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  chevL: '<path d="m15 6-6 6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  sort: '<path d="M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.5 2.5 2.5 13.5 0 16M12 4c-2.5 2.5-2.5 13.5 0 16"/>',
  palette: '<path d="M12 4a8 8 0 1 0 0 16c1.2 0 1.6-1 1-2-.8-1.4.2-3 1.8-3H17a3 3 0 0 0 3-3c0-4.4-3.6-8-8-8z"/><circle cx="8" cy="11" r="1"/><circle cx="11" cy="7.5" r="1"/><circle cx="15.5" cy="8.5" r="1"/>',
  db: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>',
  trophy: '<path d="M8 4h8v6a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 14v4M8 20h8"/>',
  star: '<path d="m12 4 2.4 5 5.6.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.6-.8z"/>',
  logout: '<path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5M10 16l-4-4 4-4M6 12h10"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  trend: '<path d="m4 16 5-5 4 4 7-7M15 8h5v5"/>',
  trendDown: '<path d="m4 8 5 5 4-4 7 7M15 16h5v-5"/>',
  kbd: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>',
  room: '<path d="M3 20h18M5 20V9l7-5 7 5v11M9 20v-6h6v6"/>',
  sparkle: '<path d="M12 4v4M12 16v4M4 12h4M16 12h4M7 7l2 2M15 15l2 2M17 7l-2 2M9 15l-2 2"/>',
  flash: '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  alert: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  tag: '<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z"/>',
  cloudOff: '<path d="M7 18h10M3 3l18 18M17.5 10A6 6 0 0 0 9 6.3M6 9.5A4.3 4.3 0 0 0 7 18"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>',
  shield: '<path d="M12 3 5 6v6c0 4.4 3 7.8 7 9 4-1.2 7-4.6 7-9V6z"/><path d="m9 12 2 2 4-4"/>',
  fig: '<circle cx="12" cy="6" r="3"/><path d="M8 10h8l1 6H7zM9 16v5M15 16v5"/>',
  brick: '<rect x="3" y="9" width="18" height="11" rx="1.5"/><path d="M7 9V7.5a2 2 0 0 1 4 0V9M13 9V7.5a2 2 0 0 1 4 0V9"/>',
  walk: '<circle cx="13" cy="4" r="2"/><path d="m9 21 2-7 3 3v5M7 12l3-4 4 1 3 3M11 14l-2-3"/>',
  send: '<path d="M4 12 20 4l-6 16-3-7z"/>',
  photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 8"/>',
  finger: '<path d="M12 11v5M8 9a4 4 0 0 1 8 0v4M5 10a7 7 0 0 1 14 0v2M9 13v3a3 3 0 0 0 6 0v-1"/>',
  game: '<rect x="3" y="7" width="18" height="11" rx="4"/><path d="M8 11v3M6.5 12.5h3M15 11h.01M17 13h.01"/>',
  kid: '<circle cx="12" cy="7" r="3"/><path d="M6 21v-3a6 6 0 0 1 12 0v3M9 13l-3-2M15 13l3-2"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  sheets: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M5 9h14M5 14h14M11 9v12"/>',
  wand: '<path d="m4 20 11-11M14 4v3M18 6h3M20 10v-2M17.5 3.5l1.5 1.5"/>',
  pie: '<path d="M12 3v9h9a9 9 0 1 1-9-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  admin: '<path d="M12 3 4 7v5c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V7z"/><path d="M12 8v5M12 16h.01"/>',
  box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  hand: '<path d="M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2-4a1.5 1.5 0 0 1 2.6-1.5L8 13"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
};

export function icon(name, { size = 24, stroke = 2, cls = '' } = {}) {
  const path = ICONS[name] || ICONS.info;
  return `<svg class="bv-ico${cls ? ` ${cls}` : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`;
}

// Build a trusted attribute string from a plain object. Values are escaped;
// `true` renders a bare attribute and null/false/undefined are skipped.
export function attrs(map = {}) {
  return Object.entries(map)
    .filter(([, v]) => v !== null && v !== undefined && v !== false)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`))
    .join('');
}

function tagFor(href) { return href ? 'a' : 'button'; }
function linkOrButton(href, type = 'button') { return href ? { href } : { type }; }

/** 48dp icon-only button; `label` becomes the accessible name. */
export function iconBtn({ icon: name, label, href, id, cls = '', tonal = false, pressed, attrs: extra = {} } = {}) {
  const tag = tagFor(href);
  const a = attrs({ ...linkOrButton(href), id, 'aria-label': label, 'aria-pressed': pressed === undefined ? null : String(!!pressed), ...extra });
  return `<${tag} class="bv-iconbtn${tonal ? ' bv-iconbtn--tonal' : ''}${cls ? ` ${cls}` : ''}"${a}>${icon(name)}</${tag}>`;
}

/** Button or link styled as a button. kind: primary | tonal | outline | ink | text | danger */
export function btn(label, { kind = 'primary', icon: name, href, id, full = false, size = '', type = 'button', cls = '', disabled = false, attrs: extra = {} } = {}) {
  const tag = tagFor(href);
  const classes = ['bv-btn', `bv-btn--${kind}`, full ? 'bv-btn--full' : '', size ? `bv-btn--${size}` : '', cls].filter(Boolean).join(' ');
  const a = attrs({ ...linkOrButton(href, type), id, disabled: disabled && !href ? true : null, 'aria-disabled': disabled && href ? 'true' : null, ...extra });
  return `<${tag} class="${classes}"${a}>${name ? icon(name, { size: 20, stroke: 2.2 }) : ''}${label ? `<span>${esc(label)}</span>` : ''}</${tag}>`;
}

/** Filter/sort chip. `pressed` toggles the filled state; `drop` adds a caret. */
export function chip(label, { pressed = false, icon: name, drop = false, href, id, cls = '', attrs: extra = {} } = {}) {
  const tag = tagFor(href);
  const a = attrs({ ...linkOrButton(href), id, 'aria-pressed': href ? null : String(!!pressed), 'aria-current': href && pressed ? 'true' : null, ...extra });
  return `<${tag} class="bv-chip${pressed && href ? ' is-on' : ''}${cls ? ` ${cls}` : ''}"${a}>${name ? icon(name, { size: 18 }) : ''}<span>${esc(label)}</span>${drop ? icon('down', { size: 16, cls: 'bv-chip__drop' }) : ''}</${tag}>`;
}

/**
 * Segmented control. items: [{ label, href?, value?, current, icon? }]
 * Links mark the current item with aria-current; buttons use aria-pressed.
 */
export function seg(items, { label, full = true, id, cls = '' } = {}) {
  const out = items.map((item) => {
    const tag = tagFor(item.href);
    const a = attrs({
      ...linkOrButton(item.href),
      'data-value': item.value,
      'aria-current': item.href ? (item.current ? 'true' : 'false') : null,
      'aria-pressed': item.href ? null : String(!!item.current),
      'aria-label': item.ariaLabel,
      ...(item.attrs || {}),
    });
    return `<${tag}${a}>${item.icon ? icon(item.icon, { size: 18 }) : ''}${item.label ? `<span>${esc(item.label)}</span>` : ''}</${tag}>`;
  }).join('');
  return `<div class="bv-seg${full ? ' bv-seg--full' : ''}${cls ? ` ${cls}` : ''}" role="group"${attrs({ id, 'aria-label': label })}>${out}</div>`;
}

/**
 * Underlined page tabs. items: [{ label, href?, value?, selected }]
 * With hrefs this is page navigation (nav + aria-current); without, an ARIA
 * tablist whose buttons carry aria-selected.
 */
export function tabs(items, { label, id, cls = '' } = {}) {
  const isNav = items.some((item) => item.href);
  const out = items.map((item) => {
    const tag = tagFor(item.href);
    const a = attrs({
      ...linkOrButton(item.href),
      role: isNav ? null : 'tab',
      'aria-selected': isNav ? null : String(!!item.selected),
      'aria-current': isNav && item.selected ? 'page' : null,
      'data-value': item.value,
      tabindex: isNav ? null : (item.selected ? '0' : '-1'),
      ...(item.attrs || {}),
    });
    return `<${tag}${a}>${esc(item.label)}</${tag}>`;
  }).join('');
  return isNav
    ? `<nav class="bv-tabs${cls ? ` ${cls}` : ''}"${attrs({ id, 'aria-label': label })}>${out}</nav>`
    : `<div class="bv-tabs${cls ? ` ${cls}` : ''}" role="tablist"${attrs({ id, 'aria-label': label })}>${out}</div>`;
}

/** Small status pill. kind: neutral | gain | loss | acc | info | ink | outline */
export function pill(text, kind = 'neutral', { icon: name, attrs: extra = {} } = {}) {
  return `<span class="bv-pill${kind !== 'neutral' ? ` bv-pill--${kind}` : ''}"${attrs(extra)}>${name ? icon(name, { size: 14, stroke: 2.4 }) : ''}${esc(text)}</span>`;
}

/**
 * Percentage change chip. `pct` is a percentage number (11.1 = +11.1%).
 * Direction is carried by sign AND colour, and spelled out for screen readers.
 */
export function delta(pct, { digits = 1, srUp = '', srDown = '' } = {}) {
  if (pct == null || !Number.isFinite(Number(pct))) return '';
  const v = Number(pct);
  const flat = Math.abs(v) < 0.05;
  const kind = flat ? ' bv-delta--flat' : v < 0 ? ' bv-delta--loss' : '';
  const text = `${v < 0 && !flat ? '−' : '+'}${Math.abs(v).toFixed(digits)}%`;
  const sr = v < 0 ? srDown : srUp;
  return `<span class="bv-delta${kind}"${sr ? attrs({ 'aria-label': sr }) : ''}>${text}</span>`;
}

/** Card surface. Use href for a whole-card link. */
export function card(inner, { href, id, cls = '', tag, attrs: extra = {} } = {}) {
  const t = href ? 'a' : (tag || 'section');
  return `<${t} class="bv-card${cls ? ` ${cls}` : ''}"${attrs({ href, id, ...extra })}>${inner}</${t}>`;
}

/** Muted section heading above a group of content. */
export function sectionTitle(text, { id, trailHtml = '' } = {}) {
  return trailHtml
    ? `<div class="bv-h2 bv-h2--row"><h2${attrs({ id })} style="margin:0;font:inherit;color:inherit;">${esc(text)}</h2>${trailHtml}</div>`
    : `<h2 class="bv-h2"${attrs({ id })}>${esc(text)}</h2>`;
}

/** Settings-style list row (64dp). */
export function row({ icon: name, title, sub, trail, trailHtml = '', href, id, danger = false, chevron = true, cls = '', attrs: extra = {} } = {}) {
  const tag = tagFor(href);
  const a = attrs({ ...linkOrButton(href), id, ...extra });
  const trailing = `${trailHtml}${trail ? esc(trail) : ''}${chevron ? icon('chev', { size: 20 }) : ''}`;
  return `<${tag} class="bv-row${danger ? ' bv-row--danger' : ''}${cls ? ` ${cls}` : ''}"${a}>${name ? icon(name, { size: 22 }) : ''}`
    + `<span class="bv-row__text"><span class="bv-row__title">${esc(title)}</span>${sub ? `<span class="bv-row__sub">${esc(sub)}</span>` : ''}</span>`
    + `${trailing ? `<span class="bv-row__trail">${trailing}</span>` : ''}</${tag}>`;
}

/** Titled group of rows inside one rounded surface. */
export function group(title, rowsHtml, { id } = {}) {
  return `<section class="bv-group"${attrs({ id })}>${title ? sectionTitle(title) : ''}<div class="bv-group__box">${rowsHtml}</div></section>`;
}

/** Labelled text field (52dp). */
export function field({ id, label, value = '', placeholder = '', type = 'text', mono = false, prefix = '', icon: name, help = '', error = '', inputmode, name: fieldName, required = false, autocomplete, maxlength, pattern, attrs: extra = {} } = {}) {
  const input = `<input${attrs({ id, name: fieldName || id, type, value, placeholder, inputmode, required, autocomplete, maxlength, pattern, 'aria-invalid': error ? 'true' : null, 'aria-describedby': (help || error) ? `${id}-help` : null, class: mono ? 'bv-mono-input' : null, ...extra })}>`;
  return `<div class="bv-field${error ? ' bv-field--invalid' : ''}">${label ? `<label for="${esc(id)}">${esc(label)}</label>` : ''}`
    + `<div class="bv-field__box">${name ? icon(name, { size: 20 }) : ''}${prefix ? `<span class="bv-field__prefix">${esc(prefix)}</span>` : ''}${input}</div>`
    + `${error ? `<span class="bv-field__error" id="${esc(id)}-help">${esc(error)}</span>` : help ? `<span class="bv-field__help" id="${esc(id)}-help">${esc(help)}</span>` : ''}</div>`;
}

/** Pill-shaped search input (56dp). */
export function searchBar({ id, placeholder = '', value = '', label, trailHtml = '', name: fieldName } = {}) {
  return `<div class="bv-search" role="search">${icon('search')}<input${attrs({ id, name: fieldName || id, type: 'search', value, placeholder, 'aria-label': label || placeholder, autocomplete: 'off', enterkeyhint: 'search' })}>${trailHtml}</div>`;
}

/** Full-width message strip. kind: acc | neutral | loss | info */
export function banner({ icon: name = 'info', text, textHtml, kind = 'acc', action, actionHref, actionId, id, role = 'status', attrs: extra = {} } = {}) {
  const act = action
    ? (actionHref
      ? `<a class="bv-banner__action"${attrs({ href: actionHref, id: actionId })}>${esc(action)}</a>`
      : `<button class="bv-banner__action" type="button"${attrs({ id: actionId })}>${esc(action)}</button>`)
    : '';
  return `<div class="bv-banner${kind !== 'acc' ? ` bv-banner--${kind}` : ''}"${attrs({ id, role, ...extra })}>${icon(name, { size: 20 })}<span class="bv-banner__text">${textHtml ?? esc(text)}</span>${act}</div>`;
}

/** Thin progress bar; pct 0–100. */
export function bar(pct, { label, acc = false } = {}) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return `<span class="bv-bar${acc ? ' bv-bar--acc' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p)}"${attrs({ 'aria-label': label })}><span style="width:${p}%"></span></span>`;
}

/** Switch (role=switch). */
export function toggle({ id, on = false, label, disabled = false, attrs: extra = {} } = {}) {
  return `<button type="button" class="bv-toggle" role="switch"${attrs({ id, 'aria-checked': String(!!on), 'aria-label': label, disabled, ...extra })}></button>`;
}

/** Top app bar. Root screens get a large title; detail screens a back arrow. */
export function topbar({ title, sub, back, backLabel, actionsHtml = '', id, sticky = false } = {}) {
  backLabel = backLabel || t('common.back');
  const h1 = `<h1${attrs({ id })}>${esc(title)}</h1>${sub ? `<div class="bv-topbar__sub">${esc(sub)}</div>` : ''}`;
  if (back) {
    const backEl = back === 'history'
      ? `<button type="button" class="bv-iconbtn" data-bv-back aria-label="${esc(backLabel)}">${icon('back')}</button>`
      : `<a class="bv-iconbtn" href="${esc(back)}" data-bv-back aria-label="${esc(backLabel)}">${icon('back')}</a>`;
    return `<header class="bv-topbar bv-topbar--back${sticky ? ' bv-topbar--sticky' : ''}">${backEl}<div class="bv-topbar__text">${h1}</div><div class="bv-topbar__actions">${actionsHtml}</div></header>`;
  }
  return `<header class="bv-topbar${sticky ? ' bv-topbar--sticky' : ''}"><div class="bv-topbar__text">${h1}</div><div class="bv-topbar__actions">${actionsHtml}</div></header>`;
}

/** Brick placeholder used behind every set image (colour from the theme hue). */
export function brickSvg(color = '#8a8f80') {
  const c = esc(color);
  return `<svg class="bv-brick" viewBox="0 0 40 32" aria-hidden="true" focusable="false"><rect x="7" y="0" width="9" height="7" rx="2" fill="${c}"/><rect x="24" y="0" width="9" height="7" rx="2" fill="${c}"/><rect x="0" y="5" width="40" height="27" rx="4" fill="${c}"/></svg>`;
}

/**
 * Set thumbnail: brick placeholder with the real photo layered on top. The app's
 * global load/error delegation adds .photo-loaded (or removes a dead image), so
 * a missing image never leaves an empty frame. `imgHtml` must carry class
 * "set-photo" (utils.slImgHTML / thumbImg produce the URL).
 */
export function thumb({ color, imgHtml = '', size = 52, radius, cls = '' } = {}) {
  const style = `--size:${Number(size) || 52}px;${radius ? `border-radius:${Number(radius)}px;` : ''}`;
  return `<span class="bv-thumb${cls ? ` ${cls}` : ''}" style="${style}">${brickSvg(color)}${imgHtml}</span>`;
}

/**
 * Minifigure illustration (used when no photo exists and in empty states).
 * torso/legs/hair are CSS colours from trusted data.
 */
export function figSvg({ torso = '#3b3f48', legs = '#3b3f48', hair = null, size = 62 } = {}) {
  const ol = ' stroke="rgba(37,40,32,.38)" stroke-width=".7"';
  const t = esc(torso), l = esc(legs);
  const hh = hair ? `<path d="M13 9 Q20 2 27 9 L27 11 L13 11 Z" fill="${esc(hair)}"/>` : '';
  return `<svg width="${size}" height="${Math.round(size * 1.25)}" viewBox="0 0 40 50" aria-hidden="true" focusable="false">`
    + '<rect x="15" y="3" width="10" height="3" rx="1" fill="#f2c200"/><rect x="12" y="5" width="16" height="13" rx="4" fill="#ffd21f"/>'
    + '<circle cx="17" cy="11" r="1.2" fill="#252820"/><circle cx="23" cy="11" r="1.2" fill="#252820"/><path d="M17 14.5 Q20 16.5 23 14.5" stroke="#252820" stroke-width="1.1" fill="none"/>'
    + `${hh}<path d="M11 19 L29 19 L31 33 L9 33 Z" fill="${t}"${ol}/><rect x="5" y="20" width="5" height="11" rx="2.5" fill="${t}"${ol}/><rect x="30" y="20" width="5" height="11" rx="2.5" fill="${t}"${ol}/>`
    + '<circle cx="7.5" cy="32" r="2.2" fill="#ffd21f"/><circle cx="32.5" cy="32" r="2.2" fill="#ffd21f"/>'
    + `<rect x="10" y="33" width="20" height="4" fill="${l}"${ol}/><rect x="10" y="37" width="9" height="11" rx="1" fill="${l}"${ol}/><rect x="21" y="37" width="9" height="11" rx="1" fill="${l}"${ol}/></svg>`;
}

/**
 * Sparkline from a numeric series. Returns '' for fewer than two points so a
 * brand-new vault never draws a misleading flat line.
 */
export function sparkline(values, { width = 340, height = 40, fill = true, label } = {}) {
  const pts = (values || []).map(Number).filter(Number.isFinite);
  if (pts.length < 2) return '';
  const lo = Math.min(...pts), hi = Math.max(...pts);
  const span = hi - lo || 1;
  const step = width / (pts.length - 1);
  const coords = pts.map((v, i) => `${(i * step).toFixed(1)},${(height - 3 - ((v - lo) / span) * (height - 6)).toFixed(1)}`).join(' ');
  const poly = fill ? `<polygon points="0,${height} ${coords} ${width},${height}"/>` : '';
  return `<svg class="bv-spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="height:${height}px"${label ? attrs({ role: 'img', 'aria-label': label }) : ' aria-hidden="true"'}>${poly}<polyline points="${coords}"/></svg>`;
}

/** Empty / error state block. actionsHtml holds already-built buttons. */
export function emptyState({ icon: name = 'box', artHtml = '', title, body = '', actionsHtml = '', id, role } = {}) {
  return `<section class="bv-empty"${attrs({ id, role })}><div class="bv-empty__art">${artHtml || icon(name)}</div><h2>${esc(title)}</h2>${body ? `<p>${esc(body)}</p>` : ''}${actionsHtml ? `<div class="bv-empty__actions">${actionsHtml}</div>` : ''}</section>`;
}

/** Sheet body with a title row and close button, for showSheet(). */
export function sheetBody({ title, sub, closeLabel, inner = '', id } = {}) {
  closeLabel = closeLabel || t('common.close');
  return `<div class="bv-sheet"${attrs({ id })}><div class="bv-sheet__head"><h2>${esc(title)}</h2><button type="button" class="bv-iconbtn" data-bv-sheet-close aria-label="${esc(closeLabel)}">${icon('x')}</button></div>${sub ? `<p class="bv-sheet__sub">${esc(sub)}</p>` : ''}${inner}</div>`;
}

/** Skeleton rows for list screens while data loads. */
export function skeletonRows(n = 4) {
  return Array.from({ length: n }, () => '<div class="bv-setrow" aria-hidden="true"><span class="bv-thumb bv-skel"></span><span class="bv-setrow__body"><span class="bv-skel" style="height:16px;width:70%"></span><span class="bv-skel" style="height:12px;width:45%;margin-top:6px"></span></span><span class="bv-skel" style="height:16px;width:56px"></span></div>').join('');
}
