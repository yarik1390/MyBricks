import { $, haptic } from '../utils.js';
import { I } from '../icons.js';
import { hideSheet, showSheet } from './sheet.js';
import { getLocale } from '../lib/i18n.js';

let cachedContent = '';
let cachedLocale = '';

// Translated copies of #methodologyContent live in /methodology/<locale>.html
// (fragments only, same headings in the same order so the 01-09 numbering
// holds). English, or a missing translation, reads the page itself.
async function loadTranslatedContent(locale) {
  if (!locale || locale === 'en') return '';
  try {
    const response = await fetch(`/methodology/${locale}.html`, { credentials: 'same-origin' });
    if (!response.ok) return '';
    const doc = new DOMParser().parseFromString(`<main>${await response.text()}</main>`, 'text/html');
    return doc.querySelector('main')?.querySelector('h1') ? doc.querySelector('main').innerHTML : '';
  } catch {
    return '';
  }
}

async function loadMethodologyContent() {
  const locale = getLocale();
  if (cachedContent && cachedLocale === locale) return cachedContent;
  const translated = await loadTranslatedContent(locale);
  if (translated) {
    cachedLocale = locale;
    cachedContent = translated;
    return cachedContent;
  }
  const response = await fetch('/methodology.html', { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Methodology HTTP ${response.status}`);
  const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
  const content = doc.querySelector('#methodologyContent');
  if (!content) throw new Error('Methodology content is missing');
  cachedLocale = locale;
  cachedContent = content.innerHTML;
  return cachedContent;
}

async function openMethodologySheet() {
  haptic('light');
  showSheet(`
    <div class="sheet-title-row">
      <div>
        <div class="u-mono-label">Pricing methodology</div>
        <h2 id="methodologySheetTitle" class="u-serif-h methodology-sheet-title">How we price LEGO sets</h2>
      </div>
      <button type="button" class="icon-btn" id="methodologySheetClose" aria-label="Close">${I.close()}</button>
    </div>
    <div class="methodology-sheet-loading" role="status">Loading pricing methodology...</div>`);
  $('#sheet')?.setAttribute('aria-labelledby', 'methodologySheetTitle');
  $('#methodologySheetClose')?.addEventListener('click', hideSheet);

  try {
    const html = await loadMethodologyContent();
    if (!document.body.classList.contains('sheet-open')) return;
    const sheet = $('#sheet');
    if (!sheet) return;
    sheet.innerHTML = `<div class="sheet-handle"></div>
      <div class="sheet-title-row methodology-sheet-head">
        <div>
          <div class="u-mono-label">Pricing methodology</div>
          <h2 id="methodologySheetTitle" class="u-serif-h methodology-sheet-title">How we price LEGO sets</h2>
        </div>
        <button type="button" class="icon-btn" id="methodologySheetClose" aria-label="Close">${I.close()}</button>
      </div>
      <article class="methodology-sheet">${html}</article>`;
    sheet.setAttribute('aria-labelledby', 'methodologySheetTitle');
    $('#methodologySheetClose')?.addEventListener('click', hideSheet);
  } catch {
    hideSheet();
    window.location.href = '/methodology.html';
  }
}

export function installMethodologySheet() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[href="/methodology.html"]');
    if (!link) return;
    event.preventDefault();
    openMethodologySheet();
  });
}
