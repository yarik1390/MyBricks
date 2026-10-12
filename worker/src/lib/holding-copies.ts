// Per-copy tracking (table holding_copies). A holding (user_collection row) is
// one row per set; copies split it into physical units, each with its own
// condition, price paid, date, source, shelf and notes.
//
// Copies are opt-in: none exist until the collector opens "Your copies", which
// materializes one copy per unit from the holding's own fields. From then on
// the holding is the aggregate of its active copies (see aggregateCopies), so
// every existing reader — valuation, Vault totals, exports — keeps working.

export const COPY_CONDITIONS = ['new', 'used_good', 'used_acceptable', 'sealed'] as const;
export type CopyCondition = typeof COPY_CONDITIONS[number];

export interface CopyRow {
  id: number;
  user_id: string;
  set_num: string;
  condition: CopyCondition;
  purchase_price: number | null;
  purchased_at: string | null;
  storage_location: string | null;
  acquisition_source: string | null;
  notes: string | null;
  box_grade?: string | null;
  box_notes?: string | null;
  sold_price: number | null;
  sold_at: string | null;
  sold_fees: number | null;
  created_at: string;
  deleted_at: string | null;
}

export interface HoldingRow {
  id: number;
  user_id: string;
  set_num: string;
  quantity: number;
  condition: CopyCondition;
  purchase_price: number | null;
  purchased_at: string | null;
  storage_location: string | null;
  acquisition_source: string | null;
}

/**
 * The holding fields implied by its active copies:
 *  - quantity: active copies
 *  - purchase_price: average paid over the copies with a price (null if none)
 *  - purchased_at: earliest purchase date
 *  - condition: the most common condition (ties go to the oldest copy's)
 *  - storage_location / acquisition_source: shared value, else null ("varies")
 */
export function aggregateCopies(copies: Pick<CopyRow, 'condition' | 'purchase_price' | 'purchased_at' | 'storage_location' | 'acquisition_source'>[]) {
  const priced = copies.map((c) => c.purchase_price).filter((p): p is number => typeof p === 'number' && p >= 0);
  const dates = copies.map((c) => c.purchased_at).filter((d): d is string => !!d).sort();
  const counts = new Map<string, number>();
  for (const c of copies) counts.set(c.condition, (counts.get(c.condition) || 0) + 1);
  let condition: string | null = null;
  let best = 0;
  for (const c of copies) {
    const n = counts.get(c.condition) || 0;
    if (n > best) { best = n; condition = c.condition; }
  }
  const shared = (key: 'storage_location' | 'acquisition_source') => {
    const values = new Set(copies.map((c) => c[key] || null));
    return values.size === 1 ? [...values][0] : null;
  };
  return {
    quantity: copies.length,
    purchase_price: priced.length ? Math.round(priced.reduce((s, p) => s + p, 0) / priced.length * 100) / 100 : null,
    purchased_at: dates[0] ?? null,
    condition,
    storage_location: shared('storage_location'),
    acquisition_source: shared('acquisition_source'),
  };
}

export async function activeCopies(db: D1Database, userId: string, setNum: string): Promise<CopyRow[]> {
  try {
    const { results } = await db.prepare(
      `SELECT * FROM holding_copies WHERE user_id = ? AND set_num = ? AND deleted_at IS NULL AND sold_at IS NULL
        ORDER BY id ASC`,
    ).bind(userId, setNum).all<CopyRow>();
    return results || [];
  } catch (err) {
    // Only a missing table (a fixture or a DB before its migration) reads as
    // "not tracked per copy"; anything else is a real failure.
    if (/no such table/i.test(String((err as Error)?.message))) return [];
    throw err;
  }
}

