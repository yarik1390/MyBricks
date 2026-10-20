// Minifig rarity (G1 — rare-minifig spotting). Pure, deterministic, no network.
//
// The minifig UI (sort tiers, rarity filter chips, badges, the rarity→value
// fallback) is entirely rarity-driven, but rarity defaulted to 'common' for
// every fig — so that UX was effectively dead. This derives a REAL tier from
// the signals we have: market value (the dominant signal), set-exclusivity
// (a fig in very few sets is scarcer), and market liquidity (few active lots
// corroborates scarcity; a deep market argues common even at a high price).

export type MinifigRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export function computeMinifigRarity(
  value: number | null | undefined,
  appearsInSets: number | null | undefined,
  lots: number | null | undefined,
): MinifigRarity {
  const v = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  const sets = typeof appearsInSets === 'number' && appearsInSets > 0 ? appearsInSets : null;
  const liquid = typeof lots === 'number' && lots >= 0 ? lots : null;

  // Scarcity signals.
  const exclusive = sets != null && sets <= 2;        // in 1–2 sets only
  const semiExclusive = sets != null && sets <= 4;
  const thinMarket = liquid != null && liquid > 0 && liquid <= 3; // few active lots

  // Value-dominant, with scarcity/liquidity lifting borderline figs a tier.
  if (v >= 100 || (v >= 50 && (exclusive || thinMarket))) return 'legendary';
  if (v >= 30 || (v >= 12 && (exclusive || thinMarket))) return 'rare';
  if (v >= 6 || semiExclusive) return 'uncommon';
  return 'common';
}
