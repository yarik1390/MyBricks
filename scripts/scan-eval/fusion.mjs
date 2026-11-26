// Combined recognition test: does a second opinion from an open image model
// (SigLIP, run locally on the CI runner) improve Brickognize's first answer?
// For each real-world test photo: Brickognize top 5, SigLIP similarity of the
// photo to each candidate's catalog image, and SigLIP's own nearest sets in a
// catalog sample. Several ways of combining the two are scored. Read-only:
// talks only to Brickognize and the Rebrickable image CDN. Writes
// scan-eval-out/fusion.md and fusion-rows.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { AutoProcessor, SiglipVisionModel, RawImage } from '@huggingface/transformers';

const OUT = 'scan-eval-out';
const MODEL_ID = process.env.SIGLIP_MODEL || 'Xenova/siglip-base-patch16-224';
const LIMIT = Number(process.env.DISTRACTORS || 3000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withSuffix = (s) => (/-\d+$/.test(s) ? s : `${s}-1`);
const base = (s) => String(s).replace(/-\d+$/, '');
const img = (s) => `https://cdn.rebrickable.com/media/sets/${withSuffix(s)}.jpg`;
const UA = { 'User-Agent': 'BricksVault/1.0 (+https://bricksvault.app)' };

async function fetchBytes(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      if (r.status === 404) return null;
    } catch {}
    await sleep(1000 * (i + 1));
  }
  return null;
}

async function brickognize(bytes) {
  for (let i = 0; i < 4; i++) {
    const form = new FormData();
    form.append('query_image', new Blob([bytes], { type: 'image/jpeg' }), 'scan.jpg');
    const r = await fetch('https://api.brickognize.com/predict/sets/?top_k_items=5&min_similarity_items=0.1', { method: 'POST', body: form, headers: UA });
    if (r.status === 429) { await sleep(15000 * (i + 1)); continue; }
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const j = await r.json();
    return { items: (j.items || []).map((x) => ({ id: String(x.id), score: Number(x.score) })) };
  }
  return { error: '429' };
}

const processor = await AutoProcessor.from_pretrained(MODEL_ID);
const model = await SiglipVisionModel.from_pretrained(MODEL_ID, { dtype: 'fp32' });
async function embed(bytes) {
  try {
    const image = await RawImage.fromBlob(new Blob([bytes]));
    const out = await model(await processor(image));
    const t = out.pooler_output ?? out.image_embeds ?? out.last_hidden_state.mean(1);
    const v = Array.from(t.data);
    const n = Math.hypot(...v) || 1;
    return v.map((x) => x / n);
  } catch (e) { return null; }
}
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

async function embedSets(sets, cache) {
  const todo = sets.filter((s) => !cache.has(s));
  let done = 0;
  // Download with some parallelism, embed one at a time (CPU bound).
  for (let i = 0; i < todo.length; i += 16) {
    const chunk = todo.slice(i, i + 16);
    const bytes = await Promise.all(chunk.map((s) => fetchBytes(img(s))));
    for (let k = 0; k < chunk.length; k++) cache.set(chunk[k], bytes[k] ? await embed(bytes[k]) : null);
    done += chunk.length;
    if (done % 320 === 0 || done === todo.length) console.log(`  catalog ${done}/${todo.length}`);
  }
}

mkdirSync(OUT, { recursive: true });
const tests = JSON.parse(readFileSync('scripts/scan-eval/test-photos.json', 'utf8'));
const gallery = JSON.parse(readFileSync('scripts/scan-eval/gallery.json', 'utf8')).sets;
const testSets = new Set(tests.map((t) => t.set));
const sample = [...testSets, ...gallery.filter((s) => !testSets.has(s)).slice(0, LIMIT)];

// 1. Photos: Brickognize + SigLIP embedding.
const rows = [];
for (const t of tests) {
  const bytes = await fetchBytes(t.url);
  if (!bytes) { rows.push({ ...t, error: 'photo download failed' }); continue; }
  const bk = await brickognize(bytes);
  const v = await embed(bytes);
  rows.push({ ...t, bk: bk.items || [], bkError: bk.error, v });
  await sleep(1500);
}
console.log(`photos: ${rows.filter((r) => r.v).length}/${tests.length} embedded, ${rows.filter((r) => r.bk?.length).length} with Brickognize answers`);

// 2. Catalog: the sample plus every Brickognize candidate.
const cache = new Map();
const candidates = [...new Set(rows.flatMap((r) => (r.bk || []).map((b) => withSuffix(b.id))))];
await embedSets([...new Set([...sample, ...candidates])], cache);
const catalog = [...cache].filter(([, v]) => v);
console.log(`catalog embedded: ${catalog.length}/${cache.size}`);

// 3. Per-photo features.
const ok = rows.filter((r) => r.v && r.bk.length);
for (const r of ok) {
  r.sig = catalog.map(([s, v]) => ({ s, sim: dot(r.v, v) })).sort((a, b) => b.sim - a.sim).slice(0, 5);
  r.cands = r.bk.map((b, i) => {
    const v = cache.get(withSuffix(b.id));
    return { id: withSuffix(b.id), bk: b.score, bkRank: i + 1, sim: v ? dot(r.v, v) : null };
  });
  delete r.v;
}
const right = (r, id) => !!id && base(id) === base(r.set);

