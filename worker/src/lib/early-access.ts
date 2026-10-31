// Early-access free launch (2026-10-31): while EARLY_ACCESS_PRO is "1"
// (wrangler.toml [vars]) every signed-in account gets Pro's features and
// Pro-level daily limits. Paid status (user_prefs.is_supporter) is untouched,
// so the gold skin, the supporter wall and the "Pro" badge stay for real
// buyers, and RevenueCat/Stripe keep working. Set the var to "0" to bring
// the paywall back; no app release needed.
export function earlyAccessPro(env: { EARLY_ACCESS_PRO?: string } | undefined): boolean {
  return env?.EARLY_ACCESS_PRO === '1';
}

/** Pro features unlocked: paid Pro, or everyone during early access. */
export function hasProAccess(env: { EARLY_ACCESS_PRO?: string } | undefined, isSupporter: unknown): boolean {
  return earlyAccessPro(env) || !!isSupporter;
}
