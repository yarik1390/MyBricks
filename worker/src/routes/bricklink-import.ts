/**
 * POST /api/bricklink/import-csv
 *
 * Accepts a BrickLink order CSV export and imports the SET rows. Two modes:
 *
 * - `purchases` (default): "My Orders" — sets the collector BOUGHT. Each set
 *   becomes a collection entry with purchase_price / purchased_at.
 * - `sales`: "Orders Received" — sets the collector SOLD from their store.
 *   Each set is recorded as a sale (sold_price / sold_at), exactly like the
 *   set page's "Mark as sold" sheet: an active holding leaves the vault, and a
 *   sale with no holding is kept as a sold-only record. Sales feed the
 *   first-party community comps (k-gated, aggregates only).
 *
 * BrickLink CSV format (header-matched, column order is not assumed):
 *
 * Order ID,Date,Seller,Qty,Item Type,Item No,Item Name,Color,Condition,Price,...
 *
 * Price is the unit price. It is converted to USD from, in order: a Currency
 * column, a currency code in the price cell ("EUR 12.50"), or the `currency`
 * the client sends (the collector's app currency). Stored values stay in USD.
 */

import { Hono } from 'hono';
import { requireMember } from '../auth';
import { scheduleBuildCacheRecompute } from '../lib/build-matcher';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', requireMember);

type ImportMode = 'purchases' | 'sales';

interface ParsedRow {
  setNum: string;
  qty: number;
  condition: string;
  unitPriceUsd: number | null;
  date: string | null;
}

