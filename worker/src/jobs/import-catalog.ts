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
    db.prepare(`INSERT INTO lego_themes (id,name,parent_id) VALUES (?,?,?)
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,parent_id=EXCLUDED.parent_id
      WHERE EXCLUDED.name IS NOT lego_themes.name OR EXCLUDED.parent_id IS NOT lego_themes.parent_id`)
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

  // Stage the whole dump, then write only genuinely new/changed rows (the
  // pricecharting-bulk pattern). The old row-per-row upsert rewrote all ~27k
  // heavily-indexed lego_sets rows every Sunday even when nothing changed;
  // staging costs ~27k index-light scratch writes and turns the real table's
  // write volume into (new sets + actual deltas), typically a few hundred.
  await db.prepare(`CREATE TABLE IF NOT EXISTS _rb_sets_stage (
    set_num TEXT PRIMARY KEY, name TEXT, year INTEGER, theme TEXT, pieces INTEGER,
    minifigs INTEGER, image_url TEXT, retail_price REAL, current_value REAL,
    forecast_2y REAL, forecast_5y REAL
  )`).run();
  await db.prepare('DELETE FROM _rb_sets_stage').run();

  // 8 rows x 11 cols = 88 binds, under D1's 100-per-statement limit.
  const PER_STMT = 8;
  const ROW_PH = '(?,?,?,?,?,?,?,?,?,?,?)';
  const stageStmts: D1PreparedStatement[] = [];
  let pending: unknown[] = [];
  let pendingRows = 0;
  const flush = () => {
    if (!pendingRows) return;
    const ph = Array.from({ length: pendingRows }, () => ROW_PH).join(',');
    stageStmts.push(db.prepare(
      `INSERT OR REPLACE INTO _rb_sets_stage (set_num,name,year,theme,pieces,minifigs,image_url,retail_price,current_value,forecast_2y,forecast_5y) VALUES ${ph}`,
    ).bind(...pending));
    pending = [];
    pendingRows = 0;
  };
  for (const s of sets) {
    const pieces = parseInt(s.num_parts || '0') || 0;
    const year = parseInt(s.year || '0') || null;
    const theme = s.theme_id ? (themeMap[s.theme_id] || null) : null;
    const minifigs = parseInt(s.num_minifigs || '0') || 0;
    const img = s.img_url && s.img_url !== 'None' ? s.img_url : null;
    let vals;
    try { vals = formulaValuation({ pieces, year: year ?? undefined, theme, retired: isLikelyRetired(year), minifigs }); }
    catch { skipped++; continue; }
    pending.push(s.set_num, s.name, year, theme, pieces, minifigs, img,
      vals.retail_price, vals.current_value, vals.forecast_2y, vals.forecast_5y);
    pendingRows++;
    if (pendingRows >= PER_STMT) flush();
  }
  flush();

  await options.onProgress?.({ current: 0, total: stageStmts.length, label: 'Staging sets' });
  await runBatches(db, stageStmts, {
    onProgress: async (processed) => options.onProgress?.({
      current: processed,
      total: stageStmts.length,
      label: 'Staging sets',
    }),
  });

  await options.onProgress?.({ current: 0, total: null, label: 'Applying set deltas' });
  // Sources whose market-derived values must never be clobbered by the bulk
  // formula placeholder — keep in sync with the guards this replaced.
  const PROTECTED = `('ai','market','ebay_rss','ebay_sold','brickeconomy')`;
  const inserted = await db.prepare(`
    INSERT INTO lego_sets (set_num,name,year,theme,pieces,minifigs,image_url,retail_price,current_value,forecast_2y,forecast_5y,valuation_method,source,cached_at)
    SELECT s.set_num, s.name, s.year, s.theme, s.pieces, s.minifigs, s.image_url,
           s.retail_price, s.current_value, s.forecast_2y, s.forecast_5y,
           'formula_bulk', 'rebrickable', datetime('now')
    FROM _rb_sets_stage s
    WHERE NOT EXISTS (SELECT 1 FROM lego_sets ls WHERE ls.set_num = s.set_num)
  `).run();
  // IS NOT = null-safe inequality: unchanged rows write nothing at all.
  const updated = await db.prepare(`
    UPDATE lego_sets AS ls SET
      name = s.name, year = s.year, theme = s.theme,
      pieces = s.pieces, minifigs = s.minifigs,
      image_url = COALESCE(s.image_url, ls.image_url),
      retail_price = CASE WHEN ls.valuation_method IN ${PROTECTED} THEN ls.retail_price ELSE s.retail_price END,
      current_value = CASE WHEN ls.valuation_method IN ${PROTECTED} THEN ls.current_value ELSE s.current_value END,
      forecast_2y = CASE WHEN ls.valuation_method IN ${PROTECTED} THEN ls.forecast_2y ELSE s.forecast_2y END,
      forecast_5y = CASE WHEN ls.valuation_method IN ${PROTECTED} THEN ls.forecast_5y ELSE s.forecast_5y END,
      valuation_method = CASE WHEN ls.valuation_method IN ${PROTECTED} THEN ls.valuation_method ELSE 'formula_bulk' END,
      source = 'rebrickable', cached_at = datetime('now')
    FROM _rb_sets_stage AS s
    WHERE s.set_num = ls.set_num AND (
      s.name IS NOT ls.name OR s.year IS NOT ls.year OR s.theme IS NOT ls.theme
      OR s.pieces IS NOT ls.pieces OR s.minifigs IS NOT ls.minifigs
      OR COALESCE(s.image_url, ls.image_url) IS NOT ls.image_url
      OR (ls.valuation_method NOT IN ${PROTECTED} AND (
        s.retail_price IS NOT ls.retail_price OR s.current_value IS NOT ls.current_value
        OR s.forecast_2y IS NOT ls.forecast_2y OR s.forecast_5y IS NOT ls.forecast_5y
        OR ls.valuation_method IS NOT 'formula_bulk'))
    )
  `).run();
  await db.prepare('DELETE FROM _rb_sets_stage').run();

  return { loaded: sets.length - skipped, skipped, themes: themeRows.length, inserted: inserted.meta?.changes ?? 0, updated: updated.meta?.changes ?? 0 };
}

