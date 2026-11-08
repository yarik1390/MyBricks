// "Add your free Gemini key" sheet (BYOK-first AI, 2026-11-08).
//
// New accounts get a free AI trial on our keys (paid Gemini included). After
// it every feature keeps working on free models within daily limits; the
// user's own key removes the limits. This sheet is the 2-minute path to a free
// Google AI Studio key: open the page, copy, paste, test, done. It opens from
// Profile, and by itself when a free-path daily limit is hit (429
// byok_suggested; api.js fires `bv:byok`).
import { escapeHtml, haptic, toast } from '../utils.js';
import { t, tPlural } from '../lib/i18n.js';
import { getProviderCredential, setProviderCredential, hasPersistentProviderCredential } from '../lib/provider-credentials.js';
import { state } from '../state.js';

export const AI_STUDIO_KEY_URL = 'https://aistudio.google.com/apikey';

/** Short status line for Profile and the sheet header. */
export function aiTrialLabel(me) {
  if (getProviderCredential('gemini') || getProviderCredential('openai')) return t('byok.keyActive');
  const trial = me?.ai_trial;
  if (!trial || trial.active !== false) {
    const n = Number(trial?.days_left ?? 14);
    return tPlural('byok.trialLeft', n, { n });
  }
  return t('byok.trialEnded');
}

/** Check a key with one free model-list call, straight to Google. */
export async function testGeminiKey(key) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=1`);
  if (r.ok) return;
  if (r.status === 400 || r.status === 401 || r.status === 403) throw new Error(t('byok.errRejected'));
  if (r.status === 429) throw new Error(t('byok.errQuota'));
  throw new Error(t('byok.errGeneric', { status: r.status }));
}

/**
 * @param {{ feature?: string, ended?: boolean }} [opts] feature names what the
 *        user just tried (advisor, shelf, listing, grade, scan); ended says the
 *        trial is over rather than this being a voluntary visit.
 */
export async function openByokSheet(opts = {}) {
  // Already showing (e.g. two refused requests in a row): keep the one sheet.
  if (document.querySelector('#sheet.show .byok-sheet')) return;
  const { showSheet, hideSheet } = await import('./sheet.js');
  const featureKey = opts.feature && ['advisor', 'shelf', 'listing', 'grade', 'scan'].includes(opts.feature)
    ? `byok.feature_${opts.feature}` : '';
  const lead = opts.ended && featureKey
    ? t('byok.leadEnded', { feature: t(featureKey) })
    : t('byok.lead');
  const current = getProviderCredential('gemini');
  showSheet(`
    <div class="byok-sheet">
      <h2 class="u-serif-h" id="byokTitle" style="margin:0 4px 6px">${escapeHtml(t('byok.title'))}</h2>
      <p class="byok-status">${escapeHtml(aiTrialLabel(state.me))}</p>
      <p class="byok-lead">${escapeHtml(lead)}</p>
      <ol class="byok-steps">
        <li>${escapeHtml(t('byok.step1'))}</li>
        <li>${escapeHtml(t('byok.step2'))}</li>
        <li>${escapeHtml(t('byok.step3'))}</li>
      </ol>
      <a class="bv-btn bv-btn--tonal byok-open" href="${AI_STUDIO_KEY_URL}" target="_blank" rel="noopener">${escapeHtml(t('byok.open'))}</a>
      <label class="byok-field">
        <span class="u-sr-only">${escapeHtml(t('byok.placeholder'))}</span>
        <input type="password" id="byokKeyInput" class="bv-mono-input" autocomplete="off" autocapitalize="off" spellcheck="false"
               placeholder="${escapeHtml(t('byok.placeholder'))}" value="${escapeHtml(current)}">
      </label>
      <label class="byok-remember"><input type="checkbox" id="byokRemember" ${current && !hasPersistentProviderCredential('gemini') ? '' : 'checked'}> ${escapeHtml(t('byok.remember'))}</label>
      <p class="byok-error" id="byokError" role="alert" hidden></p>
      <div class="byok-actions">
        <button type="button" class="bv-btn bv-btn--primary" id="byokSave">${escapeHtml(t('byok.save'))}</button>
        <button type="button" class="bv-btn bv-btn--text" id="byokLater">${escapeHtml(t('byok.later'))}</button>
      </div>
      <p class="byok-privacy">${escapeHtml(t('byok.privacy'))}</p>
    </div>`);
  const sheet = document.getElementById('sheet');
  sheet?.setAttribute('aria-labelledby', 'byokTitle');

  const input = /** @type {HTMLInputElement|null} */ (document.getElementById('byokKeyInput'));
  const errEl = document.getElementById('byokError');
  const saveBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('byokSave'));
  document.getElementById('byokLater')?.addEventListener('click', () => hideSheet());
  saveBtn?.addEventListener('click', async () => {
    const key = (input?.value || '').trim();
    if (!key) { input?.focus(); return; }
    haptic('medium');
    if (errEl) errEl.hidden = true;
    saveBtn.disabled = true;
    try {
      await testGeminiKey(key);
      const remember = /** @type {HTMLInputElement|null} */ (document.getElementById('byokRemember'))?.checked !== false;
      setProviderCredential('gemini', key, remember);
      state.me = null;
      toast(t('byok.saved'), 'success');
      hideSheet();
      try { window.dispatchEvent(new Event('bv:byok-saved')); } catch { /* non-browser */ }
    } catch (e) {
      if (errEl) { errEl.textContent = e?.message || String(e); errEl.hidden = false; }
    } finally {
      saveBtn.disabled = false;
    }
  });
}