// 4. Strategies. Each returns { id, conf } for a photo.
const minSim = (r) => Math.min(...r.cands.map((c) => c.sim ?? 1), ...r.sig.map((x) => x.sim));
const strategies = {
  'Brickognize alone': (r) => ({ id: r.bk[0].id, conf: r.bk[0].score - (r.bk[1]?.score ?? 0) }),
  'SigLIP alone (catalog sample)': (r) => ({ id: r.sig[0].s, conf: r.sig[0].sim - r.sig[1].sim }),
  'Brickognize top 5 re-ranked by SigLIP': (r) => {
    const c = [...r.cands].sort((a, b) => (b.sim ?? -1) - (a.sim ?? -1));
    return { id: c[0].id, conf: (c[0].sim ?? 0) - (c[1]?.sim ?? 0) };
  },
  'Brickognize when sure (>=0.60, margin 0.10), else re-rank': (r) => {
    const top = r.bk[0];
    if (top.score >= 0.6 && top.score - (r.bk[1]?.score ?? 0) >= 0.1) return { id: top.id, conf: 1 };
    const c = [...r.cands].sort((a, b) => (b.sim ?? -1) - (a.sim ?? -1));
    return { id: c[0].id, conf: (c[0].sim ?? 0) - (c[1]?.sim ?? 0) };
  },
};
for (const w of [0.5, 1, 2, 4, 8]) {
  strategies[`Brickognize score + ${w} x SigLIP similarity (top 5)`] = (r) => {
    const lo = minSim(r);
    const c = r.cands.map((x) => ({ id: x.id, f: x.bk + w * ((x.sim ?? lo) - lo) })).sort((a, b) => b.f - a.f);
    return { id: c[0].id, conf: c[0].f - (c[1]?.f ?? 0) };
  };
  strategies[`Union of both top 5, score + ${w} x similarity`] = (r) => {
    const lo = minSim(r);
    const m = new Map();
    for (const x of r.cands) m.set(base(x.id), { id: x.id, bk: x.bk, sim: x.sim ?? lo });
    for (const x of r.sig) { const k = base(x.s); if (!m.has(k)) m.set(k, { id: x.s, bk: 0, sim: x.sim }); }
    const c = [...m.values()].map((x) => ({ id: x.id, f: x.bk + w * (x.sim - lo) })).sort((a, b) => b.f - a.f);
    return { id: c[0].id, conf: c[0].f - (c[1]?.f ?? 0) };
  };
}
strategies['Rank fusion (1/(10+rank)) of both top 5'] = (r) => {
  const m = new Map();
  r.bk.forEach((x, i) => { const k = base(x.id); m.set(k, { id: withSuffix(x.id), f: (m.get(k)?.f ?? 0) + 1 / (10 + i + 1) }); });
  r.sig.forEach((x, i) => { const k = base(x.s); m.set(k, { id: m.get(k)?.id ?? x.s, f: (m.get(k)?.f ?? 0) + 1 / (10 + i + 1) }); });
  const c = [...m.values()].sort((a, b) => b.f - a.f);
  return { id: c[0].id, conf: c[0].f - (c[1]?.f ?? 0) };
};

// 5. Report.
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '-');
const kinds = ['built', 'box', 'partial'];
const table = Object.entries(strategies).map(([name, fn]) => {
  const res = ok.map((r) => ({ r, ...fn(r) }));
  const hit = (rs) => rs.filter((x) => right(x.r, x.id)).length;
  // Most answers given with zero wrong, accepting only above a confidence cut.
  const sorted = [...res].sort((a, b) => b.conf - a.conf);
  let safe = 0;
  for (const x of sorted) { if (!right(x.r, x.id)) break; safe++; }
  return { name, all: hit(res), by: kinds.map((k) => { const rs = res.filter((x) => x.r.kind === k); return `${hit(rs)}/${rs.length}`; }), safe };
});
const bkTop5 = ok.filter((r) => r.bk.some((b) => right(r, b.id))).length;
const sigTop5 = ok.filter((r) => r.sig.some((x) => right(r, x.s))).length;
const md = [
  '# Combined recognition test (Brickognize + SigLIP)',
  '',
  `SigLIP model: ${MODEL_ID}. Photos with both answers: ${ok.length}/${tests.length}. Catalog images embedded: ${catalog.length} (${sample.length} sample sets + Brickognize candidates).`,
  `Right set anywhere in Brickognize top 5: ${bkTop5}/${ok.length} (${pct(bkTop5, ok.length)}). In SigLIP top 5: ${sigTop5}/${ok.length} (${pct(sigTop5, ok.length)}).`,
  '',
  '| Strategy | Right first | Built | Box | Partial | Answered with 0 wrong |',
  '|---|---|---|---|---|---|',
  ...table.map((t) => `| ${t.name} | ${t.all}/${ok.length} (${pct(t.all, ok.length)}) | ${t.by.join(' | ')} | ${t.safe} |`),
  '',
  '"Answered with 0 wrong": photos answered before the first wrong one, taking the most confident answers first.',
  '',
  '## Per photo',
  '| set | kind | Brickognize top 5 (score / SigLIP sim) | SigLIP top 3 |',
  '|---|---|---|---|',
  ...ok.map((r) => `| ${r.set} | ${r.kind} | ${r.cands.map((c) => `${right(r, c.id) ? '**' : ''}${c.id} ${c.bk.toFixed(2)}/${c.sim?.toFixed(3) ?? '-'}${right(r, c.id) ? '**' : ''}`).join(', ')} | ${r.sig.slice(0, 3).map((x) => `${x.s} ${x.sim.toFixed(3)}`).join(', ')} |`),
  ...rows.filter((r) => !ok.includes(r)).map((r) => `| ${r.set} | ${r.kind} | skipped: ${r.error || r.bkError || 'no Brickognize answer / no embedding'} | |`),
].join('\n');
writeFileSync(`${OUT}/fusion.md`, md);
writeFileSync(`${OUT}/fusion-rows.json`, JSON.stringify(rows, null, 1));
console.log(md.split('## Per photo')[0]);