export async function importFigs(db: D1Database, env?: Env, options: CatalogImportOptions = {}) {
  await options.onProgress?.({ current: 0, total: null, label: 'Downloading Rebrickable minifigs' });
  const text = await fetchGzip(`${CDN}/minifigs.csv.gz`, env);
  const figs = parseCSV(text).filter(f => f.fig_num && f.name);
  await options.onProgress?.({ current: 0, total: figs.length, label: 'Staging minifigs' });

  // Same staging + delta pattern as importSets: only new/changed figs write.
  await db.prepare(`CREATE TABLE IF NOT EXISTS _rb_figs_stage (
    fig_num TEXT PRIMARY KEY, name TEXT, image_url TEXT
  )`).run();
  await db.prepare('DELETE FROM _rb_figs_stage').run();

  // 30 rows x 3 cols = 90 binds, under D1's 100-per-statement limit.
  const PER_STMT = 30;
  const stageStmts: D1PreparedStatement[] = [];
  for (let i = 0; i < figs.length; i += PER_STMT) {
    const slice = figs.slice(i, i + PER_STMT);
    const ph = slice.map(() => '(?,?,?)').join(',');
    const binds: unknown[] = [];
    for (const f of slice) {
      binds.push(f.fig_num, f.name, f.img_url && f.img_url !== 'None' ? f.img_url : null);
    }
    stageStmts.push(db.prepare(`INSERT OR REPLACE INTO _rb_figs_stage (fig_num,name,image_url) VALUES ${ph}`).bind(...binds));
  }
  await runBatches(db, stageStmts, {
    onProgress: async (processed) => options.onProgress?.({
      current: processed,
      total: stageStmts.length,
      label: 'Staging minifigs',
    }),
  });

  await options.onProgress?.({ current: 0, total: null, label: 'Applying minifig deltas' });
  const inserted = await db.prepare(`
    INSERT INTO minifigs (fig_num, name, image_url)
    SELECT s.fig_num, s.name, s.image_url FROM _rb_figs_stage s
    WHERE NOT EXISTS (SELECT 1 FROM minifigs m WHERE m.fig_num = s.fig_num)
  `).run();
  const updated = await db.prepare(`
    UPDATE minifigs AS m SET
      name = s.name,
      image_url = COALESCE(s.image_url, m.image_url)
    FROM _rb_figs_stage AS s
    WHERE s.fig_num = m.fig_num AND (
      s.name IS NOT m.name OR COALESCE(s.image_url, m.image_url) IS NOT m.image_url
    )
  `).run();
  await db.prepare('DELETE FROM _rb_figs_stage').run();

  return { loaded: figs.length, inserted: inserted.meta?.changes ?? 0, updated: updated.meta?.changes ?? 0 };
}
