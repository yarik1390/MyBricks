const THEME_MULTIPLIERS: Record<string, number> = {
  'Star Wars': 1.35,
  'Technic': 1.20,
  'Ideas': 1.25,
  'Icons': 1.15,
  'Creator Expert': 1.20,
  'Creator 3-in-1': 1.05,
  'Architecture': 1.15,
  'Harry Potter': 1.30,
  'Marvel': 1.25,
  'DC': 1.20,
  'Ninjago': 1.10,
  'City': 0.95,
  'Friends': 0.90,
  'Duplo': 0.85,
  'Minecraft': 1.05,
  'Speed Champions': 1.10,
};

export function formulaValuation(set: { pieces?: number; year?: number; theme?: string | null; retired?: boolean }) {
  const pieces = set.pieces || 100;
  const year = set.year || new Date().getFullYear();
  const theme = set.theme || '';
  const retired = set.retired || false;

  const themeMultiplier = THEME_MULTIPLIERS[theme] || 1.0;
  const currentYear = new Date().getFullYear();
  const age = currentYear - year;
  const yearFactor = age <= 0 ? 1.0 : age <= 2 ? 1.05 : age <= 5 ? 1.12 : age <= 10 ? 1.20 : 1.30;

  const retailPrice = Math.round(pieces * 0.11 * themeMultiplier * yearFactor * 100) / 100;
  const marketMultiplier = retired ? 1.4 : 1.1;
  const currentValue = Math.round(retailPrice * marketMultiplier * 100) / 100;
  const forecast2y = Math.round(currentValue * 1.18 * 100) / 100;
  const forecast5y = Math.round(currentValue * 1.45 * 100) / 100;

  return { retail_price: retailPrice, current_value: currentValue, forecast_2y: forecast2y, forecast_5y: forecast5y };
}