const insertCopy = (db: D1Database, h: HoldingRow, from?: Partial<CopyRow>) => db.prepare(
  `INSERT INTO holding_copies (user_id, set_num, condition, purchase_price, purchased_at, storage_location, acquisition_source, notes)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
).bind(
  h.user_id, h.set_num,
  from?.condition ?? h.condition ?? 'sealed',
  from?.purchase_price !== undefined ? from.purchase_price : h.purchase_price,
  from?.purchased_at !== undefined ? from.purchased_at : h.purchased_at,
  from?.storage_location !== undefined ? from.storage_location : h.storage_location,
  from?.acquisition_source !== undefined ? from.acquisition_source : h.acquisition_source,
  from?.notes ?? null,
);

/** Create one copy per unit from the holding, when it has none yet. */
export async function materializeCopies(db: D1Database, h: HoldingRow): Promise<CopyRow[]> {
  const existing = await activeCopies(db, h.user_id, h.set_num);
  if (existing.length) return existing;
  const n = Math.max(1, Math.floor(Number(h.quantity) || 1));
  await db.batch(Array.from({ length: n }, () => insertCopy(db, h)));
  return activeCopies(db, h.user_id, h.set_num);
}

/** Write the aggregate of the active copies back onto the holding. */
export async function syncHoldingFromCopies(db: D1Database, userId: string, setNum: string): Promise<void> {
  const copies = await activeCopies(db, userId, setNum);
  if (!copies.length) return;
  const agg = aggregateCopies(copies);
  await db.prepare(
    `UPDATE user_collection
        SET quantity = ?, purchase_price = ?, purchased_at = ?, condition = COALESCE(?, condition),
            storage_location = ?, acquisition_source = ?, last_modified = datetime('now')
      WHERE user_id = ? AND set_num = ? AND deleted_at IS NULL`,
  ).bind(agg.quantity, agg.purchase_price, agg.purchased_at, agg.condition,
    agg.storage_location, agg.acquisition_source, userId, setNum).run();
}

/**
 * Keep tracked copies in step when the holding's quantity changes elsewhere
 * (the quantity stepper, adding the set again). More units clone the newest
 * copy without its notes; fewer remove the newest copies. No-op when the
 * holding isn't tracked per copy.
 */
export async function syncCopiesToQuantity(db: D1Database, userId: string, setNum: string): Promise<void> {
  const copies = await activeCopies(db, userId, setNum);
  if (!copies.length) return;
  const h = await db.prepare(
    'SELECT * FROM user_collection WHERE user_id = ? AND set_num = ? AND deleted_at IS NULL',
  ).bind(userId, setNum).first<HoldingRow>();
  if (!h) return;
  const want = Math.max(1, Math.floor(Number(h.quantity) || 1));
  if (want > copies.length) {
    const last = copies[copies.length - 1];
    await db.batch(Array.from({ length: want - copies.length }, () => insertCopy(db, h, { ...last, notes: null })));
  } else if (want < copies.length) {
    const drop = copies.slice(want).map((c) => c.id);
    await db.prepare(
      `UPDATE holding_copies SET deleted_at = datetime('now') WHERE user_id = ? AND id IN (${drop.map(() => '?').join(',')})`,
    ).bind(userId, ...drop).run();
  }
  await syncHoldingFromCopies(db, userId, setNum);
}

/** Apply holding-level edits (price, condition, date…) to every active copy. */
export async function applyHoldingFieldsToCopies(db: D1Database, userId: string, setNum: string, fields: Record<string, unknown>): Promise<void> {
  const keys = ['condition', 'purchase_price', 'purchased_at', 'storage_location', 'acquisition_source'].filter((k) => k in fields);
  if (!keys.length) return;
  await db.prepare(
    `UPDATE holding_copies SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now')
      WHERE user_id = ? AND set_num = ? AND deleted_at IS NULL AND sold_at IS NULL`,
  ).bind(...keys.map((k) => fields[k] ?? null), userId, setNum).run();
}

/** Retire every active copy (the holding was removed or sold as a whole). */
export async function closeCopies(db: D1Database, userId: string, setNum: string, sale?: { soldAt: string }): Promise<void> {
  await db.prepare(
    sale
      ? `UPDATE holding_copies SET sold_at = ?, updated_at = datetime('now') WHERE user_id = ? AND set_num = ? AND deleted_at IS NULL AND sold_at IS NULL`
      : `UPDATE holding_copies SET deleted_at = datetime('now') WHERE user_id = ? AND set_num = ? AND deleted_at IS NULL AND sold_at IS NULL`,
  ).bind(...(sale ? [sale.soldAt, userId, setNum] : [userId, setNum])).run();
}
