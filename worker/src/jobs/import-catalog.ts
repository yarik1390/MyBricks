import { formulaValuation, isLikelyRetired } from '../lib/valuation';
import type { Env } from '../types';
import { fetchTracked, fetchWithRetry } from '../lib/http';

const CDN = 'https://cdn.rebrickable.com/media/downloads';
export const BATCH = 100;
export const CONCURRENT = 10;

export interface CatalogProgress {
  current: number;
  total: number | null;
  label: string;
}

export interface CatalogImportOptions {
  onProgress?: (progress: CatalogProgress) => Promise<void>;
}

export async function fetchGzip(url: string, env?: Env): Promise<string> {
  const fetcher = env ? fetchTracked.bind(null, env, 'rebrickable') : fetchWithRetry;
  const resp = await fetcher(url, { headers: { 'User-Agent': 'Brickvault-Import/1.0' } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${url}`);
  const buf = await resp.arrayBuffer();
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(new Uint8Array(buf));
  writer.close();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const ch of chunks) { out.set(ch, off); off += ch.length; }
  return new TextDecoder().decode(out);
}

function parseLine(line: string): string[] {
  const cols: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  cols.push(cur.trim());
  return cols;
}

function parseCSV(text: string): Record<string, string | null>[] {
  const lines = text.split('\n');
  const headers = parseLine(lines[0]).map(h => h.trim());
  return lines.slice(1).filter(Boolean).map(line => {
    const vals = parseLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? null]));
  });
}

export async function runBatches(
  db: D1Database,
  allStmts: D1PreparedStatement[],
  options: { onProgress?: (processed: number) => Promise<void> } = {},
) {
  const chunks: D1PreparedStatement[][] = [];
  for (let i = 0; i < allStmts.length; i += BATCH) chunks.push(allStmts.slice(i, i + BATCH));
  let processed = 0;
  for (let i = 0; i < chunks.length; i += CONCURRENT) {
    const group = chunks.slice(i, i + CONCURRENT);
    await Promise.all(group.map(c => db.batch(c)));
    processed += group.reduce((sum, c) => sum + c.length, 0);
    if (options.onProgress) await options.onProgress(Math.min(processed, allStmts.length));
  }
}

export async function importSets(db: D1Database, env?: Env, options: CatalogImportOptions = {}) {
  await options.onProgress?.({ current: 0, total: null, label: 'Downloading Rebrickable sets' });
  const [themesText, setsText] = await Promise.all([
    fetchGzip(`${CDN}/themes.csv.gz`, env),
    fetchGzip(`${CDN}/sets.csv.gz`, env),
  ]);

  const themes = parseCSV(themesText);
  const themeById = Object.fromEntries(themes.map(t => [t.id, t]));
  const themeMap: Record<string, string> = {};
  for (const t of themes) {
    let cur = t;
    for (let i = 0; i < 4 && cur.parent_id; i++) cur = themeById[cur.parent_id] || cur;
    if (t.id) themeMap[t.id] = cur.name || '';
  }

  const themeRows = themes.filter(t => t.id && t.name);
  await options.onProgress?.({ current: 0, total: themeRows.length, label: 'Importing themes' });
  await runBatches(db, themeRows.map(t =>
    db.prepare('INSERT INTO lego_themes (id,name,parent_id) VALUES (?,?,?) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,parent_id=EXCLUDED.parent_id')
      .bind(parseInt(t.id!), t.name, t.parent_id ? parseInt(t.parent_id) : null)
  ), {
    onProgress: async (processed) => options.onProgress?.({
      current: processed,
      total: themeRows.length,
      label: 'Importing themes',
    }),
  });

  const sets = parseCSV(setsText).filter(s => s.set_num && s.name);
  await options.onProgress?.({ current: 0, total: sets.length, label: 'Preparing set records' });
  let skipped = 0;
  const setStmts: D1PreparedStatement[] = [];

  for (const s of sets) {
    const pieces = parseInt(s.num_parts || '0') || 0;
    const year = parseInt(s.year || '0') || null;
    const theme = s.theme_id ? (themeMap[s.theme_id] || null) : null;
    const minifigs = parseInt(s.num_minifigs || '0') || 0;
    const img = s.img_url && s.img_url !== 'None' ? s.img_url : null;
    let vals;
    try { vals = formulaValuation({ pieces, year: year ?? undefined, theme, retired: isLikelyRetired(year), minifigs }); }
    catch { skipped++; continue; }
    setStmts.push(db.prepare(`
      INSERT INTO lego_sets (set_num,name,year,theme,pieces,minifigs,image_url,retail_price,current_value,forecast_2y,forecast_5y,valuation_method,source,cached_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'formula_bulk','rebrickable',datetime('now'))
      ON CONFLICT (set_num) DO UPDATE SET
        name=EXCLUDED.name, year=EXCLUDED.year, theme=EXCLUDED.theme,
        pieces=EXCLUDED.pieces, minifigs=EXCLUDED.minifigs,
        image_url=COALESCE(EXCLUDED.image_url, lego_sets.image_url),
        retail_price=CASE WHEN lego_sets.valuation_method IN ('ai','market','ebay_rss','ebay_sold','brickeconomy') THEN lego_sets.retail_price ELSE EXCLUDED.retail_price END,
        current_value=CASE WHEN lego_sets.valuation_method IN ('ai','market','ebay_rss','ebay_sold','brickeconomy') THEN lego_sets.current_value ELSE EXCLUDED.current_value END,
        forecast_2y=CASE WHEN lego_sets.valuation_method IN ('ai','market','ebay_rss','ebay_sold','brickeconomy') THEN lego_sets.forecast_2y ELSE EXCLUDED.forecast_2y END,
        forecast_5y=CASE WHEN lego_sets.valuation_method IN ('ai','market','ebay_rss','ebay_sold','brickeconomy') THEN lego_sets.forecast_5y ELSE EXCLUDED.forecast_5y END,
        valuation_method=CASE WHEN lego_sets.valuation_method IN ('ai','market','ebay_rss','ebay_sold','brickeconomy') THEN lego_sets.valuation_method ELSE 'formula_bulk' END,
        source='rebrickable', cached_at=datetime('now')
    `).bind(s.set_num, s.name, year, theme, pieces, minifigs, img,
            vals.retail_price, vals.current_value, vals.forecast_2y, vals.forecast_5y));
  }

  await options.onProgress?.({ current: 0, total: setStmts.length, label: 'Importing sets' });
  await runBatches(db, setStmts, {
    onProgress: async (processed) => options.onProgress?.({
      current: processed,
      total: setStmts.length,
      label: 'Importing sets',
    }),
  });
  return { loaded: setStmts.length, skipped, themes: themeRows.length };
}

export async function importFigs(db: D1Database, env?: Env, options: CatalogImportOptions = {}) {
  await options.onProgress?.({ current: 0, total: null, label: 'Downloading Rebrickable minifigs' });
  const text = await fetchGzip(`${CDN}/minifigs.csv.gz`, env);
  const figs = parseCSV(text).filter(f => f.fig_num && f.name);
  await options.onProgress?.({ current: 0, total: figs.length, label: 'Importing minifigs' });
  const stmts = figs.map(f => {
    const img = f.img_url && f.img_url !== 'None' ? f.img_url : null;
    return db.prepare(`
      INSERT INTO minifigs (fig_num,name,image_url)
      VALUES (?,?,?)
      ON CONFLICT (fig_num) DO UPDATE SET
        name=EXCLUDED.name,
        image_url=COALESCE(EXCLUDED.image_url, minifigs.image_url)
    `).bind(f.fig_num, f.name, img);
  });
  await runBatches(db, stmts, {
    onProgress: async (processed) => options.onProgress?.({
      current: processed,
      total: stmts.length,
      label: 'Importing minifigs',
    }),
  });
  return { loaded: stmts.length };
}
