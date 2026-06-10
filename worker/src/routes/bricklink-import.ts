/**
 * POST /api/bricklink/import-csv
 *
 * Accepts a BrickLink "My Orders" CSV export and imports matched sets into
 * user_collection. BrickLink CSV format:
 *
 * Order ID,Date,Seller,Qty,Item Type,Item No,Item Name,Color,Condition,Price,...
 *
 * We extract rows where Item Type = SET, map Item No → set_num (adding -1 suffix
 * if missing), and create collection entries with purchase_price from the Price
 * column and purchased_at from the Date column.
 */

import { Hono } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', requireMember);

// POST /api/bricklink/import-csv — parse a BrickLink order CSV and import sets
app.post('/import-csv', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ csv?: string }>()
    .catch(() => ({} as { csv?: string }));
  const csvText = body.csv;
  if (!csvText || typeof csvText !== 'string') return c.json({ error: 'csv field required' }, 400);
  if (csvText.length > 2_000_000) return c.json({ error: 'CSV too large (max 2 MB)' }, 413);

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

  if (itemNoIdx === null) {
    return c.json({ error: 'CSV missing "Item No" column — export from BrickLink Orders page' }, 400);
  }

  let added = 0;
  let skipped = 0;
  const errors: string[] = [];

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

    const priceRaw = priceIdx !== null ? parseFloat((cells[priceIdx] || '').replace(/[^0-9.]/g, '')) : NaN;
    const purchasePrice = isFinite(priceRaw) && priceRaw > 0 ? priceRaw : null;

    let purchasedAt: string | null = null;
    if (dateIdx !== null) {
      const raw = (cells[dateIdx] || '').trim();
      // BrickLink dates: "Oct 15, 2023" or "2023-10-15" or "10/15/2023"
      const parsed = new Date(raw);
      if (!isNaN(parsed.getTime())) {
        purchasedAt = parsed.toISOString().slice(0, 10);
      }
    }

    const qty = qtyIdx !== null ? Math.max(1, parseInt(cells[qtyIdx] || '1') || 1) : 1;

    const condRaw = conditionIdx !== null ? (cells[conditionIdx] || '').toLowerCase().trim() : '';
    const condition = condRaw === 'u' || condRaw === 'used' ? 'used_good' : 'new';

    const known = await c.env.DB.prepare('SELECT set_num FROM lego_sets WHERE set_num=?').bind(setNum).first();
    if (!known) { skipped++; errors.push(`${setNum}: not in catalog`); continue; }

    await c.env.DB.prepare(`
      INSERT INTO user_collection (user_id, set_num, quantity, condition, purchase_price, purchased_at,
        acquisition_source, last_modified, added_at)
      VALUES (?, ?, ?, ?, ?, ?, 'bricklink', datetime('now'), datetime('now'))
      ON CONFLICT (user_id, set_num) DO NOTHING
    `).bind(userId, setNum, qty, condition, purchasePrice, purchasedAt).run();
    added++;
  }

  return c.json({ ok: true, added, skipped, errors: errors.slice(0, 20) });
});

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
