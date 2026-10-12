import { Hono } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';
import {
  activeCopies, closeCopies, COPY_CONDITIONS, materializeCopies, syncCopiesToQuantity, syncHoldingFromCopies,
  type CopyRow, type HoldingRow,
} from '../lib/holding-copies';
import { parseSaleBody, recordSale } from '../lib/realized-sales';
import { scheduleBuildCacheRecompute } from '../lib/build-matcher';

// Per-copy tracking under a holding (mounted at /api/collection).
//
// GET    /:id/copies                  copies of the holding (materialized on first read)
// POST   /:id/copies                  add a copy (quantity + 1)
// PATCH  /:id/copies/:copyId          edit one copy
// DELETE /:id/copies/:copyId          remove one copy (not the last — remove the set instead)
// POST   /:id/copies/:copyId/sell     sell one copy; selling the last one sells the holding
//
// Every response carries the updated holding as `item` (null once sold out)
// and the active copies as `copies`.
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('/:id/copies', requireMember);
app.use('/:id/copies/*', requireMember);

const FREE_TEXT_MAX = 500;
const TEXT_FIELDS = ['storage_location', 'acquisition_source', 'notes'] as const;

type CopyFields = Partial<Pick<CopyRow, 'condition' | 'purchase_price' | 'purchased_at' | 'storage_location' | 'acquisition_source' | 'notes'>>;

/** Validate copy fields; returns the cleaned subset or an error message. */
export function parseCopyFields(body: Record<string, unknown>): { ok: true; fields: CopyFields } | { ok: false; error: string } {
  const fields: CopyFields = {};
  if ('condition' in body) {
    if (!COPY_CONDITIONS.includes(body.condition as never)) return { ok: false, error: 'Invalid condition' };
    fields.condition = body.condition as CopyRow['condition'];
  }
  if ('purchase_price' in body) {
    const p = body.purchase_price;
    if (p !== null && (typeof p !== 'number' || !Number.isFinite(p) || p < 0)) return { ok: false, error: 'Purchase price must be a number >= 0' };
    fields.purchase_price = p as number | null;
  }
  if ('purchased_at' in body) {
    const d = body.purchased_at;
    if (d !== null && d !== '' && (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d)))) {
      return { ok: false, error: 'Purchased at must be a valid YYYY-MM-DD date string' };
    }
    fields.purchased_at = (d || null) as string | null;
  }
  for (const key of TEXT_FIELDS) {
    if (key in body) fields[key] = body[key] == null || body[key] === '' ? null : String(body[key]).slice(0, FREE_TEXT_MAX);
  }
  return { ok: true, fields };
}

async function loadHolding(c: any): Promise<HoldingRow | null> {
  const id = parseInt(c.req.param('id'), 10);
  if (!id) return null;
  return c.env.DB.prepare(
    'SELECT * FROM user_collection WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
  ).bind(id, c.get('userId')).first() as Promise<HoldingRow | null>;
}

async function loadCopy(c: any, h: HoldingRow): Promise<CopyRow | null> {
  const copyId = parseInt(c.req.param('copyId'), 10);
  if (!copyId) return null;
  return c.env.DB.prepare(
    `SELECT * FROM holding_copies WHERE id = ? AND user_id = ? AND set_num = ? AND deleted_at IS NULL AND sold_at IS NULL`,
  ).bind(copyId, h.user_id, h.set_num).first() as Promise<CopyRow | null>;
}

async function respond(c: any, h: HoldingRow, status = 200, changed = true) {
  const item = await c.env.DB.prepare(
    'SELECT * FROM user_collection WHERE user_id = ? AND set_num = ? AND deleted_at IS NULL',
  ).bind(h.user_id, h.set_num).first();
  const copies = item ? await activeCopies(c.env.DB, h.user_id, h.set_num) : [];
  if (changed) scheduleBuildCacheRecompute(c.env, h.user_id, c.executionCtx);
  return c.json({ item: item ? { ...item, is_complete: !!(item as any).is_complete } : null, copies }, status);
}

app.get('/:id/copies', async (c) => {
  const h = await loadHolding(c);
  if (!h) return c.json({ error: 'Not found' }, 404);
  // A bulk import can change the quantity without touching copies; reconcile first.
  await syncCopiesToQuantity(c.env.DB, h.user_id, h.set_num);
  await materializeCopies(c.env.DB, h);
  return respond(c, h, 200, false);
});

