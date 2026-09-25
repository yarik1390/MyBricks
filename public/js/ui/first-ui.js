// App states for the 2026 redesign (canvas: Offline, Syncing, ErrorState).
//
// One place decides how "offline", "updating prices" and "can't reach the
// server" read, so the Vault, the global offline banner and the router's error
// page say the same thing. Views only report what happened
// (markValuesFresh, setSyncState); this module owns the words and markup.
import { escapeHtml } from '../utils.js';
import { t, tPlural, intlLocale } from '../lib/i18n.js';
import { icon, btn } from './kit.js';
import { OUTBOX_KEY } from '../api.js';

const VALUES_AT_KEY = 'bv_values_at';
let sync = { active: false, done: 0, total: 0, error: false };

/** Record that collection values were just loaded from the server. */
export function markValuesFresh(at = Date.now()) {
  try { localStorage.setItem(VALUES_AT_KEY, String(at)); } catch { /* storage blocked */ }
}

/** When the values on screen were last fetched (ms), or null. */
export function valuesAt() {
  try { const v = Number(localStorage.getItem(VALUES_AT_KEY)); return v > 0 ? v : null; } catch { return null; }
}

/** "10:42" today, "Mon 10:42" this week, else a short date. */
export function whenLabel(ms, now = Date.now()) {
  if (!ms) return '';
  const d = new Date(ms);
  const loc = intlLocale();
  const sameDay = new Date(now).toDateString() === d.toDateString();
  if (sameDay) return d.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' });
  if (now - ms < 6 * 864e5) return d.toLocaleDateString(loc, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString(loc, { day: 'numeric', month: 'short' });
}

/** Changes made offline that will be sent when the connection is back. */
export function pendingChanges() {
  try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]').length; } catch { return 0; }
}

/** The sentence under "Offline" (pure: exported for tests). */
export function offlineText({ at = valuesAt(), pending = pendingChanges(), now = Date.now() } = {}) {
  const parts = [t('bvFirst.offline')];
  if (at) parts.push(t('bvFirst.valuesFrom', { time: whenLabel(at, now) }));
  let text = parts.join(' · ');
  if (pending > 0) text += `. ${tPlural('bvFirst.pendingSync', pending, { count: pending })}`;
  return text;
}

/** Repaint the global offline banner (#offlineBanner in index.html). */
export function paintOfflineBanner() {
  const el = document.getElementById('offlineBanner');
  if (!el) return;
  const text = el.querySelector('.offline-banner__text');
  if (text) text.textContent = offlineText();
  else el.textContent = offlineText();
}

/** Vault price refresh state. Pass { active, done, total, error }. */
export function setSyncState(next = {}) {
  sync = { ...sync, ...next };
  const slot = document.getElementById('bvSyncSlot');
  if (slot) slot.innerHTML = syncSlotInner();
  document.body.classList.toggle('bv-syncing', !!sync.active);
  const bar = document.getElementById('navProgress');
  if (bar) bar.classList.toggle('bv-sync', !!sync.active);
}

function syncSlotInner() {
  if (sync.active) {
    const count = sync.total > 0 ? ` · ${t('bvFirst.syncCount', { done: sync.done, total: sync.total })}` : '';
    return `<span class="bv-syncline" role="status">${icon('refresh', { size: 16, cls: 'bv-syncline__spin' })}<span>${escapeHtml(t('bvFirst.syncing') + count)}</span></span>`;
  }
  return '';
}

/** Placeholder the Vault hero renders; setSyncState fills it in place. */
export function syncSlotHTML() {
  return `<div id="bvSyncSlot" class="bv-syncslot" aria-live="polite">${syncSlotInner()}</div>`;
}

/** "Can't reach BricksVault" banner for a screen still showing saved values. */
export function reachErrorHTML({ id = 'bvReachError', retryId = 'bvReachRetry', at = valuesAt() } = {}) {
  const sub = at ? t('bvFirst.reachSaved', { time: whenLabel(at) }) : t('bvFirst.reachNoSaved');
  return `<div class="bv-reach" id="${escapeHtml(id)}" role="alert">${icon('alert', { size: 20 })}<span class="bv-reach__text"><strong>${escapeHtml(t('bvFirst.reachTitle'))}</strong><span>${escapeHtml(sub)}</span></span>${btn(t('bvFirst.retry'), { kind: 'outline', size: 'sm', icon: 'refresh', id: retryId })}</div>`;
}