// POST /api/bricklink/import-csv — parse a BrickLink order CSV and import sets
app.post('/import-csv', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ csv?: string; mode?: string; currency?: string }>()
    .catch(() => ({} as { csv?: string; mode?: string; currency?: string }));
  const csvText = body.csv;
  if (!csvText || typeof csvText !== 'string') return c.json({ error: 'csv field required' }, 400);
  if (csvText.length > 2_000_000) return c.json({ error: 'CSV too large (max 2 MB)' }, 413);
  const mode: ImportMode = body.mode === 'sales' ? 'sales' : 'purchases';
  const defaultCurrency = normalizeCurrency(body.currency) ?? 'USD';

  const lines = csvText.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return c.json({ error: 'CSV must have a header and at least one row' }, 400);

  // Parse CSV header to find column indices
  const header = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
  const col = (name: string) => {
    const idx = header.findIndex(h => h.includes(name));
    return idx >= 0 ? idx : null;
  };

  const itemTypeIdx = col('item type') ?? col('type');
  const itemNoIdx = col('item no') ?? col('item number') ?? col('number');
  const priceIdx = col('price') ?? col('unit price');
  const dateIdx = col('date');
  const qtyIdx = col('qty') ?? col('quantity');
  const conditionIdx = col('condition') ?? col('new/used') ?? col('used');
  const currencyIdx = col('currency');

  if (itemNoIdx === null) {
    return c.json({ error: 'CSV missing "Item No" column — export from BrickLink Orders page' }, 400);
  }

  const rates = await loadUsdRates(c.env);

  let added = 0;
  let sold = 0;
  let skipped = 0;
  const errors: string[] = [];

  // First pass: parse every SET row into a record (no DB calls in the loop).
  const parsed: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i]);
    if (!cells.length) continue;

    // Filter to SET type only if Item Type column exists
    if (itemTypeIdx !== null) {
      const type = (cells[itemTypeIdx] || '').toUpperCase().trim();
      if (type && type !== 'SET' && type !== 'S') { skipped++; continue; }
    }

    const rawNum = (cells[itemNoIdx] || '').trim();
    if (!rawNum) continue;

    // BrickLink set numbers: "75192" → "75192-1", "75192-1" → "75192-1"
    const setNum = rawNum.includes('-') ? rawNum : `${rawNum}-1`;

    let unitPriceUsd: number | null = null;
    if (priceIdx !== null) {
      const cell = cells[priceIdx] || '';
      const amount = parseMoney(cell);
      if (amount !== null) {
        const currency = (currencyIdx !== null ? normalizeCurrency(cells[currencyIdx]) : null)
          ?? currencyInCell(cell) ?? defaultCurrency;
        unitPriceUsd = toUsd(amount, currency, rates);
        if (unitPriceUsd === null) {
          // A purchase still lands in the vault without its price; a sale is
          // nothing without one.
          errors.push(`${setNum}: no exchange rate for ${currency}`);
          if (mode === 'sales') { skipped++; continue; }
        }
      }
    }

    let date: string | null = null;
    if (dateIdx !== null) {
      const raw = (cells[dateIdx] || '').trim();
      // BrickLink dates: "Oct 15, 2023" or "2023-10-15" or "10/15/2023"
      const parsedDate = new Date(raw);
      if (!isNaN(parsedDate.getTime())) {
        date = parsedDate.toISOString().slice(0, 10);
      }
    }

    const qty = qtyIdx !== null ? Math.max(1, parseInt(cells[qtyIdx] || '1') || 1) : 1;

    const condRaw = conditionIdx !== null ? (cells[conditionIdx] || '').toLowerCase().trim() : '';
    const condition = condRaw === 'u' || condRaw === 'used' ? 'used_good' : 'new';

    parsed.push({ setNum, qty, condition, unitPriceUsd, date });
  }

  // Batch the catalog-existence check: one IN(...) query per 100 distinct sets
  // instead of a SELECT per row (the old N+1).
  const uniqueNums = [...new Set(parsed.map(p => p.setNum))];
  const known = new Set<string>();
  for (let i = 0; i < uniqueNums.length; i += 100) {
    const chunk = uniqueNums.slice(i, i + 100);
    const ph = chunk.map(() => '?').join(',');
    const { results } = await c.env.DB.prepare(
      `SELECT set_num FROM lego_sets WHERE set_num IN (${ph})`
    ).bind(...chunk).all<{ set_num: string }>();
    for (const r of results) known.add(r.set_num);
  }

  const writes: D1PreparedStatement[] = [];
  if (mode === 'purchases') {
    for (const row of parsed) {
      if (!known.has(row.setNum)) { skipped++; errors.push(`${row.setNum}: not in catalog`); continue; }
      writes.push(c.env.DB.prepare(`
        INSERT INTO user_collection (user_id, set_num, quantity, condition, purchase_price, purchased_at,
          acquisition_source, last_modified, added_at)
        VALUES (?, ?, ?, ?, ?, ?, 'bricklink', datetime('now'), datetime('now'))
        ON CONFLICT (user_id, set_num) DO NOTHING
      `).bind(userId, row.setNum, row.qty, row.condition, round2(row.unitPriceUsd), row.date));
      added++;
    }
  } else {
    const sales = new Map<string, { qty: number; totalUsd: number; date: string; condition: string }>();
    for (const row of parsed) {
      if (!known.has(row.setNum)) { skipped++; errors.push(`${row.setNum}: not in catalog`); continue; }
      if (row.unitPriceUsd === null || row.unitPriceUsd <= 0) { skipped++; errors.push(`${row.setNum}: no price`); continue; }
      if (!row.date) { skipped++; errors.push(`${row.setNum}: no order date`); continue; }
      // One vault row per set, so several orders of the same set merge into
      // one sale: total price and copies add up, the latest date wins.
      const prev = sales.get(row.setNum);
      const total = row.unitPriceUsd * row.qty;
      if (prev) {
        prev.qty += row.qty;
        prev.totalUsd += total;
        if (row.date > prev.date) prev.date = row.date;
      } else {
        sales.set(row.setNum, { qty: row.qty, totalUsd: total, date: row.date, condition: row.condition });
      }
    }

    const existing = new Map<string, { quantity: number | null; deleted_at: string | null; sold_price: number | null }>();
    const saleNums = [...sales.keys()];
    for (let i = 0; i < saleNums.length; i += 90) {
      const chunk = saleNums.slice(i, i + 90);
      const ph = chunk.map(() => '?').join(',');
      const { results } = await c.env.DB.prepare(
        `SELECT set_num, quantity, deleted_at, sold_price FROM user_collection WHERE user_id = ? AND set_num IN (${ph})`
      ).bind(userId, ...chunk).all<{ set_num: string; quantity: number | null; deleted_at: string | null; sold_price: number | null }>();
      for (const r of results) existing.set(r.set_num, r);
    }

    let vaultChanged = false;
    for (const [setNum, sale] of sales) {
      const unit = sale.totalUsd / sale.qty;
      const row = existing.get(setNum);
      if (!row) {
        // Sold without ever being logged: keep a sold-only record so the sale
        // shows in realized gains and counts as a community comp.
        writes.push(c.env.DB.prepare(`
          INSERT INTO user_collection (user_id, set_num, quantity, condition, sold_price, sold_at,
            acquisition_source, deleted_at, last_modified, added_at)
          VALUES (?, ?, ?, ?, ?, ?, 'bricklink', datetime('now'), datetime('now'), datetime('now'))
          ON CONFLICT (user_id, set_num) DO NOTHING
        `).bind(userId, setNum, sale.qty, sale.condition, round2(sale.totalUsd), sale.date));
        sold++;
      } else if (row.deleted_at === null) {
        const held = Math.max(1, Number(row.quantity) || 1);
        if (sale.qty < held) {
          skipped++;
          errors.push(`${setNum}: sold ${sale.qty} of ${held} copies — record it on the set page`);
          continue;
        }
        // The holding leaves the vault at the order price for every copy held.
        writes.push(c.env.DB.prepare(`
          UPDATE user_collection
          SET sold_price=?, sold_at=?, deleted_at=datetime('now'), last_modified=datetime('now')
          WHERE user_id=? AND set_num=? AND deleted_at IS NULL
        `).bind(round2(unit * held), sale.date, userId, setNum));
        sold++;
        vaultChanged = true;
      } else if (row.sold_price === null) {
        // Removed earlier without a price: attach the sale to that record.
        writes.push(c.env.DB.prepare(`
          UPDATE user_collection
          SET sold_price=?, sold_at=?, quantity=?, last_modified=datetime('now')
          WHERE user_id=? AND set_num=? AND deleted_at IS NOT NULL AND sold_price IS NULL
        `).bind(round2(sale.totalUsd), sale.date, sale.qty, userId, setNum));
        sold++;
      } else {
        skipped++;
        errors.push(`${setNum}: sale already recorded`);
      }
    }
    if (vaultChanged) scheduleBuildCacheRecompute(c.env, userId, c.executionCtx);
  }

  // Keep write batches modest for invocation headroom.
  for (let i = 0; i < writes.length; i += 100) {
    await c.env.DB.batch(writes.slice(i, i + 100));
  }

  return c.json({ ok: true, mode, added, sold, skipped, errors: errors.slice(0, 20) });
});

