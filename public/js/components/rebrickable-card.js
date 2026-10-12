// Me → Integrations → Rebrickable: connect with a Rebrickable login (the server
// keeps only the user token), bring sets from Rebrickable into the vault, and
// send vault sets Rebrickable doesn't have back to it.
// Backed by /api/rebrickable (worker/src/routes/rebrickable-sync.ts).
import { $, haptic, toast } from '../utils.js';
import { api } from '../api.js';
import { state, invalidatePortfolio } from '../state.js';
import { pill } from '../ui/kit.js';
import { t } from '../lib/i18n.js';

export function rebrickableCardHTML(me, head) {
  return `<section class="bv-intcard" aria-label="Rebrickable">
    ${head('brick', 'Rebrickable', me.rebrickable_connected ? pill(t('bvAccount.connected'), 'gain') : pill(t('bvAccount.notConnected')))}
    <p class="bv-intcard__desc">Keep your Rebrickable set lists and your vault in step.</p>
    ${me.rebrickable_connected ? `
      <div class="bv-intcard__actions">
        <button type="button" id="rbImportBtn" class="bv-btn bv-btn--tonal">Import from Rebrickable</button>
        <button type="button" id="rbExportBtn" class="bv-btn bv-btn--tonal">Send to Rebrickable</button>
        <button type="button" id="rbDisconnectBtn" class="bv-btn bv-btn--danger">Disconnect</button>
      </div>
      <p id="rbResult" class="bv-intcard__meta" role="status"></p>
    ` : `
      <div class="bv-intcard__form">
        <div class="bv-field"><div class="bv-field__box"><input id="rbUsername" type="text" placeholder="Rebrickable username or email" aria-label="Rebrickable username or email" autocomplete="username"></div></div>
        <div class="bv-field"><div class="bv-field__box"><input id="rbPassword" type="password" placeholder="Rebrickable password" aria-label="Rebrickable password" autocomplete="current-password"></div></div>
        <button type="button" id="rbConnectBtn" class="bv-btn bv-btn--primary bv-btn--full integration-action">Connect Rebrickable</button>
        <p id="rbConnectError" class="bv-field__error" role="alert" hidden></p>
        <p class="bv-intcard__meta">We keep only the access key Rebrickable gives us, never your password.</p>
      </div>
    `}
  </section>`;
}

async function busy(btn, run) {
  if (!btn) return;
  const label = btn.textContent;
  btn.disabled = true;
  haptic('medium');
  try { await run(); } finally { btn.disabled = false; btn.textContent = label; }
}

export function wireRebrickableCard(rerender) {
  $('#rbConnectBtn')?.addEventListener('click', () => busy($('#rbConnectBtn'), async () => {
    const username = ($('#rbUsername')?.value || '').trim();
    const password = $('#rbPassword')?.value || '';
    const errEl = $('#rbConnectError');
    if (!username || !password) { toast('Enter your Rebrickable username and password', 'error'); return; }
    if (errEl) errEl.hidden = true;
    try {
      await api('/api/rebrickable/login', { method: 'POST', body: { username, password } });
      state.me = null;
      toast('Rebrickable connected', 'success');
      await rerender();
    } catch (e) {
      if (errEl) { errEl.textContent = e.message || String(e); errEl.hidden = false; }
    }
  }));
  $('#rbDisconnectBtn')?.addEventListener('click', () => busy($('#rbDisconnectBtn'), async () => {
    try {
      await api('/api/rebrickable/connect', { method: 'DELETE' });
      state.me = null;
      toast('Rebrickable disconnected', 'info');
      await rerender();
    } catch (e) { toast(t('common.errorWithDetails', { error: e.message || e }), 'error'); }
  }));
  const result = (text) => { const el = $('#rbResult'); if (el) el.textContent = text; };
  $('#rbImportBtn')?.addEventListener('click', () => busy($('#rbImportBtn'), async () => {
    try {
      const r = await api('/api/rebrickable/import', { method: 'POST' });
      // Label-style figures ("New in your vault: 3"), so no plural forms are needed.
      const fresh = r.added;
      result(t('rebrickable.importResult', { fresh, already: r.already, unknown: r.unknown }));
      if (r.added) invalidatePortfolio();
      toast('Import finished', 'success');
    } catch (e) { result(e.message || String(e)); toast(t('common.errorWithDetails', { error: e.message || e }), 'error'); }
  }));
  $('#rbExportBtn')?.addEventListener('click', () => busy($('#rbExportBtn'), async () => {
    try {
      const r = await api('/api/rebrickable/export', { method: 'POST' });
      result(r.remaining
        ? t('rebrickable.exportPartial', { sent: r.sent, left: r.remaining })
        : r.sent ? t('rebrickable.exportDone', { sent: r.sent }) : 'Rebrickable already has every set in your vault.');
      toast('Sent to Rebrickable', 'success');
    } catch (e) { result(e.message || String(e)); toast(t('common.errorWithDetails', { error: e.message || e }), 'error'); }
  }));
}
