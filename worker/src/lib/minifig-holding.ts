export const MINIFIG_CONDITIONS = ['unknown', 'new', 'used_good', 'used_acceptable'] as const;

export type MinifigCondition = typeof MINIFIG_CONDITIONS[number];

export type MinifigHoldingInput = {
  quantity?: number;
  condition?: MinifigCondition;
  purchase_price?: number | null;
  purchased_at?: string | null;
  notes?: string | null;
};

const HOLDING_FIELDS = new Set(['quantity', 'condition', 'purchase_price', 'purchased_at', 'notes']);

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function parseMinifigHoldingBody(raw: string): MinifigHoldingInput {
  if (!raw.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Request body must be valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Request body must be a JSON object');
  }

  const body = value as Record<string, unknown>;
  const unknown = Object.keys(body).find((key) => !HOLDING_FIELDS.has(key));
  if (unknown) throw new Error(`Unsupported field: ${unknown}`);

  if (Object.hasOwn(body, 'quantity')
    && (typeof body.quantity !== 'number' || !Number.isInteger(body.quantity)
      || body.quantity < 1 || body.quantity > 9999)) {
    throw new Error('quantity must be an integer from 1 to 9999');
  }
  if (Object.hasOwn(body, 'condition')
    && (typeof body.condition !== 'string'
      || !MINIFIG_CONDITIONS.includes(body.condition as MinifigCondition))) {
    throw new Error('condition must be unknown, new, used_good, or used_acceptable');
  }
  if (Object.hasOwn(body, 'purchase_price')
    && body.purchase_price !== null
    && (typeof body.purchase_price !== 'number'
      || !Number.isFinite(body.purchase_price) || body.purchase_price < 0)) {
    throw new Error('purchase_price must be null or a finite non-negative number');
  }
  if (Object.hasOwn(body, 'purchased_at')
    && body.purchased_at !== null
    && (typeof body.purchased_at !== 'string' || !isRealDate(body.purchased_at))) {
    throw new Error('purchased_at must be null or a real YYYY-MM-DD date');
  }
  if (Object.hasOwn(body, 'notes')
    && body.notes !== null
    && (typeof body.notes !== 'string' || body.notes.length > 2000)) {
    throw new Error('notes must be null or a string up to 2000 characters');
  }
  return body as MinifigHoldingInput;
}

export function minifigCsvField(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
