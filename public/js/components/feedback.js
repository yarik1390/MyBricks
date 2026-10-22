// Profile > Send feedback: a short note to the owner, with the screen, app
// version and device attached so a tester doesn't have to describe them.
// Notes land in Admin > Feedback (worker/src/routes/feedback.ts).
import { $, escapeHtml, haptic, toast } from '../utils.js';
import { api } from '../api.js';
import { t, getLocale } from '../lib/i18n.js';
import { showSheet, hideSheet } from './sheet.js';
import { sheetBody } from '../ui/kit.js';
import { getCapacitorPlugin, isNativeCapacitor } from '../lib/native-auth.js';

async function appVersion() {
  try {
    const info = await getCapacitorPlugin('App')?.getInfo?.();
    if (info?.version) return `${info.version}${info.build ? ` (${info.build})` : ''}`;
  } catch {}
  try {
    const key = (await caches.keys()).find(k => /^brickvault-static-v\d+$/.test(k));
    if (key) return key.replace('brickvault-static-', '');
  } catch {}
  return null;
}

export function openFeedbackSheet(fromScreen = '') {
  showSheet(sheetBody({
    title: t('bvAccount.feedbackTitle'),
    sub: t('bvAccount.feedbackSub'),
    inner: `<div class="bv-field"><div class="bv-field__box"><textarea id="feedbackText" rows="5" maxlength="4000" aria-label="${escapeHtml(t('bvAccount.feedbackTitle'))}" placeholder="${escapeHtml(t('bvAccount.feedbackPlaceholder'))}"></textarea></div></div>
      <p class="bv-field__error" id="feedbackErr" role="alert" hidden></p>
      <button type="button" class="bv-btn bv-btn--primary bv-btn--full" id="feedbackSend" disabled><span>${escapeHtml(t('bvAccount.feedbackSend'))}</span></button>`,
  }));
  const text = $('#feedbackText');
  const send = $('#feedbackSend');
  setTimeout(() => text?.focus(), 150);
  text?.addEventListener('input', () => { send.disabled = text.value.trim().length < 3; });
  send?.addEventListener('click', async () => {
    const message = text.value.trim();
    if (message.length < 3) return;
    const err = $('#feedbackErr');
    send.disabled = true;
    try {
      await api('/api/feedback', {
        method: 'POST',
        body: {
          message,
          screen: fromScreen || null,
          app_version: await appVersion(),
          platform: isNativeCapacitor() ? 'android' : 'web',
          locale: getLocale(),
        },
      });
      haptic('success');
      hideSheet();
      toast(t('bvAccount.feedbackThanks'), 'success');
    } catch (e) {
      send.disabled = false;
      if (err) { err.textContent = e?.message || t('bvAccount.feedbackFailed'); err.hidden = false; }
    }
  });
}
