// Sold-evidence card for the Pricing details sheet.
//
// Everything here is derived from the valuation basis the API already sends in
// set.valuation.new / set.valuation.used — no new backend state. It is kept
// deliberately dependency-light (only i18n + escapeHtml) so the node test suite
// can import it directly to lock down the derivation and the honest fallback.
//
// A basis entry counts as real sold evidence only when it is a `sold` signal
// with a verified identity and a numeric, positive price. New & sealed and
// used & complete states are combined; family-condition duplicates (e.g.
// PriceCharting plus a partner marketplace exposing the same underlying sales)
// are collapsed so sales are never double-counted as independent.

import { t, tPlural } from './i18n.js';
import { escapeHtml } from './pure.js';

const SOLD_FAMILY_LABELS = {
  bricklink: 'BrickLink',
  ebay: 'eBay',
  ebay_market: 'eBay',
  pricecharting: 'PriceCharting',
};

function soldConditionLabel(condition) {
  return condition === 'used_complete'
    ? t('market.soldEvidenceUsedComplete')
    : t('market.soldEvidenceNewSealed');
}

/**
 * Derive the sold-evidence summary from a set's v3 valuation basis.
 * Returns { sampleCount, familyCount, families } where each family is
 * { providerFamily, conditions: [{condition, value, saleCount, fresh}] }.
 */
export function deriveSoldEvidence(set) {
  const newState = set?.valuation?.new;
  const usedState = set?.valuation?.used;
  // ValuationBasis rows do not carry condition themselves; condition belongs
  // to the parent valuation state. Tag it here so used sales can never be
  // presented as new & sealed evidence.
  const basisRows = [
    ...(Array.isArray(newState?.basis)
      ? newState.basis.map((item) => ({ item, condition: 'new_sealed' }))
      : []),
    ...(Array.isArray(usedState?.basis)
      ? usedState.basis.map((item) => ({ item, condition: 'used_complete' }))
      : []),
  ];
  const families = new Map(); // provider_family -> conditions: Map<condition, row>

  for (const row of basisRows) {
    const { item, condition } = row;
    const valid = item && item.signal_type === 'sold'
      && item.identity_verified === true
      && Number(item.value) > 0;
    if (!valid) continue;
    const family = String(item.provider_family || 'market');
    const count = Math.max(0, Number(item.sample_count) || 0);
    let conditions = families.get(family);
    if (!conditions) {
      conditions = new Map();
      families.set(family, conditions);
    }
    const existing = conditions.get(condition);
    if (existing) {
      // Same family & condition can be exposed through several APIs. Treat them
      // as one source: keep the row with the largest sample and never sum
      // sales that aren't independent. Any fresh signal makes the row fresh.
      existing.fresh = existing.fresh || item.fresh === true;
      if (count >= existing.saleCount) {
        existing.saleCount = count;
        existing.value = Number(item.value);
      }
    } else {
      conditions.set(condition, {
        condition, value: Number(item.value), saleCount: count, fresh: item.fresh === true,
      });
    }
  }

  const familyRows = [...families.entries()].map(([providerFamily, conditions]) => ({
    providerFamily,
    conditions: [...conditions.values()],
  }));

  let sampleCount = 0;
  for (const family of familyRows) {
    for (const cond of family.conditions) sampleCount += cond.saleCount;
  }
  return { sampleCount, familyCount: familyRows.length, families: familyRows };
}

/**
 * Render the sold-evidence card. `fmtMoney` is injected so this module stays
 * free of the currency/rate state that lives in utils.js; the set-detail view
 * passes the app's real formatter, tests pass a plain one.
 */
export function soldEvidenceHTML(set, fmtMoney = (n) => (Number.isFinite(Number(n)) ? `$${Number(n).toFixed(2)}` : '—')) {
  const evidence = deriveSoldEvidence(set);
  if (evidence.familyCount === 0) {
    return `
      <article class="pricing-condition-card">
        <h3 class="pricing-block-title">${t('market.soldEvidenceTitle')}</h3>
        <p class="sold-evidence-note" style="margin:0;line-height:1.5;">${escapeHtml(t('market.soldEvidenceFallback'))}</p>
      </article>`;
  }
  const headline = escapeHtml(t('market.soldEvidenceHeadline', {
    sales: tPlural('market.soldEvidenceSales', evidence.sampleCount),
    markets: tPlural('market.soldEvidenceMarketplaces', evidence.familyCount),
  }));
  const rows = evidence.families.map((family) => {
    const label = escapeHtml(SOLD_FAMILY_LABELS[family.providerFamily] || 'Marketplace');
    const condRows = family.conditions.map((cond) => `
      <div class="sold-evidence-row">
        <span>${escapeHtml(cond.fresh ? t('market.soldEvidenceFresh') : t('market.soldEvidenceOlder'))}</span>
        <span>${escapeHtml(soldConditionLabel(cond.condition))}</span>
        <strong>${fmtMoney(cond.value)}</strong>
        <span class="sold-evidence-note">${escapeHtml(tPlural('market.soldEvidenceSales', cond.saleCount))}</span>
      </div>`).join('');
    return `
      <section class="sold-evidence-family" aria-label="${label}">
        <h4 class="sold-evidence-fam-title">${label}</h4>
        ${condRows}
      </section>`;
  }).join('');
  return `
    <article class="pricing-condition-card sold-evidence-card">
      <h3 class="pricing-block-title"><span aria-hidden="true">✓</span>${headline}</h3>
      ${rows}
    </article>`;
}