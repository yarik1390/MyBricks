// Scan image-index eval (see .github/workflows/scan-vector-eval.yml).
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';

const ACC = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const MODE = process.env.MODE || 'probe';
const MODEL = process.env.MODEL || '@cf/qwen/qwen3-vl-embedding-2b';
const OUT = 'scan-eval-out';
mkdirSync(OUT, { recursive: true });
const api = (path) => `https://api.cloudflare.com/client/v4/accounts/${ACC}${path}`;
const auth = { Authorization: `Bearer ${TOKEN}` };
const short = (s, n = 900) => String(s).slice(0, n);

async function probe() {
  for (const p of [`/ai/models/schema?model=${encodeURIComponent(MODEL)}`, `/ai/models/search?search=embedding`]) {
    const r = await fetch(api(p), { headers: auth });
    const t = await r.text();
    console.log(`GET ${p} -> ${r.status}\n${short(t, p.includes('schema') ? 6000 : 3000)}\n`);
  }
  const img = Buffer.from(await (await fetch('https://cdn.rebrickable.com/media/sets/75192-1.jpg')).arrayBuffer());
  const b64 = img.toString('base64');
  const dataUrl = `data:image/jpeg;base64,${b64}`;
  const shapes = {
    image_bytes: { image: [...img.subarray(0, 200000)] },
    image_b64: { image: b64 },
    input_text: { text: ['lego millennium falcon'] },
    messages: { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: dataUrl } }] }] },
    input_array: { input: [{ image: dataUrl }] },
    contents: { contents: [{ image: dataUrl }] },
  };
  for (const [name, body] of Object.entries(shapes)) {
    const t0 = Date.now();
    const r = await fetch(api(`/ai/run/${MODEL}`), { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const t = await r.text();
    let dims = '';
    try { const j = JSON.parse(t); const d = j.result?.data?.[0] ?? j.result?.embeddings?.[0] ?? j.result?.embedding; if (Array.isArray(d)) dims = ` dims=${d.length}`; } catch {}
    console.log(`POST ${name} -> ${r.status} ${Date.now() - t0}ms${dims}\n${short(t, 600)}\n`);
  }
}

if (MODE === 'probe') await probe();
else {
  const { runEval } = await import('./run-eval.mjs');
  await runEval({ api, auth, MODEL, OUT });
}
