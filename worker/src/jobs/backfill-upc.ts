import type { Env } from '../types';
import { fetchBarcodesPage } from '../lib/brickset';

// Paginates through the full Brickset catalog (500 sets/page) and writes UPC
// codes into lego_sets for any set that is missing one. Safe to run repeatedly —
// already-filled rows are skipped via the WHERE upc IS NULL guard.
export async function runBackfillUpc(env: Env): Promise<{ processed: number; filled: number }> {
  if (!env.BRICKSET_API_KEY) return { processed: 0, filled: 0 };

  let processed = 0, filled = 0, page = 1;

  while (true) {
    const result = await fetchBarcodesPage(page, env);
    if (!result || !result.sets.length) break;

    const stmts: D1PreparedStatement[] = [];
    for (const { setNum, upc } of result.sets) {
      if (!upc || !setNum) continue;
      stmts.push(
        env.DB.prepare('UPDATE lego_sets SET upc=? WHERE set_num=? AND upc IS NULL')
          .bind(upc, setNum),
      );
    }

    for (let i = 0; i < stmts.length; i += 100) {
      const res = await env.DB.batch(stmts.slice(i, i + 100));
      filled += res.reduce((sum, r) => sum + (r.meta.changes ?? 0), 0);
    }

    processed += result.sets.length;
    if (processed >= result.total) break;
    page++;
  }

  return { processed, filled };
}
