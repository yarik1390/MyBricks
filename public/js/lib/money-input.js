// Deliberately narrow parsing for money fields that are stored in USD. This is
// separate from the forgiving search/import parser: accepting grouping or a
// currency symbol here would make a typed local-currency value ambiguous.
export function parseStrictMoneyInput(value, { required = false, positive = false } = {}) {
  const text = String(value ?? '').trim();
  if (!text) return required
    ? { valid: false, code: 'required' }
    : { valid: true, blank: true, value: null, usd: null };
  if (!/^\d+(?:[.,]\d+)?$/.test(text)) return { valid: false, code: 'format' };
  const number = Number(text.replace(',', '.'));
  if (!Number.isFinite(number)) return { valid: false, code: 'finite' };
  if (number === 0 && /[1-9]/.test(text)) return { valid: false, code: 'underflow' };
  if (positive ? number <= 0 : number < 0) return { valid: false, code: positive ? 'positive' : 'nonnegative' };
  return { valid: true, blank: false, value: number };
}

export function resolveMoneyInputContext(preferredCurrency, rates, supportedCurrencies = ['USD', 'GBP', 'EUR', 'CAD', 'AUD']) {
  const requested = String(preferredCurrency || 'USD').toUpperCase();
  const supported = supportedCurrencies.includes(requested);
  const rawRate = requested === 'USD' ? 1 : rates?.[requested];
  const usable = supported && typeof rawRate === 'number' && Number.isFinite(rawRate) && rawRate > 0;
  return usable
    ? { currency: requested, rate: rawRate, fallback: false }
    : { currency: 'USD', rate: 1, fallback: requested !== 'USD' };
}

export function localMoneyToUsd(value, context, options = {}) {
  const parsed = parseStrictMoneyInput(value, options);
  if (!parsed.valid || parsed.blank) return parsed;
  const rate = Number(context?.rate);
  const usd = parsed.value / rate;
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(usd) || (parsed.value > 0 && usd === 0)) {
    return { valid: false, code: 'conversion' };
  }
  return { ...parsed, usd };
}

export function usdMoneyInputValue(usd, context) {
  if (usd == null || usd === '') return '';
  const value = Number(usd);
  const rate = Number(context?.rate);
  if (!Number.isFinite(value) || !Number.isFinite(rate) || rate <= 0) return '';
  const local = value * rate;
  return Number.isFinite(local) ? local.toFixed(2) : '';
}
