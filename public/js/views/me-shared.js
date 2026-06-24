import { state } from '../state.js';
import { api } from '../api.js';
import { I } from '../icons.js';
import { escapeHtml } from '../utils.js';

/** Topbar for Me sub-pages: 44px back button to the hub + eyebrow/title. */
export function subpageTopbarHTML(eyebrow, title) {
  return `
    <div class="topbar">
      <a class="icon-btn" href="#/me" aria-label="Back to profile" style="margin-top:2px;margin-right:8px;">${I.chevL()}</a>
      <div class="topbar-heading">
        <div class="topbar-eyebrow">${escapeHtml(eyebrow)}</div>
        <h1 class="topbar-title">${escapeHtml(title)}</h1>
      </div>
    </div>`;
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
