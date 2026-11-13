// Shared sanity limits for what a collector says they paid and when.
// A typo like 99999999 or a date picked in the future used to be stored
// as-is and then distorted the whole vault value (deep-testing BUG-004).

/** No LEGO set has sold anywhere near this; anything above is a typo. */
export const MAX_PURCHASE_PRICE_USD = 1_000_000;

/** Error message when a purchase price is out of range, else null. */
export function purchasePriceError(p: unknown): string | null {
  if (p === undefined || p === null) return null;
  if (typeof p !== 'number' || !Number.isFinite(p) || p < 0) return 'Purchase price must be a number >= 0';
  if (p > MAX_PURCHASE_PRICE_USD) return 'Purchase price looks too high — check the amount';
  return null;
}

/**
 * True when a YYYY-MM-DD purchase date lies in the future. One day of slack
 * covers collectors whose local date is already "tomorrow" in UTC.
 */
export function isFuturePurchaseDate(d: string, now = Date.now()): boolean {
  const ts = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(ts) && ts > now + 86_400_000;
}