const round2 = (n: number | null): number | null => (n === null ? null : Math.round(n * 100) / 100);

function normalizeCurrency(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

// "EUR 12.50", "12.50 GBP", "US $12.50" → the ISO code, when one is present.
function currencyInCell(cell: string): string | null {
  const m = cell.toUpperCase().match(/\b([A-Z]{3})\b/);
  if (m) return m[1];
  if (/US\s*\$/i.test(cell)) return 'USD';
  return null;
}

// Accepts "12.50", "$1,234.56", "EUR 1.234,56" and "12,50".
export function parseMoney(cell: string): number | null {
  let s = cell.replace(/[^0-9.,]/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) {
    // Comma is the decimal separator when it has 1–2 digits after it.
    s = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else {
    s = s.replace(/,/g, '');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Rates are units of each currency per 1 USD (the /api/rates feed, cached in
// KV). USD needs no lookup; any other currency without a rate returns null.
function toUsd(amount: number, currency: string, rates: Record<string, number> | null): number | null {
  if (currency === 'USD') return amount;
  const rate = Number(rates?.[currency]);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return amount / rate;
}

async function loadUsdRates(env: Env): Promise<Record<string, number> | null> {
  const kv = env.CACHE_KV;
  if (!kv) return null;
  try {
    return (await kv.get<Record<string, number>>('fx:usd', 'json'))
      ?? (await kv.get<Record<string, number>>('fx:usd:last_good', 'json'));
  } catch {
    return null;
  }
}

function parseCSVLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

export { app as bricklinkImportRoute };
