// Offline accuracy eval for the scan image index. Embeds catalog images and
// real-world test photos through the deployed Worker's admin-only
// /api/scan-vectors/embed (Workers AI), then ranks every photo against the
// catalog by cosine similarity. Also runs Brickognize (today's first photo
// step) on the same photos for a baseline. Writes scan-eval-out/report.md.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const WORKER = process.env.WORKER_URL || 'https://brickvault-api.zhydenko.workers.dev';
const JWT = process.env.ADMIN_JWT;
const LIMIT = Number(process.env.DISTRACTORS || 3000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const img = (s) => `https://cdn.rebrickable.com/media/sets/${s}.jpg`;
const base = (s) => String(s).replace(/-\d+$/, '');

async function embed(urls, shape, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${WORKER}/api/scan-vectors/embed`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${JWT}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls, shape }),
      });
      if (r.ok) return (await r.json()).results;
      console.log(`embed HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    } catch (e) { console.log('embed error', e.message); }
    await sleep(1500 * (i + 1));
  }
  return urls.map((url) => ({ url, vector: null, error: 'request failed' }));
}

async function pool(items, size, conc, fn) {
  const batches = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  const out = new Array(batches.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: conc }, async () => {
    while (next < batches.length) {
      const k = next++;
      out[k] = await fn(batches[k]);
      if (++done % 25 === 0) console.log(`  ${done}/${batches.length} batches`);
    }
  }));
  return out.flat();
}

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

async function brickognize(url) {
  try {
    const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
    const form = new FormData();
    form.append('query_image', new Blob([bytes], { type: 'image/jpeg' }), 'scan.jpg');
    const t0 = Date.now();
    const r = await fetch('https://api.brickognize.com/predict/sets/?top_k_items=3&min_similarity_items=0.3', {
      method: 'POST', body: form, headers: { 'User-Agent': 'BricksVault/1.0 (+https://bricksvault.app)' },
    });
    const ms = Date.now() - t0;
    if (!r.ok) return { error: `HTTP ${r.status}`, ms };
    const j = await r.json();
    const items = (j.items || []).map((x) => ({ id: String(x.id), score: Number(x.score) }));
    return { items, ms };
  } catch (e) { return { error: e.message }; }
}

