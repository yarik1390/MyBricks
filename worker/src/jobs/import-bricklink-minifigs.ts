import type { Env } from '../types';
import { parseMinifigCatalog } from '../lib/bricklink-minifigs';

// Import BrickLink's minifig catalog export (TAB-separated) into the
// bricklink_minifigs table. Idempotent (upsert by bl_id) so re-uploads refresh.
// Self-creates the table so it works even before the migration has run.
export async function importBrickLinkMinifigs(
  env: Env,
  text: string,
): Promise<{ parsed: number; inserted: number }> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS bricklink_minifigs (
       bl_id TEXT PRIMARY KEY, name TEXT, norm_name TEXT, category TEXT, year INTEGER
     )`,
  ).run();
  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_bl_mf_norm ON bricklink_minifigs(norm_name)`,
  ).run().catch(() => {});

  const rows = parseMinifigCatalog(text);
  if (!rows.length) return { parsed: 0, inserted: 0 };

  let inserted = 0;
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK).map((r) =>
      env.DB.prepare(
        `INSERT INTO bricklink_minifigs (bl_id, name, norm_name, category, year)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(bl_id) DO UPDATE SET name=?2, norm_name=?3, category=?4, year=?5`,
      ).bind(r.bl_id, r.name, r.norm_name, r.category, r.year),
    );
    try {
      await env.DB.batch(batch);
      inserted += batch.length;
    } catch (e) {
      console.warn('[bl-minifigs import] batch failed:', (e as Error).message);
    }
  }
  return { parsed: rows.length, inserted };
}
