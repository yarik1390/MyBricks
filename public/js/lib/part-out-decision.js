// Part-out versus whole-set decision card for the Pricing details sheet.
//
// The values come from pricing data already present on the set record. This
// module stays dependency-light (i18n + escapeHtml only) so its derivation and
// honest empty fallback can be exercised directly by the node test suite.

import { t } from './i18n.js';
import { escapeHtml } from './pure.js';

const defaultMoney = (value) => (
  Number.isFinite(Number(value)) ? `$${Number(value).toFixed(2)}` : '—'
);

function fmtPct(value, signed = false) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const prefix = signed && number >= 0 ? '+' : '';
  return `${prefix}${(number * 100).toFixed(1)}%`;
}

/**
 * Compare a set's whole-set market value with its gated part-out value.
 * Numbers remain unrounded so callers can make presentation decisions.
 */
export function derivePartOutDecision(set) {
  const partOutValue = Number(set?.valuation?.part_out?.value || set?.part_out_value);
  const wholeValue = Number(set?.market_value) || Number(set?.current_value);
  if (!Number.isFinite(partOutValue) || partOutValue <= 0) return null;
  if (!Number.isFinite(wholeValue) || wholeValue <= 0) return null;

  const coverage = Number(set?.valuation?.part_out?.coverage ?? 0);
  const ratio = partOutValue / wholeValue;
  const verdict = ratio >= 1.15 ? 'partout' : ratio <= 0.85 ? 'sealed' : 'same';

  return {
    wholeValue,
    partOutValue,
    coverage,
    ratio,
    verdict,
    deltaPct: ratio - 1,
  };
}

/**
 * Render the part-out decision. `fmtMoney` is injected to avoid importing the
 * app's currency state; the set-detail view supplies its real formatter.
 */
export function partOutDecisionHTML(set, fmtMoney = defaultMoney) {
  const decision = derivePartOutDecision(set);
  if (!decision) return '';

  const verdictKey = {
    partout: 'market.partOutVerdictPartout',
    sealed: 'market.partOutVerdictSealed',
    same: 'market.partOutVerdictSame',
  }[decision.verdict];
  const glyph = decision.verdict === 'same' ? '⇄' : '✓';

  let deltaLine = '';
  if (Math.abs(decision.deltaPct) >= 0.05 && decision.verdict === 'partout') {
    deltaLine = t('market.partOutDeltaPartout', { pct: fmtPct(decision.deltaPct, true) });
  } else if (Math.abs(decision.deltaPct) >= 0.05 && decision.verdict === 'sealed') {
    deltaLine = t('market.partOutDeltaSealed', { pct: fmtPct(-decision.deltaPct, true) });
  } else if (Math.abs(decision.deltaPct) < 0.05 && decision.verdict === 'same') {
    deltaLine = t('market.partOutClose');
  }

  const deltaHTML = deltaLine
    ? `<p class="part-out-decision-note">${escapeHtml(deltaLine)}</p>`
    : '';
  const coverageHTML = Number.isFinite(decision.coverage) && decision.coverage > 0
    ? `<p class="part-out-decision-coverage">${escapeHtml(t('market.partOutCoverage', { pct: fmtPct(decision.coverage) }))}</p>`
    : '';

  return `
    <article class="detail-card part-out-decision">
      <header class="part-out-decision-head">
        <span class="part-out-decision-glyph" aria-hidden="true">${glyph}</span>
        <h3 class="detail-card-title">${escapeHtml(t(verdictKey))}</h3>
      </header>
      <section class="part-out-decision-comparison">
        <div class="part-out-decision-row">
          <span>${escapeHtml(t('market.partOutSellSealed'))}</span>
          <strong>${escapeHtml(fmtMoney(decision.wholeValue))}</strong>
        </div>
        <div class="part-out-decision-row">
          <span>${escapeHtml(t('market.partOutSellParts'))}</span>
          <strong>${escapeHtml(fmtMoney(decision.partOutValue))}</strong>
        </div>
      </section>
      ${deltaHTML}
      ${coverageHTML}
    </article>`;
}
