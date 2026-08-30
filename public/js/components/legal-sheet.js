import { hideSheet, showSheet } from './sheet.js';

const LEGAL_DOCUMENTS = {
  privacy: { title: 'Privacy Policy', url: '/privacy.html' },
  terms: { title: 'Terms of Service', url: '/terms.html' },
};

function titleRow(doc, titleId) {
  return `<div class="sheet-title-row">
      <h2 class="u-serif-h" id="${titleId}" tabindex="-1">${doc.title}</h2>
      <button class="icon-btn" id="legalSheetClose" aria-label="Close ${doc.title}">×</button>
    </div>`;
}

function wireLegalSheet(titleId) {
  document.querySelector('#sheet')?.setAttribute('aria-labelledby', titleId);
  document.querySelector('#legalSheetClose')?.addEventListener('click', hideSheet);
  requestAnimationFrame(() => document.querySelector(`#${titleId}`)?.focus({ preventScroll: true }));
}

function policyBody(html) {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const wrap = parsed.querySelector('.wrap');
  if (!wrap) throw new Error('Policy content is unavailable');
  wrap.querySelector('.top')?.remove();
  wrap.querySelector('h1')?.remove();
  wrap.querySelector('footer')?.remove();
  return wrap.innerHTML;
}

export async function openLegalSheet(kind) {
  const doc = LEGAL_DOCUMENTS[kind];
  if (!doc) return;
  const titleId = `legal-sheet-${kind}-title`;

  showSheet(`${titleRow(doc, titleId)}
    <div class="legal-sheet-scroll" aria-busy="true">
      <div class="skel line" style="width:72%;margin:8px 0 12px;"></div>
      <div class="skel line" style="width:94%;margin:0 0 10px;"></div>
      <div class="skel line" style="width:84%;margin:0;"></div>
    </div>`);
  wireLegalSheet(titleId);

  try {
    const response = await fetch(doc.url, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`Policy request failed (${response.status})`);
    const body = document.querySelector('.legal-sheet-scroll');
    if (!body || !document.querySelector('#sheet.show')) return;
    body.innerHTML = policyBody(await response.text());
    body.removeAttribute('aria-busy');
  } catch {
    const body = document.querySelector('.legal-sheet-scroll');
    if (!body || !document.querySelector('#sheet.show')) return;
    body.innerHTML = `<div class="legal-sheet-callout">
      <strong>${doc.title}</strong>
      <p>Policy content unavailable. Check your connection and try again.</p>
      <button class="btn secondary" id="legalSheetRetry" type="button">Retry</button>
    </div>`;
    body.removeAttribute('aria-busy');
    document.querySelector('#legalSheetRetry')?.addEventListener('click', () => openLegalSheet(kind));
  }
}
