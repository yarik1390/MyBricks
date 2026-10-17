import { escapeHtml } from '../utils.js';
import { valuationTrust, valuationConfidencePresentation } from '../lib/pure.js';

export function trustBadgeHTML(set, { compact = false } = {}) {
  const trust = valuationTrust(set);
  const display = valuationConfidencePresentation(set);
  const extra = compact ? ' compact' : '';
  return `<span class="trust-badge ${trust.tone}${extra}" title="${escapeHtml(display.detail || trust.detail)}">${escapeHtml(display.label)}</span>`;
}