app.post('/:id/copies', async (c) => {
  const h = await loadHolding(c);
  if (!h) return c.json({ error: 'Not found' }, 404);
  const parsed = parseCopyFields(await c.req.json<Record<string, unknown>>().catch(() => ({})));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const copies = await materializeCopies(c.env.DB, h);
  if (copies.length >= 999) return c.json({ error: 'Too many copies' }, 400);
  const f = parsed.fields;
  await c.env.DB.prepare(
    `INSERT INTO holding_copies (user_id, set_num, condition, purchase_price, purchased_at, storage_location, acquisition_source, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(h.user_id, h.set_num, f.condition ?? h.condition ?? 'sealed', f.purchase_price ?? null,
    f.purchased_at ?? null, f.storage_location ?? null, f.acquisition_source ?? null, f.notes ?? null).run();
  await syncHoldingFromCopies(c.env.DB, h.user_id, h.set_num);
  return respond(c, h, 201);
});

app.patch('/:id/copies/:copyId', async (c) => {
  const h = await loadHolding(c);
  if (!h) return c.json({ error: 'Not found' }, 404);
  const copy = await loadCopy(c, h);
  if (!copy) return c.json({ error: 'Copy not found' }, 404);
  const parsed = parseCopyFields(await c.req.json<Record<string, unknown>>().catch(() => ({})));
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const keys = Object.keys(parsed.fields) as (keyof CopyFields)[];
  if (!keys.length) return c.json({ error: 'No fields to update' }, 400);
  await c.env.DB.prepare(
    `UPDATE holding_copies SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
  ).bind(...keys.map((k) => parsed.fields[k] ?? null), copy.id, h.user_id).run();
  await syncHoldingFromCopies(c.env.DB, h.user_id, h.set_num);
  return respond(c, h);
});

app.delete('/:id/copies/:copyId', async (c) => {
  const h = await loadHolding(c);
  if (!h) return c.json({ error: 'Not found' }, 404);
  const copy = await loadCopy(c, h);
  if (!copy) return c.json({ error: 'Copy not found' }, 404);
  const copies = await activeCopies(c.env.DB, h.user_id, h.set_num);
  if (copies.length <= 1) return c.json({ error: 'This is the only copy. Remove the set instead.' }, 409);
  await c.env.DB.prepare(`UPDATE holding_copies SET deleted_at = datetime('now') WHERE id = ? AND user_id = ?`)
    .bind(copy.id, h.user_id).run();
  await syncHoldingFromCopies(c.env.DB, h.user_id, h.set_num);
  return respond(c, h);
});

app.post('/:id/copies/:copyId/sell', async (c) => {
  const h = await loadHolding(c);
  if (!h) return c.json({ error: 'Not found' }, 404);
  const copy = await loadCopy(c, h);
  if (!copy) return c.json({ error: 'Copy not found' }, 404);
  const sale = parseSaleBody(await c.req.json<Record<string, unknown>>().catch(() => ({})));
  if (!sale.ok) return c.json({ error: sale.error }, 400);
  const remaining = (await activeCopies(c.env.DB, h.user_id, h.set_num)).filter((x) => x.id !== copy.id);

  await c.env.DB.prepare(
    `UPDATE holding_copies SET sold_price = ?, sold_at = ?, sold_fees = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
  ).bind(sale.soldPrice, sale.soldAt, sale.soldFees, copy.id, h.user_id).run();
  await recordSale(c.env.DB, {
    userId: h.user_id, setNum: h.set_num, quantity: 1, condition: copy.condition,
    costBasis: copy.purchase_price, purchasedAt: copy.purchased_at,
    soldPrice: sale.soldPrice, soldFees: sale.soldFees, soldAt: sale.soldAt,
    source: 'copy', sourceRef: `copy:${copy.id}`,
  });

  if (remaining.length) {
    await syncHoldingFromCopies(c.env.DB, h.user_id, h.set_num);
  } else {
    // The last copy went: the holding is sold out, exactly like a whole-holding sale.
    await c.env.DB.prepare(
      `UPDATE user_collection SET sold_price = ?, sold_at = ?, sold_fees = ?, quantity = 1,
              purchase_price = ?, deleted_at = datetime('now'), last_modified = datetime('now')
        WHERE id = ? AND user_id = ?`,
    ).bind(sale.soldPrice, sale.soldAt, sale.soldFees, copy.purchase_price, h.id, h.user_id).run();
    await closeCopies(c.env.DB, h.user_id, h.set_num, { soldAt: sale.soldAt });
  }
  return respond(c, h);
});

export { app as copiesRoute };
