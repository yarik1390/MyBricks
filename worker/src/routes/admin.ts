import { Hono } from 'hono';
import { requireAdmin } from '../auth';
import { formulaValuation } from '../lib/valuation';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', requireAdmin);

const CDN = 'https://cdn.rebrickable.com/media/downloads';
const BATCH = 100;
const CONCURRENT = 10; // parallel D1 batch calls

async function fetchGzip(url: string): Promise<string> {
  const resp = await fetch(url, { headers: { 'User-Agent': 'Brickvault-Import/1.0' } });
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

async function runBatches(db: D1Database, allStmts: D1PreparedStatement[]) {
  const chunks: D1PreparedStatement[][] = [];
  for (let i = 0; i < allStmts.length; i += BATCH) chunks.push(allStmts.slice(i, i + BATCH));
  for (let i = 0; i < chunks.length; i += CONCURRENT) {
    await Promise.all(chunks.slice(i, i + CONCURRENT).map(c => db.batch(c)));
  }
}

async function importSets(db: D1Database) {
  const [themesText, setsText] = await Promise.all([
    fetchGzip(`${CDN}/themes.csv.gz`),
    fetchGzip(`${CDN}/sets.csv.gz`),
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
  await runBatches(db, themeRows.map(t =>
    db.prepare('INSERT INTO lego_themes (id,name,parent_id) VALUES (?,?,?) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,parent_id=EXCLUDED.parent_id')
      .bind(parseInt(t.id!), t.name, t.parent_id ? parseInt(t.parent_id) : null)
  ));

  const sets = parseCSV(setsText).filter(s => s.set_num && s.name);
  let skipped = 0;
  const setStmts: D1PreparedStatement[] = [];

  for (const s of sets) {
    const pieces = parseInt(s.num_parts || '0') || 0;
    const year = parseInt(s.year || '0') || null;
    const theme = s.theme_id ? (themeMap[s.theme_id] || null) : null;
    const minifigs = parseInt(s.num_minifigs || '0') || 0;
    const img = s.img_url && s.img_url !== 'None' ? s.img_url : null;
    let vals;
    try { vals = formulaValuation({ pieces, year: year ?? undefined, theme, retired: false }); }
    catch { skipped++; continue; }
    setStmts.push(db.prepare(`
      INSERT INTO lego_sets (set_num,name,year,theme,pieces,minifigs,image_url,retail_price,current_value,forecast_2y,forecast_5y,valuation_method,source,cached_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'formula_bulk','rebrickable',datetime('now'))
      ON CONFLICT (set_num) DO UPDATE SET
        name=EXCLUDED.name, year=EXCLUDED.year, theme=EXCLUDED.theme,
        pieces=EXCLUDED.pieces, minifigs=EXCLUDED.minifigs,
        image_url=COALESCE(EXCLUDED.image_url, lego_sets.image_url),
        retail_price=CASE WHEN lego_sets.valuation_method='ai' THEN lego_sets.retail_price ELSE EXCLUDED.retail_price END,
        current_value=CASE WHEN lego_sets.valuation_method='ai' THEN lego_sets.current_value ELSE EXCLUDED.current_value END,
        forecast_2y=CASE WHEN lego_sets.valuation_method='ai' THEN lego_sets.forecast_2y ELSE EXCLUDED.forecast_2y END,
        forecast_5y=CASE WHEN lego_sets.valuation_method='ai' THEN lego_sets.forecast_5y ELSE EXCLUDED.forecast_5y END,
        valuation_method=CASE WHEN lego_sets.valuation_method='ai' THEN 'ai' ELSE 'formula_bulk' END,
        source='rebrickable', cached_at=datetime('now')
    `).bind(s.set_num, s.name, year, theme, pieces, minifigs, img,
            vals.retail_price, vals.current_value, vals.forecast_2y, vals.forecast_5y));
  }

  await runBatches(db, setStmts);
  return { loaded: setStmts.length, skipped, themes: themeRows.length };
}

async function importFigs(db: D1Database) {
  const text = await fetchGzip(`${CDN}/minifigs.csv.gz`);
  const figs = parseCSV(text).filter(f => f.fig_num && f.name);
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
  await runBatches(db, stmts);
  return { loaded: stmts.length };
}

app.post('/import-rebrickable', async (c) => {
  const body = await c.req.json<{ dataset?: string }>().catch(() => ({ dataset: undefined }));
  const dataset = body.dataset ?? 'sets';
  if (!['sets', 'figs', 'all'].includes(dataset)) {
    return c.json({ error: "dataset must be 'sets', 'figs', or 'all'" }, 400);
  }

  // Clear any runs stuck for more than 5 minutes before checking for active ones.
  await c.env.DB.prepare(
    `UPDATE import_runs SET status='error',error='Timed out',completed_at=datetime('now') WHERE status='running' AND started_at <= datetime('now','-5 minutes')`
  ).run();

  const active = await c.env.DB.prepare(
    `SELECT id, started_at FROM import_runs WHERE status='running' AND started_at > datetime('now','-5 minutes') ORDER BY started_at DESC LIMIT 1`
  ).first<{ id: number; started_at: string }>();
  if (active) {
    return c.json({ error: 'An import is already running.', run_id: active.id, started_at: active.started_at }, 409);
  }

  const run = await c.env.DB.prepare(
    "INSERT INTO import_runs (status) VALUES ('running')"
  ).run();
  const runId = run.meta.last_row_id;

  // Run the actual import in the background so the response returns immediately.
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const result: Record<string, unknown> = {};
        if (dataset === 'sets' || dataset === 'all') {
          const r = await importSets(c.env.DB);
          result.sets_loaded = r.loaded;
          result.sets_skipped = r.skipped;
          result.themes_loaded = r.themes;
        }
        if (dataset === 'figs' || dataset === 'all') {
          const r = await importFigs(c.env.DB);
          result.figs_loaded = r.loaded;
        }
        await c.env.DB.prepare(
          'UPDATE import_runs SET status=?,completed_at=datetime(\'now\'),themes_loaded=?,sets_loaded=?,sets_skipped=?,figs_loaded=? WHERE id=?'
        ).bind('completed', result.themes_loaded ?? null, result.sets_loaded ?? null,
               result.sets_skipped ?? null, result.figs_loaded ?? null, runId).run();
      } catch (e) {
        await c.env.DB.prepare(
          "UPDATE import_runs SET status='error',error=?,completed_at=datetime('now') WHERE id=?"
        ).bind((e as Error).message, runId).run();
      }
    })()
  );

  return c.json({ ok: true, status: 'running', run_id: runId });
});

app.get('/import-status/:id', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare(
    'SELECT id, status, started_at, completed_at, themes_loaded, sets_loaded, sets_skipped, figs_loaded, error FROM import_runs WHERE id=?'
  ).bind(id).first<Record<string, unknown>>();
  if (!row) return c.json({ error: 'run not found' }, 404);
  return c.json(row);
});

export { app as adminRoute };
