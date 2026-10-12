// The realized-sales ledger (table realized_sales): one row per recorded sale,
// whether the collector sold a whole holding or a single tracked copy.
//
// user_collection's sold_* columns describe only the latest state of a holding
// and are cleared when the set is added again, so they can't serve a tax year
// or an accuracy check. Every sale path writes here as well.

export interface SaleInput {
  userId: string;
  setNum: string;
  quantity: number;
  condition?: string | null;
  /** Total paid for the units sold (null when the collector never entered it). */
  costBasis: number | null;
  purchasedAt?: string | null;
  soldPrice: number;
  soldFees?: number | null;
  soldAt: string;
  source: 'holding' | 'copy';
  sourceRef?: string | null;
}

/** Our displayed per-unit value on (or just before) the sale day, else today's. */
export async function valueOnDate(db: D1Database, setNum: string, date: string): Promise<number | null> {
  const snap = await db.prepare(
    `SELECT current_value FROM set_value_history
      WHERE set_num = ? AND snapshot_date <= ? AND snapshot_date >= DATE(?, '-14 days')
      ORDER BY snapshot_date DESC LIMIT 1`,
  ).bind(setNum, date, date).first<{ current_value: number | null }>().catch(() => null);
  if (snap?.current_value && snap.current_value > 0) return snap.current_value;
  const now = await db.prepare(
    `SELECT COALESCE(NULLIF(blended_value, 0), current_value) AS v FROM lego_sets WHERE set_num = ?`,
  ).bind(setNum).first<{ v: number | null }>().catch(() => null);
  return now?.v && now.v > 0 ? now.v : null;
}

export async function recordSale(db: D1Database, sale: SaleInput): Promise<void> {
  const valueAtSale = await valueOnDate(db, sale.setNum, sale.soldAt);
  await db.prepare(
    `INSERT INTO realized_sales (user_id, set_num, quantity, condition, cost_basis, purchased_at,
       sold_price, sold_fees, sold_at, value_at_sale, source, source_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    sale.userId, sale.setNum, Math.max(1, Math.floor(sale.quantity) || 1), sale.condition ?? null,
    sale.costBasis, sale.purchasedAt ?? null, sale.soldPrice, sale.soldFees ?? null, sale.soldAt,
    valueAtSale, sale.source, sale.sourceRef ?? null,
  ).run();
}

/** Validate a sale body shared by the holding and copy sale endpoints. */
export function parseSaleBody(body: { sold_price?: unknown; sold_at?: unknown; sold_fees?: unknown }):
  { ok: true; soldPrice: number; soldAt: string; soldFees: number | null } | { ok: false; error: string } {
  const soldPrice = body.sold_price;
  if (typeof soldPrice !== 'number' || !Number.isFinite(soldPrice) || soldPrice <= 0) {
    return { ok: false, error: 'sold_price must be a number > 0' };
  }
  const soldAt = body.sold_at ?? new Date().toISOString().slice(0, 10);
  if (typeof soldAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(soldAt) || Number.isNaN(Date.parse(soldAt))) {
    return { ok: false, error: 'sold_at must be a valid YYYY-MM-DD date string' };
  }
  const soldFees = body.sold_fees ?? null;
  if (soldFees !== null && (typeof soldFees !== 'number' || !Number.isFinite(soldFees) || soldFees < 0 || soldFees >= soldPrice)) {
    return { ok: false, error: 'sold_fees must be a number >= 0 and below the sold price' };
  }
  return { ok: true, soldPrice, soldAt, soldFees: soldFees as number | null };
}

/**
 * A `sales` CTE over every sale a user recorded: the ledger, plus sold
 * holdings from before the ledger existed (or written by older clients) that
 * have no ledger row for the same set and date. Bind the user id twice.
 * Columns: id, set_num, quantity, cost_basis, sold_price, sold_fees, sold_at,
 * purchased_at, condition, value_at_sale, origin ('ledger' | 'legacy').
 */
export const SALES_CTE = `sales AS (
  SELECT r.id AS id, r.set_num, r.quantity, r.cost_basis, r.sold_price, r.sold_fees, r.sold_at,
         r.purchased_at, r.condition, r.value_at_sale, 'ledger' AS origin
    FROM realized_sales r
   WHERE r.user_id = ? AND r.deleted_at IS NULL
  UNION ALL
  SELECT -uc.id AS id, uc.set_num, COALESCE(uc.quantity, 1) AS quantity,
         CASE WHEN uc.purchase_price IS NOT NULL THEN uc.purchase_price * COALESCE(uc.quantity, 1) END AS cost_basis,
         uc.sold_price, uc.sold_fees, uc.sold_at, uc.purchased_at, uc.condition, NULL AS value_at_sale, 'legacy' AS origin
    FROM user_collection uc
   WHERE uc.user_id = ? AND uc.sold_at IS NOT NULL AND uc.sold_price IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM realized_sales r2
        WHERE r2.user_id = uc.user_id AND r2.set_num = uc.set_num AND r2.sold_at = uc.sold_at
     )
)`;
