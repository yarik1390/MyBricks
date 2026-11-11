// Skeleton loaders — paint these into #root before the first await when a
// view has no cached data, so cold loads show the shape of the page that is
// coming instead of sitting blank. Each placeholder mirrors the real layout
// (same gutters, radii and row heights) so nothing jumps when data lands.
// Styles: "Loading placeholders" in design-pass.css.

const bar = (w, h = 14, extra = '') => `<span class="skel dp-sk" style="width:${w};height:${h}px;${extra}"></span>`;
const many = (n, fn) => Array.from({ length: n }, (_, i) => fn(i)).join('');
// Line widths vary a little per row so a list does not read as a barcode.
const NAME_W = ['68%', '52%', '74%', '46%', '62%', '56%'];
const META_W = ['38%', '46%', '32%', '42%', '36%', '48%'];

/** Rows shaped like the app's set rows: photo, name, meta, value. */
export function skelCardList(n = 6) {
  return `<div class="dp-skgroup">${many(n, (i) => `
    <div class="dp-skrow" style="--i:${i}">
      <span class="skel dp-sk dp-sk--thumb"></span>
      <span class="dp-skrow__body">${bar(NAME_W[i % 6], 16)}${bar(META_W[i % 6], 12)}</span>
      <span class="dp-skrow__end">${bar('52px', 16)}${bar('36px', 12)}</span>
    </div>`)}</div>`;
}

/** Stat tiles: a small label over a bigger figure. */
export function skelStatGrid(n = 4) {
  return `<div class="dp-skstats" style="--cols:${n === 3 ? 3 : 2}">${many(n, (i) => `
    <div class="dp-sktile" style="--i:${i}">${bar('56%', 12)}${bar('78%', 22)}</div>`)}</div>`;
}

/** Set page: photo, title, facts strip, value card, tabs, first rows. */
export function skelDetail() {
  return `
    <div class="page dp-skpage dp-skpage--set" aria-busy="true">
      <div class="dp-skhero">
        <span class="dp-skhero__btn"></span>
        <svg class="dp-skhero__brick" viewBox="0 0 64 48" width="96" height="72" aria-hidden="true" focusable="false"><rect x="12" y="2" width="14" height="10" rx="3"/><rect x="38" y="2" width="14" height="10" rx="3"/><rect x="2" y="10" width="60" height="36" rx="6"/></svg>
        <span class="dp-skhero__btn dp-skhero__btn--end"></span>
      </div>
      <div class="dp-skbody">
        ${bar('66%', 26, 'border-radius:10px')}
        ${bar('44%', 14)}
        <div class="dp-skfacts">${many(4, () => `<span>${bar('60%', 10)}${bar('74%', 16)}</span>`)}</div>
        <div class="dp-skcard" style="--i:1">
          ${bar('34%', 12)}
          ${bar('42%', 32, 'border-radius:10px')}
          ${bar('100%', 6, 'border-radius:3px;margin-top:6px')}
          <span class="dp-skcard__split">${bar('30%', 12)}${bar('24%', 12)}</span>
        </div>
        <div class="dp-sktabs" style="--i:2">${bar('64px', 14)}${bar('84px', 14)}${bar('72px', 14)}</div>
        <div class="dp-skgroup dp-skgroup--plain">${many(3, (i) => `
          <div class="dp-skrow dp-skrow--link" style="--i:${i + 3}">
            <span class="skel dp-sk dp-sk--icon"></span>
            <span class="dp-skrow__body">${bar(NAME_W[i], 15)}${bar(META_W[i], 12)}</span>
          </div>`)}</div>
      </div>
    </div>`;
}

/** Settings rows: a title and a line of help text each. */
export function skelSettingRows(n = 4) {
  return `<div class="dp-skgroup">${many(n, (i) => `
    <div class="dp-skrow dp-skrow--setting" style="--i:${i}">
      <span class="dp-skrow__body">${bar(META_W[i % 6], 15)}${bar(NAME_W[i % 6], 12)}</span>
      <span class="skel dp-sk dp-sk--chev"></span>
    </div>`)}</div>`;
}

/** Full-page skeleton wrapper with a top bar placeholder. */
export function skelPage(inner) {
  return `
    <div class="page dp-skpage" aria-busy="true">
      <div class="dp-sktop">${bar('148px', 28, 'border-radius:10px')}${bar('92px', 13)}</div>
      ${inner}
    </div>`;
}
