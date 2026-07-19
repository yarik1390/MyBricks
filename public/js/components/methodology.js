import { $, haptic } from '../utils.js';
import { I } from '../icons.js';
import { hideSheet, showSheet } from './sheet.js';

let cachedContent = '';

async function loadMethodologyContent() {
  if (cachedContent) return cachedContent;
  const response = await fetch('/methodology.html', { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Methodology HTTP ${response.status}`);
  const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
  const content = doc.querySelector('#methodologyContent');
  if (!content) throw new Error('Methodology content is missing');
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
