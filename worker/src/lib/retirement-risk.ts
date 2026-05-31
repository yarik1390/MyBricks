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
}): number {
  if (set.retired) return 0;
  const currentYear = new Date().getFullYear();
  const age = currentYear - set.year;

  // Age factor: starts accumulating after 2 years, +15/yr, capped at 45
  const ageFactor = Math.min(45, Math.max(0, (age - 2) * 15));

  // Piece-count tier: larger sets have shorter production runs
  const pieceFactor = set.pieces > 1500 ? 10 : set.pieces >= 500 ? 5 : 0;

  // Theme lifecycle: some themes retire sets faster
  const themeFactor = SHORT_LIFECYCLE_THEMES.has(set.theme ?? '') ? 10 : 0;

  return Math.min(100, ageFactor + pieceFactor + themeFactor);
}
