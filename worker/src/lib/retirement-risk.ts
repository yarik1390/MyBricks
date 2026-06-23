// Deterministic retirement risk score 0–100. No network calls.
// Higher = more likely to retire within 12 months.
// Already-retired sets always return 0.

const SHORT_LIFECYCLE_THEMES = new Set([
  'City', 'Friends', 'NINJAGO', 'Nexo Knights', 'Elves',
  'Hidden Side', 'Monkie Kid', 'Vidiyo',
]);

export function computeRetirementRisk(set: {
  year: number;
  theme: string | null;
  pieces: number;
  retired: number;
  // Live signals (optional): when present they dominate the heuristic because a
  // real retirement signal beats any age/theme guess. Absent → no contribution,
  // so a set scored from catalog data alone keeps its base heuristic score.
  lego_retiring_soon?: number | boolean | null;
  lego_availability?: string | null;
  exit_date?: string | null;
}): number {
  if (set.retired) return 0;
  const currentYear = new Date().getFullYear();
  const age = currentYear - set.year;

  // --- Base heuristic (catalog-only) ---------------------------------------
  // Age factor: starts accumulating after 2 years, +15/yr, capped at 45
  const ageFactor = Math.min(45, Math.max(0, (age - 2) * 15));

  // Piece-count tier: larger sets have shorter production runs
  const pieceFactor = set.pieces > 1500 ? 10 : set.pieces >= 500 ? 5 : 0;

  // Theme lifecycle: some themes retire sets faster
  const themeFactor = SHORT_LIFECYCLE_THEMES.has(set.theme ?? '') ? 10 : 0;

  // --- Live signals (only when scraped data is present) --------------------
  // An official "Retiring Soon" flag or a set that has vanished from LEGO.com is
  // a far stronger predictor than age/theme, so it carries the most weight.
  let availabilityFactor = 0;
  const avail = (set.lego_availability ?? '').toLowerCase();
  if (set.lego_retiring_soon) availabilityFactor = 40;            // LEGO explicitly flags it retiring
  else if (avail === 'retiring') availabilityFactor = 35;
  else if (avail === 'sold_out' || avail === 'out_of_stock') availabilityFactor = 20; // gone from LEGO.com (may be temporary)

  // A known retirement (exit) date sharply raises the odds as it approaches or
  // once it has passed (the retired flag often lags the real exit date).
  let exitFactor = 0;
  const exitMs = set.exit_date ? Date.parse(set.exit_date) : NaN;
  if (Number.isFinite(exitMs)) {
    const daysToExit = (exitMs - Date.now()) / 86_400_000;
    if (daysToExit <= 0) exitFactor = 35;          // exit date passed but not yet flagged retired
    else if (daysToExit <= 180) exitFactor = 30;   // retiring within ~6 months
    else if (daysToExit <= 365) exitFactor = 15;   // retiring within a year
  }

  return Math.min(100, ageFactor + pieceFactor + themeFactor + availabilityFactor + exitFactor);
}
