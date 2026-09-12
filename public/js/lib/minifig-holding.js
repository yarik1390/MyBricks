import { localMoneyToUsd } from './money-input.js';

export const MINIFIG_CONDITIONS = Object.freeze([
  'unknown', 'new', 'used_good', 'used_acceptable',
]);

function realDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function normalizeMinifigHolding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const quantity = Number(value.quantity);
  const condition = MINIFIG_CONDITIONS.includes(value.condition) ? value.condition : 'unknown';
  const purchasePrice = value.purchase_price === '' || value.purchase_price == null
    ? null
    : Number(value.purchase_price);
  const purchasedAt = typeof value.purchased_at === 'string' && realDate(value.purchased_at)
    ? value.purchased_at
    : null;
  const notes = typeof value.notes === 'string' && value.notes.length
    ? value.notes.slice(0, 2000)
    : null;
  return {
    quantity: Number.isInteger(quantity) && quantity >= 1 && quantity <= 9999 ? quantity : 1,
    condition,
    purchase_price: Number.isFinite(purchasePrice) && purchasePrice >= 0 ? purchasePrice : null,
    purchased_at: purchasedAt,
    notes,
  };
}

export function confirmedMinifigHoldingResponse(response, figNum) {
  if (!response || response.ok !== true || response.fig_num !== figNum || !response.holding) return null;
  const holding = response.holding;
  if (!Number.isInteger(holding.quantity) || holding.quantity < 1 || holding.quantity > 9999
    || response.quantity !== holding.quantity
    || !MINIFIG_CONDITIONS.includes(holding.condition)
    || !(holding.purchase_price === null || (typeof holding.purchase_price === 'number' && Number.isFinite(holding.purchase_price) && holding.purchase_price >= 0))
    || !(holding.purchased_at === null || (typeof holding.purchased_at === 'string' && realDate(holding.purchased_at)))
    || !(holding.notes === null || (typeof holding.notes === 'string' && holding.notes.length <= 2000))) return null;
  return { ...holding };
}

export function mergeMinifigHolding(existing, patch = {}) {
  const base = normalizeMinifigHolding(existing) || {
    quantity: 1, condition: 'unknown', purchase_price: null, purchased_at: null, notes: null,
  };
  const next = { ...base };
  if (Object.hasOwn(patch, 'quantity')) {
    if (typeof patch.quantity !== 'number') throw new Error('quantity must be an integer from 1 to 9999');
    const quantity = patch.quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999) throw new Error('quantity must be an integer from 1 to 9999');
    next.quantity = quantity;
  }
  if (Object.hasOwn(patch, 'condition')) {
    if (!MINIFIG_CONDITIONS.includes(patch.condition)) throw new Error('invalid minifig condition');
    next.condition = patch.condition;
  }
  if (Object.hasOwn(patch, 'purchase_price')) {
    if (patch.purchase_price === '' || patch.purchase_price == null) next.purchase_price = null;
    else {
      if (typeof patch.purchase_price !== 'number') throw new Error('purchase_price must be non-negative or null');
      const price = patch.purchase_price;
      if (!Number.isFinite(price) || price < 0) throw new Error('purchase_price must be non-negative or null');
      next.purchase_price = price;
    }
  }
  if (Object.hasOwn(patch, 'purchased_at')) {
    if (patch.purchased_at === '' || patch.purchased_at == null) next.purchased_at = null;
    else if (typeof patch.purchased_at === 'string' && realDate(patch.purchased_at)) next.purchased_at = patch.purchased_at;
    else throw new Error('purchased_at must be a real YYYY-MM-DD date or null');
  }
  if (Object.hasOwn(patch, 'notes')) {
    if (patch.notes === '' || patch.notes == null) next.notes = null;
    else if (typeof patch.notes === 'string' && patch.notes.length <= 2000) next.notes = patch.notes;
    else throw new Error('notes must be at most 2000 characters or null');
  }
  return next;
}

export function parseMinifigHoldingForm(values, moneyContext, { priceChanged = true } = {}) {
  const quantityText = String(values.quantity ?? '').trim();
  if (!/^\d+$/.test(quantityText)) return { valid: false, field: 'quantity', code: 'integer' };
  const quantity = Number(quantityText);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999) {
    return { valid: false, field: 'quantity', code: 'range' };
  }
  const condition = String(values.condition || 'unknown');
  if (!MINIFIG_CONDITIONS.includes(condition)) return { valid: false, field: 'condition', code: 'condition' };
  const purchasedAt = String(values.purchased_at ?? '').trim();
  if (purchasedAt && !realDate(purchasedAt)) return { valid: false, field: 'purchased_at', code: 'date' };
  const notes = String(values.notes ?? '');
  if (notes.length > 2000) return { valid: false, field: 'notes', code: 'length' };

  const payload = {
    quantity,
    condition,
    purchased_at: purchasedAt || null,
    notes: notes.trim() || null,
  };
  if (priceChanged) {
    const price = localMoneyToUsd(values.purchase_price, moneyContext);
    if (!price.valid) return { valid: false, field: 'purchase_price', code: price.code };
    payload.purchase_price = price.blank ? null : price.usd;
  }
  return { valid: true, payload };
}

export function minifigHoldingsCSV(rows = []) {
  const cell = (value) => {
    if (value == null) return '';
    let text = String(value);
    if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const headers = ['fig_num', 'name', 'series', 'quantity', 'condition', 'purchase_price_usd', 'purchased_at', 'notes'];
  const lines = rows.map((row) => {
    const holding = normalizeMinifigHolding(row.holding || row);
    if (!holding) return null;
    return [
      row.fig_num, row.name, row.series, holding.quantity, holding.condition,
      holding.purchase_price ?? '', holding.purchased_at ?? '', holding.notes ?? '',
    ].map(cell).join(',');
  }).filter(Boolean);
  return [headers.join(','), ...lines].join('\n');
}
