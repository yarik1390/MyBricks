/**
 * One-off data migration: reads JSON exported from Hatchable and seeds D1.
 *
 * Usage:
 *   1. Export from Hatchable using execute_sql MCP:
 *        SELECT json_agg(row_to_json(t)) FROM (SELECT * FROM lego_themes) t
 *        SELECT json_agg(row_to_json(t)) FROM (SELECT * FROM lego_sets) t
 *        SELECT json_agg(row_to_json(t)) FROM (SELECT * FROM minifigs) t
 *   2. Save results as data/themes.json, data/sets.json, data/minifigs.json
 *   3. Run: npx tsx scripts/seed-d1.ts
 *
 * Requires CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID
 * as environment variables (or use wrangler d1 execute --file).
 *
 * Alternatively, convert this script's output to SQL INSERT files and
 * load them with: wrangler d1 execute brickvault --file=seed.sql
 */

import { readFileSync, writeFileSync } from 'fs';

const BATCH = 50; // rows per SQL INSERT statement (conservative for D1)

function toSqlValue(v: unknown): string {
  if (v == null) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

function generateInserts(tableName: string, rows: Record<string, unknown>[], onConflict: string): string[] {
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]);
  const cols = keys.join(', ');
  const stmts: string[] = [];

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const values = batch.map(row => `(${keys.map(k => toSqlValue(row[k])).join(', ')})`).join(',\n  ');
    stmts.push(`INSERT INTO ${tableName} (${cols}) VALUES\n  ${values}\n${onConflict};`);
  }
  return stmts;
}

function loadJson(path: string): unknown[] {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { console.warn(`Warning: ${path} not found, skipping`); return []; }
}

const themes = loadJson('data/themes.json') as Record<string, unknown>[];
const sets   = loadJson('data/sets.json') as Record<string, unknown>[];
const figs   = loadJson('data/minifigs.json') as Record<string, unknown>[];

const lines: string[] = ['PRAGMA foreign_keys = ON;', ''];

for (const stmt of generateInserts('lego_themes', themes, 'ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id')) {
  lines.push(stmt, '');
}
for (const stmt of generateInserts('lego_sets', sets, 'ON CONFLICT (set_num) DO UPDATE SET name=EXCLUDED.name, year=EXCLUDED.year, theme=EXCLUDED.theme, pieces=EXCLUDED.pieces, minifigs=EXCLUDED.minifigs, image_url=COALESCE(EXCLUDED.image_url, lego_sets.image_url), retail_price=EXCLUDED.retail_price, current_value=EXCLUDED.current_value, forecast_2y=EXCLUDED.forecast_2y, forecast_5y=EXCLUDED.forecast_5y')) {
  lines.push(stmt, '');
}
for (const stmt of generateInserts('minifigs', figs, 'ON CONFLICT (fig_num) DO UPDATE SET name=EXCLUDED.name, image_url=COALESCE(EXCLUDED.image_url, minifigs.image_url)')) {
  lines.push(stmt, '');
}

const out = lines.join('\n');
writeFileSync('seed.sql', out);
console.log(`Written seed.sql — ${themes.length} themes, ${sets.length} sets, ${figs.length} figs`);
console.log('Load with: wrangler d1 execute brickvault --remote --file=seed.sql');
