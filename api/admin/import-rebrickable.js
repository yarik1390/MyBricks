import { db } from 'hatchable';
import { formulaValuation } from 'lib/valuation.js';

export const access = 'admin';
export const methods = ['POST'];

const CDN = 'https://cdn.rebrickable.com/media/downloads';
const BATCH = 200;

async function fetchGzip(url) {
  const resp = await fetch(url, { headers: { 'User-Agent': 'Brickvault-Import/1.0' } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${url}`);
  const buf = await resp.arrayBuffer();
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(new Uint8Array(buf));
  writer.close();
  const reader = ds.readable.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return new TextDecoder().decode(out);
}

function parseLine(line) {
  const cols = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  cols.push(cur.trim());
  return cols;
}

function parseCSV(text) {
  const lines = text.split('\n');
  const headers = parseLine(lines[0]).map(h => h.trim());
  return lines.slice(1).filter(Boolean).map(line => {
    const vals = parseLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? null]));
  });
}

async function importSets() {
  const [themesText, setsText] = await Promise.all([
    fetchGzip(`${CDN}/themes.csv.gz`),
    fetchGzip(`${CDN}/sets.csv.gz`),
  ]);

  const themes = parseCSV(themesText);
  const themeById = Object.fromEntries(themes.map(t => [t.id, t]));

  // Resolve to top-level theme name (walk up parent chain max 4 levels)
  const themeMap = {};
  for (const t of themes) {
    let cur = t;
    for (let i = 0; i < 4 && cur.parent_id; i++) cur = themeById[cur.parent_id] || cur;
    themeMap[t.id] = cur.name;
  }

  // Batch-upsert themes into lego_themes
  const themeRows = themes.filter(t => t.id && t.name);
  for (let i = 0; i < themeRows.length; i += BATCH) {
    const batch = themeRows.slice(i, i + BATCH);
    const ph = [], params = [];
    let p = 1;
    for (const t of batch) {
      ph.push(`($${p},$${p + 1},$${p + 2})`);
      params.push(parseInt(t.id), t.name, t.parent_id ? parseInt(t.parent_id) : null);
      p += 3;
    }
    await db.query(
      `INSERT INTO lego_themes (id,name,parent_id) VALUES ${ph.join(',')}
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,parent_id=EXCLUDED.parent_id`,
      params
    );
  }

  const sets = parseCSV(setsText).filter(s => s.set_num && s.name);
  let loaded = 0, skipped = 0;

  for (let i = 0; i < sets.length; i += BATCH) {
    const batch = sets.slice(i, i + BATCH);
    const ph = [], params = [];
    let p = 1;

    for (const s of batch) {
      const pieces = parseInt(s.num_parts) || 0;
      const year = parseInt(s.year) || null;
      const theme = themeMap[s.theme_id] || null;
      const minifigs = parseInt(s.num_minifigs) || 0;
      const img = s.img_url && s.img_url !== 'None' ? s.img_url : null;
      let vals;
      try { vals = formulaValuation({ pieces, year, theme, retired: false }); }
      catch { skipped++; continue; }

      ph.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10},'formula_bulk','rebrickable',now())`);
      params.push(s.set_num, s.name, year, theme, pieces, minifigs, img,
        vals.retail_price, vals.current_value, vals.forecast_2y, vals.forecast_5y);
      p += 11;
      loaded++;
    }

    if (!ph.length) continue;
    await db.query(`
      INSERT INTO lego_sets
        (set_num,name,year,theme,pieces,minifigs,image_url,retail_price,current_value,forecast_2y,forecast_5y,valuation_method,source,cached_at)
      VALUES ${ph.join(',')}
      ON CONFLICT (set_num) DO UPDATE SET
        name=EXCLUDED.name, year=EXCLUDED.year, theme=EXCLUDED.theme,
        pieces=EXCLUDED.pieces, minifigs=EXCLUDED.minifigs,
        image_url=COALESCE(EXCLUDED.image_url, lego_sets.image_url),
        retail_price=CASE WHEN lego_sets.valuation_method='ai' THEN lego_sets.retail_price ELSE EXCLUDED.retail_price END,
        current_value=CASE WHEN lego_sets.valuation_method='ai' THEN lego_sets.current_value ELSE EXCLUDED.current_value END,
        forecast_2y=CASE WHEN lego_sets.valuation_method='ai' THEN lego_sets.forecast_2y ELSE EXCLUDED.forecast_2y END,
        forecast_5y=CASE WHEN lego_sets.valuation_method='ai' THEN lego_sets.forecast_5y ELSE EXCLUDED.forecast_5y END,
        valuation_method=CASE WHEN lego_sets.valuation_method='ai' THEN 'ai' ELSE 'formula_bulk' END,
        source='rebrickable', cached_at=now()
    `, params);
  }

  return { loaded, skipped, themes: themeRows.length };
}

