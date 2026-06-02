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

export function formulaValuation(set: {
  pieces?: number;
  year?: number;
  theme?: string | null;
  retired?: boolean;
  minifigs?: number;
}) {
  const pieces = set.pieces || 100;
  const year = set.year || new Date().getFullYear();
  const theme = set.theme || '';
  const retired = set.retired || false;
  const minifigs = set.minifigs || 0;

  const themeMultiplier = THEME_MULTIPLIERS[theme] || 1.0;
  const currentYear = new Date().getFullYear();

  // Base MSRP calculation based on parts count, theme multiplier, and base rate per piece
  const msrp = Math.round(pieces * 0.11 * themeMultiplier * 100) / 100;

  // Theme-Specific compound appreciation rates
  let appreciationRate = 0.04; // 4% default
  const t = theme.toLowerCase();
  if (t.includes('star wars') || t.includes('ideas') || t.includes('creator')) {
    appreciationRate = 0.12; // 12%
  } else if (t.includes('technic') || t.includes('icons')) {
    appreciationRate = 0.07; // 7%
  } else if (t.includes('city') || t.includes('friends') || t.includes('duplo')) {
    appreciationRate = 0.015; // 1.5%
  }

  // Shelf life defaults to 2 years before a set is retired
  const yearsSinceRetirement = retired ? Math.max(0, currentYear - (year + 2)) : 0;

  // Compound appreciation value
  let currentValue = msrp * Math.pow(1 + appreciationRate, yearsSinceRetirement);

  // Cap appreciation at 5x MSRP
  const maxCap = msrp * 5;
  if (currentValue > maxCap) {
    currentValue = maxCap;
  }

  // Minifigure rarity bonus
  const isLicensed = t.includes('star wars') || t.includes('marvel') || t.includes('dc') || t.includes('harry potter') || t.includes('ideas');
  const figBonusVal = isLicensed ? 7.50 : 4.50;
  const minifigBonus = minifigs * figBonusVal;

  currentValue += minifigBonus;

  // Round values
  currentValue = Math.round(currentValue * 100) / 100;
  const forecast2y = Math.round(currentValue * Math.pow(1 + appreciationRate, 2) * 100) / 100;
  const forecast5y = Math.round(currentValue * Math.pow(1 + appreciationRate, 5) * 100) / 100;

  return {
    retail_price: msrp,
    current_value: currentValue,
    forecast_2y: forecast2y,
    forecast_5y: forecast5y,
  };
}
