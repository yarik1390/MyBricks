import { db } from 'hatchable';
import { formulaValuation } from 'lib/valuation.js';

export const access = 'admin';
export const methods = ['POST'];

async function fetchGzip(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  const buf = await resp.arrayBuffer();
  // Decompress using DecompressionStream (available in modern runtimes)
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

function parseCSV(text) {
  const lines = text.split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  return lines.slice(1).filter(Boolean).map(line => {
    const vals = [];
    let cur = '';
    let inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    vals.push(cur.trim());
    const obj = {};
    headers.forEach((h, i) => obj[h] = vals[i] || null);
    return obj;
  });
}

export default async function (req, res) {
  const run = await db.query(
    'INSERT INTO import_runs (status) VALUES ($1) RETURNING id',
    ['running']
  );
  const runId = run.rows[0].id;

  try {
    // Import themes
    const themesCSV = await fetchGzip('https://cdn.rebrickable.com/media/downloads/themes.csv.gz');
    const themes = parseCSV(themesCSV);
    let themesLoaded = 0;
    for (const t of themes) {
      if (!t.id || !t.name) continue;
      await db.query(
        'INSERT INTO lego_themes (id,name,parent_id) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET name=$2,parent_id=$3',
        [parseInt(t.id), t.name, t.parent_id ? parseInt(t.parent_id) : null]
      );
      themesLoaded++;
    }

    // Build theme ID->name map
    const themeMap = {};
    for (const t of themes) { if (t.id) themeMap[t.id] = t.name; }

    // Import sets
    const setsCSV = await fetchGzip('https://cdn.rebrickable.com/media/downloads/sets.csv.gz');
    const sets = parseCSV(setsCSV);
    let setsLoaded = 0, setsSkipped = 0;

    for (const s of sets) {
      if (!s.set_num || !s.name) { setsSkipped++; continue; }
      try {
        const pieces = parseInt(s.num_parts) || 0;
        const year = parseInt(s.year) || null;
        const theme = themeMap[s.theme_id] || null;
        const vals = formulaValuation({ pieces, year, theme, retired: false });
        await db.query(`
          INSERT INTO lego_sets (set_num, name, year, theme, pieces, image_url, retail_price, current_value, forecast_2y, forecast_5y, valuation_method, source)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'formula_bulk','rebrickable')
          ON CONFLICT (set_num) DO UPDATE SET
            name=EXCLUDED.name, year=EXCLUDED.year, theme=EXCLUDED.theme,
            pieces=EXCLUDED.pieces, image_url=EXCLUDED.image_url,
            valuation_method=CASE WHEN lego_sets.valuation_method='ai' THEN 'ai' ELSE 'formula_bulk' END
        `, [s.set_num, s.name, year, theme, pieces, s.img_url || null,
            vals.retail_price, vals.current_value, vals.forecast_2y, vals.forecast_5y]);
        setsLoaded++;
      } catch (_) { setsSkipped++; }
    }

    await db.query(
      'UPDATE import_runs SET status=$1,completed_at=now(),themes_loaded=$2,sets_loaded=$3,sets_skipped=$4 WHERE id=$5',
      ['completed', themesLoaded, setsLoaded, setsSkipped, runId]
    );
    return res.json({ ok: true, themes_loaded: themesLoaded, sets_loaded: setsLoaded, sets_skipped: setsSkipped });
  } catch (e) {
    await db.query('UPDATE import_runs SET status=$1,error=$2,completed_at=now() WHERE id=$3', ['error', e.message, runId]);
    return res.status(500).json({ error: e.message });
  }
}