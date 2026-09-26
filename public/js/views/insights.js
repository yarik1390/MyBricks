// Placeholder for a 2026-redesign screen (Vault area). Replaced by the
// area's implementation; kept renderable so the route never errors.
import { $ } from '../utils.js';
import { t } from '../lib/i18n.js';
import { topbar, emptyState, btn } from '../ui/kit.js';

export async function renderInsights() {
  const root = $('#root');
  if (!root) return;
  root.innerHTML = `<main class="bv-page no-nav">${topbar({ title: t('bvCommon.comingSoon'), back: 'history' })}${emptyState({ icon: 'sparkle', title: t('bvCommon.comingSoon'), actionsHtml: btn(t('nav.vault'), { href: '#/', kind: 'tonal' }) })}</main>`;
}
