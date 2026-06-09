import { escapeHtml } from '../utils.js';
import { valuationTrust } from '../lib/pure.js';

export function trustBadgeHTML(set, { compact = false } = {}) {
  const trust = valuationTrust(set);
  const extra = compact ? ' compact' : '';
  return `<span class="trust-badge ${trust.tone}${extra}" title="${escapeHtml(set?.valuation_explanation || trust.detail)}">${escapeHtml(trust.label)}</span>`;
}

export function trustPanelHTML(set) {
  const trust = valuationTrust(set);
  const sourceLabel = String(trust.source || 'unknown').replace(/_/g, ' ');
  return `
    <div class="trust-panel ${trust.tone}">
      <div>
        <div class="trust-kicker">Market trust</div>
        <div class="trust-title">${escapeHtml(trust.label)}</div>
        <div class="trust-copy">${escapeHtml(set?.valuation_explanation || trust.detail)}</div>
      </div>
      <div class="trust-meta">
        <span>${escapeHtml(trust.confidence)}</span>
        <span>${escapeHtml(trust.freshness)}</span>
        <span>${escapeHtml(sourceLabel)}</span>
      </div>
    </div>`;
}