async function importFigs() {
  const text = await fetchGzip(`${CDN}/minifigs.csv.gz`);
  const figs = parseCSV(text).filter(f => f.fig_num && f.name);
  let loaded = 0;

  for (let i = 0; i < figs.length; i += BATCH) {
    const batch = figs.slice(i, i + BATCH);
    const ph = [], params = [];
    let p = 1;
    for (const f of batch) {
      const img = f.img_url && f.img_url !== 'None' ? f.img_url : null;
      ph.push(`($${p},$${p+1},$${p+2})`);
      params.push(f.fig_num, f.name, img);
      p += 3;
      loaded++;
    }
    await db.query(`
      INSERT INTO minifigs (fig_num,name,image_url)
      VALUES ${ph.join(',')}
      ON CONFLICT (fig_num) DO UPDATE SET
        name=EXCLUDED.name,
        image_url=COALESCE(EXCLUDED.image_url, minifigs.image_url)
    `, params);
  }

  return { loaded };
}

export default async function(req, res) {
  const { dataset = 'sets' } = req.body || {};
  if (!['sets', 'figs', 'all'].includes(dataset)) {
    return res.status(400).json({ error: "dataset must be 'sets', 'figs', or 'all'" });
  }

  // Guard: don't let a second import overlap a running one. A run older than
  // 15 minutes is treated as stale (the isolate likely died) and superseded.
  const active = await db.query(
    `SELECT id, started_at FROM import_runs
     WHERE status='running' AND started_at > now() - interval '15 minutes'
     ORDER BY started_at DESC LIMIT 1`
  );
  if (active.rows.length) {
    return res.status(409).json({
      error: 'An import is already running. Please wait for it to finish.',
      run_id: active.rows[0].id,
      started_at: active.rows[0].started_at,
    });
  }
  // Mark any older stuck 'running' rows as errored so status stays truthful.
  await db.query(
    `UPDATE import_runs SET status='error', error='Superseded (stale run)', completed_at=now()
     WHERE status='running'`
  );

  const run = await db.query(
    'INSERT INTO import_runs (status) VALUES ($1) RETURNING id',
    ['running']
  );
  const runId = run.rows[0].id;

  try {
    const result = {};

    if (dataset === 'sets' || dataset === 'all') {
      const r = await importSets();
      result.sets_loaded = r.loaded;
      result.sets_skipped = r.skipped;
      result.themes_loaded = r.themes;
    }
    if (dataset === 'figs' || dataset === 'all') {
      const r = await importFigs();
      result.figs_loaded = r.loaded;
    }

    await db.query(
      'UPDATE import_runs SET status=$1,completed_at=now(),themes_loaded=$2,sets_loaded=$3,sets_skipped=$4,figs_loaded=$5 WHERE id=$6',
      ['completed', result.themes_loaded ?? null, result.sets_loaded ?? null,
       result.sets_skipped ?? null, result.figs_loaded ?? null, runId]
    );
    return res.json({ ok: true, ...result });
  } catch (e) {
    await db.query(
      'UPDATE import_runs SET status=$1,error=$2,completed_at=now() WHERE id=$3',
      ['error', e.message, runId]
    );
    return res.status(500).json({ error: e.message });
  }
}