export async function runEval({ OUT }) {
  if (!JWT) throw new Error('ADMIN_JWT missing');
  const tests = JSON.parse(readFileSync('scripts/scan-eval/test-photos.json', 'utf8'));
  const gallery = JSON.parse(readFileSync('scripts/scan-eval/gallery.json', 'utf8')).sets;
  const testSets = new Set(tests.map((t) => t.set));
  const sets = [...testSets, ...gallery.filter((s) => !testSets.has(s)).slice(0, LIMIT)];

  // 1. Which input shape does the model take?
  let shape = process.env.SHAPE || '';
  const probeLog = [];
  for (const s of shape ? [shape] : ['image_dataurl', 'image_b64', 'image_bytes', 'messages', 'input_image']) {
    const [r] = await embed([img('75192-1')], s, 1);
    probeLog.push(`${s}: ${r.vector ? `ok dims=${r.vector.length} ${r.ms}ms` : `fail ${r.error}`}`);
    console.log(probeLog.at(-1));
    if (r.vector) { shape = s; break; }
  }
  if (!probeLog.some((l) => l.includes(' ok '))) {
    writeFileSync(`${OUT}/report.md`, `# Probe failed\n\n${probeLog.join('\n')}\n`);
    console.log('No input shape worked; stopping.');
    return;
  }

  // 2. Catalog side.
  console.log(`Embedding ${sets.length} catalog images (shape ${shape})`);
  const t0 = Date.now();
  const gal = await pool(sets.map(img), 8, 4, (b) => embed(b, shape));
  const galOk = gal.map((r, i) => ({ set: sets[i], v: r.vector, ms: r.ms })).filter((g) => g.v);
  const galMs = galOk.map((g) => g.ms).sort((a, b) => a - b);
  console.log(`catalog: ${galOk.length}/${sets.length} ok in ${Math.round((Date.now() - t0) / 1000)}s`);
  const missingTests = [...testSets].filter((s) => !galOk.some((g) => g.set === s));

  // 3. Query side + ranking.
  const q = await pool(tests.map((t) => t.url), 4, 3, (b) => embed(b, shape));
  const rows = [];
  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    const v = q[i]?.vector;
    if (!v) { rows.push({ ...t, error: q[i]?.error || 'no vector' }); continue; }
    const ranked = galOk.map((g) => ({ set: g.set, s: dot(v, g.v) })).sort((a, b) => b.s - a.s);
    const rank = ranked.findIndex((r) => r.set === t.set) + 1;
    rows.push({ ...t, rank, top1: ranked[0].set, s1: ranked[0].s, s2: ranked[1].s, ms: q[i].ms, top5: ranked.slice(0, 5).map((r) => `${r.set} ${r.s.toFixed(3)}`) });
  }

  // 4. Brickognize baseline on the same photos.
  for (const r of rows) {
    const b = await brickognize(r.url);
    r.bk = b;
    const top = b.items?.[0];
    r.bkTop1 = top ? base(top.id) === base(r.set) : false;
    r.bkAccepted = !!top && top.score >= 0.75 && (!b.items[1] || top.score - b.items[1].score >= 0.10);
    await sleep(300);
  }

  // 5. Report.
  const ok = rows.filter((r) => r.rank);
  const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '-');
  const by = (k) => ok.filter((r) => r.kind === k);
  const line = (label, rs) => `| ${label} | ${rs.length} | ${pct(rs.filter((r) => r.rank === 1).length, rs.length)} | ${pct(rs.filter((r) => r.rank && r.rank <= 5).length, rs.length)} | ${pct(rs.filter((r) => r.bkTop1).length, rs.length)} | ${pct(rs.filter((r) => r.bkTop1 && r.bkAccepted).length, rs.length)} |`;
  const thresholds = [];
  for (const smin of [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8]) for (const mmin of [0, 0.02, 0.04, 0.06, 0.08]) {
    const acc = ok.filter((r) => r.s1 >= smin && r.s1 - r.s2 >= mmin);
    const right = acc.filter((r) => r.top1 === r.set).length;
    thresholds.push({ smin, mmin, answered: acc.length, right, wrong: acc.length - right });
  }
  const best = thresholds.filter((t) => t.wrong === 0).sort((a, b) => b.right - a.right)[0];
  const qms = ok.map((r) => r.ms).sort((a, b) => a - b);
  const bkms = rows.map((r) => r.bk?.ms).filter(Boolean).sort((a, b) => a - b);
  const md = [
    `# Scan image-index eval`,
    ``,
    `Model shape: ${shape}. Catalog images embedded: ${galOk.length}/${sets.length}. Test photos: ${rows.length} (${ok.length} embedded).`,
    missingTests.length ? `Test sets missing from the catalog side: ${missingTests.join(', ')}` : '',
    `Embedding latency per photo (Worker side): median ${qms[qms.length >> 1]} ms, p90 ${qms[Math.floor(qms.length * 0.9)]} ms. Brickognize median ${bkms[bkms.length >> 1]} ms.`,
    `Catalog embed: median ${galMs[galMs.length >> 1]} ms per image.`,
    ``,
    `| Photos | n | Index top-1 | Index top-5 | Brickognize top-1 | Brickognize accepted+right |`,
    `|---|---|---|---|---|---|`,
    line('All', ok), line('Built', by('built')), line('Box', by('box')), line('Partial', by('partial')),
    ``,
    `## Accept thresholds (answer only when score >= s and margin >= m)`,
    `| s | m | answered | right | wrong |`, `|---|---|---|---|---|`,
    ...thresholds.filter((t) => t.answered).map((t) => `| ${t.smin} | ${t.mmin} | ${t.answered} | ${t.right} | ${t.wrong} |`),
    best ? `\nBest zero-wrong threshold: s>=${best.smin}, m>=${best.mmin}: ${best.right}/${ok.length} answered correctly.` : '\nNo threshold answered with zero wrong.',
    ``,
    `## Per photo`,
    `| set | kind | rank | top1 | s1 | margin | Brickognize top | photo |`, `|---|---|---|---|---|---|---|---|`,
    ...rows.map((r) => `| ${r.set} | ${r.kind} | ${r.rank ?? r.error} | ${r.top1 ?? ''} | ${r.s1?.toFixed(3) ?? ''} | ${r.s1 ? (r.s1 - r.s2).toFixed(3) : ''} | ${r.bk?.items?.[0] ? `${r.bk.items[0].id} ${r.bk.items[0].score.toFixed(2)}` : r.bk?.error || '-'} | ${r.source} |`),
    ``,
    `Probe: ${probeLog.join('; ')}`,
  ].join('\n');
  writeFileSync(`${OUT}/report.md`, md);
  writeFileSync(`${OUT}/rows.json`, JSON.stringify(rows, null, 1));
  console.log(md.split('## Per photo')[0]);
}
