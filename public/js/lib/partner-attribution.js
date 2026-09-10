/**
 * Public provider registry + attribution renderer.
 *
 * Only PriceCharting is a confirmed data PARTNER. Everything else (BrickLink,
 * eBay, BrickOwl, BrickEconomy, Brickset, Rebrickable, StockX, Amazon) is a
 * named source with no partner status. No logos are used anywhere.
 *
 * Rules encoded here (do not bypass):
 *  - A DIRECT product link may only ever be built from a VERIFIED numeric
 *    source_item_id (pricing_source_map status 'verified' | 'manual'):
 *    https://www.pricecharting.com/game/<numeric-id> — the site 301-redirects
 *    numeric ids to the canonical slug page. Never legacy:*, never a guessed
 *    slug.
 *  - Without a verified id, fall back to the clearly-labeled homepage link
 *    (pricecharting.com) — presented as the source homepage, never a product
 *    link.
 *  - Attribution is only rendered when PriceCharting actually contributes to
 *    the shown valuation, i.e. some valuation basis entry's sources[] contains
 *    a pricecharting* source. When it doesn't, this module renders nothing.
 */

import { t } from './i18n.js';

export const PROVIDERS = {
  pricecharting: {
    id: 'pricecharting',
    name: 'PriceCharting',
    homepage: 'https://www.pricecharting.com',
    isPartner: true,
    role: 'sold',
  },
  bricklink: {
    id: 'bricklink',
    name: 'BrickLink',
    homepage: 'https://www.bricklink.com',
    isPartner: false,
    role: 'sold',
  },
  ebay_market: {
    id: 'ebay_market',
    name: 'eBay',
    homepage: 'https://www.ebay.com',
    isPartner: false,
    role: 'sold',
  },
  brickowl: {
    id: 'brickowl',
    name: 'BrickOwl',
    homepage: 'https://www.brickowl.com',
    isPartner: false,
    role: 'asking',
  },
  brickeconomy: {
    id: 'brickeconomy',
    name: 'BrickEconomy',
    homepage: 'https://www.brickeconomy.com',
    isPartner: false,
    role: 'modeled',
  },
  brickset: {
    id: 'brickset',
    name: 'Brickset',
    homepage: 'https://brickset.com',
    isPartner: false,
    role: 'estimate',
  },
  rebrickable: {
    id: 'rebrickable',
    name: 'Rebrickable',
    homepage: 'https://rebrickable.com',
    isPartner: false,
    role: 'estimate',
  },
  stockx: {
    id: 'stockx',
    name: 'StockX',
    homepage: 'https://stockx.com',
    isPartner: false,
    role: 'asking',
  },
};

const PRICECHARTING_SOURCE_PATTERN = /^pricecharting(?:_|$)/;

/** True when any valuation basis entry lists a pricecharting* source. */
export function pricechartingContributes(basis) {
  if (!Array.isArray(basis)) return false;
  return basis.some((entry) => {
    const sources = entry && Array.isArray(entry.sources) ? entry.sources : [];
    return sources.some((s) => PRICECHARTING_SOURCE_PATTERN.test(String(s)));
  });
}

/** A verified numeric PriceCharting item id: digits only, no legacy: prefix. */
export function isVerifiedPricechartingId(itemId) {
  if (typeof itemId !== 'string') return false;
  return /^\d+$/.test(itemId);
}

/**
 * Build the attribution for a set that PriceCharting contributes to.
 * `verifiedItemId` must come from the verified/manual pricing_source_map
 * lookup merged into the set detail payload (worker-side) — never guessed.
 */
export function pricechartingAttribution(verifiedItemId, { conditionBasis = 'new' } = {}) {
  const label = conditionBasis === 'used'
    ? t('market.pcAttributionUsed')
    : t('market.pcAttributionNew');
  if (isVerifiedPricechartingId(verifiedItemId)) {
    return {
      variant: 'product',
      url: `https://www.pricecharting.com/game/${verifiedItemId}`,
      label,
    };
  }
  // Clearly-labeled homepage fallback — never presented as a product link.
  return {
    variant: 'homepage',
    url: 'https://www.pricecharting.com',
    label: `${label}${t('market.pcAttributionHomepage')}`,
  };
}

function escapeHtmlAttr(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Attribution line for the set-detail page. Renders ONLY when PriceCharting
 * actually contributes to the condition basis being shown; renders '' otherwise.
 */
export function pricechartingAttributionHTML(set, { conditionBasis = 'new' } = {}) {
  if (!set) return '';
  const valuation = set.valuation || {};
  const state = conditionBasis === 'used' ? valuation.used : valuation.new;
  const basis = state?.basis ?? (conditionBasis === 'new' ? set.market_value_basis : undefined);
  if (!pricechartingContributes(basis)) return '';
  const attribution = pricechartingAttribution(
    set.pricecharting_item_id,
    { conditionBasis },
  );
  const href = escapeHtmlAttr(attribution.url);
  const label = escapeHtmlAttr(attribution.label);
  if (attribution.variant === 'product') {
    return `<span class="pc-attribution"><a href="${href}" target="_blank" rel="noopener noreferrer">${label} →</a></span>`;
  }
  return `<span class="pc-attribution pc-attribution-homepage"><a href="${href}" target="_blank" rel="noopener noreferrer">${label} →</a></span>`;
}

/**
 * Concise source credit for the portfolio hero / history contexts: 'PriceCharting'
 * when it contributes, '' otherwise (other sources are not partner-credited).
 */
export function pricechartingSourceLinkLabel(basis) {
  if (!pricechartingContributes(basis)) return '';
  return 'PriceCharting';
}
