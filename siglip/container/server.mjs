// SigLIP image embedding server (runs inside the bricksvault-siglip Container).
// POST /embed {images?: dataURL[], urls?: string[]} -> {vectors: (number[768]|null)[]}
// Vectors are L2-normalised pooler outputs of Xenova/siglip-base-patch16-224
// (fp32), the same model and settings as scripts/scan-eval/fusion.mjs.
import http from 'node:http';
import { AutoProcessor, SiglipVisionModel, RawImage, env } from '@huggingface/transformers';

const MODEL_ID = 'Xenova/siglip-base-patch16-224';
env.cacheDir = '/app/models';
env.allowRemoteModels = process.env.ALLOW_REMOTE_MODELS === '1';

const MAX_ITEMS = 32;
const MAX_IMAGE_BYTES = 4_000_000;
let processor;
let model;
const ready = (async () => {
  processor = await AutoProcessor.from_pretrained(MODEL_ID);
  model = await SiglipVisionModel.from_pretrained(MODEL_ID, { dtype: 'fp32' });
  console.log('siglip ready');
})();

async function embed(bytes) {
  try {
    const image = await RawImage.fromBlob(new Blob([bytes]));
    const out = await model(await processor(image));
    const t = out.pooler_output ?? out.image_embeds;
    const v = Array.from(t.data);
    let n = 0;
    for (const x of v) n += x * x;
    n = Math.sqrt(n) || 1;
    return v.map((x) => x / n);
  } catch {
    return null;
  }
}

function fromDataUrl(s) {
  const m = /^data:image\/[a-z]+;base64,(.+)$/i.exec(String(s));
  if (!m) return null;
  const buf = Buffer.from(m[1], 'base64');
  return buf.length && buf.length <= MAX_IMAGE_BYTES ? buf : null;
}

async function fetchImage(url) {
  if (!/^https:\/\//.test(String(url))) return null;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'BricksVault/1.0 (+https://bricksvault.app)' }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length && buf.length <= MAX_IMAGE_BYTES ? buf : null;
  } catch {
    return null;
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 40_000_000) { reject(new Error('too large')); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      const ok = await Promise.race([ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 10))]);
      return send(res, ok ? 200 : 503, { ok });
    }
    if (req.method === 'POST' && req.url === '/embed') {
      const body = await readJson(req);
      const images = Array.isArray(body.images) ? body.images.slice(0, MAX_ITEMS) : [];
      const urls = Array.isArray(body.urls) ? body.urls.slice(0, MAX_ITEMS) : [];
      const t0 = Date.now();
      const [fromImages, fromUrls] = await Promise.all([
        Promise.resolve(images.map(fromDataUrl)),
        Promise.all(urls.map(fetchImage)),
      ]);
      await ready;
      const vectors = [];
      for (const bytes of [...fromImages, ...fromUrls]) vectors.push(bytes ? await embed(bytes) : null);
      return send(res, 200, { vectors, ms: Date.now() - t0 });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 400, { error: String(e?.message || e) });
  }
}).listen(8080, () => console.log('listening on 8080'));
