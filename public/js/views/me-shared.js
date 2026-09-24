import { state } from '../state.js';
import { api } from '../api.js';
import { topbar } from '../ui/kit.js';
import { t } from '../lib/i18n.js';

/** Top bar for Me sub-pages: back to the Profile hub, title, one-line lead. */
export function subpageTopbarHTML(lead, title, { actionsHtml = '' } = {}) {
  return topbar({ title, sub: lead, back: '#/me', backLabel: t('bvAccount.backProfile'), actionsHtml });
}

/** Load (or reuse) the signed-in profile for sub-pages. */
export async function loadMe() {
  if (state.me) return state.me;
  try {
    state.me = await api("/api/me");
  } catch {
    state.me = { display_name: "Collector", handle: null, notify_price_drops: true, currency: "USD", portfolio_stats: {} };
  }
  return state.me;
}
