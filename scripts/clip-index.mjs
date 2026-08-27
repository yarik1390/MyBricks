#!/usr/bin/env node
/**
 * One-off / incremental CLIP indexer for official catalog images.
 *
 * Does NOT download 27k images in CI. Operators run this locally against D1
 * dumps and either a live CLIP_EMBED_URL (Container) or a precomputed JSONL
 * of 512-d vectors from local ONNX.
 *
 *   node scripts/clip-index.mjs dump-urls --from catalog-urls.json
 *   node scripts/clip-index.mjs embed --embed-url http://127.0.0.1:8080 --in urls.jsonl --out vectors.ndjson --limit 50
 *   npx wrangler vectorize insert brickvault-set-clip --file vectors.ndjson
 *
 * URL allowlist: cdn.rebrickable.com set shots + images.brickset.com already
 * stored in D1. BrickLink and MOCs are rejected.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import readline from 'node:readline';

const DIM = 512;
const MODEL = 'mobileclip-s2';

function isOfficial(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    if (/\/media\/mocs\//i.test(u.pathname)) return false;
    if (u.hostname === 'cdn.rebrickable.com') {
      return !/\/media\/(minifigs|parts|mocs)\//i.test(u.pathname);
    }
    return u.hostname === 'images.brickset.com';
  } catch {
    return false;
  }
}

function vectorId(setNum, view) {
  return `clip:v1:${setNum}:${view}`;
}

function help() {
  console.log(`CLIP catalog indexer (official images only, 512-d MobileCLIP-S2)

Commands:
  dump-urls   Read a JSON array of {set_num,image_url,brickset_image_urls?} and
              write JSONL of allowed views (no image download).
  embed       Fetch each URL, POST to CLIP_EMBED_URL/embed, write Vectorize JSONL.
  check       Validate a vectors.ndjson file (dim=512, official ids).

This script never runs in CI and will not fetch the catalog unless you pass
--limit / --in yourself. Weights stay in the Container (or local ONNX).
`);
}

async function dumpUrls(inputPath, outputPath) {
  const raw = JSON.parse(await readFile(inputPath, 'utf8'));
  const rows = Array.isArray(raw) ? raw : raw.sets || raw.results || [];
  const out = [];
  for (const row of rows) {
    const setNum = String(row.set_num || '').trim();
    if (!setNum) continue;
    const urls = [];
    if (row.image_url) urls.push({ url: row.image_url, view: 'official', source: 'rebrickable' });
    let extra = row.brickset_image_urls;
    if (typeof extra === 'string') {
      try { extra = JSON.parse(extra); } catch { extra = []; }
    }
    if (Array.isArray(extra)) {
      extra.filter((u) => typeof u === 'string').slice(0, 2).forEach((url, i) => {
        urls.push({ url, view: `brickset-${i}`, source: 'brickset' });
      });
    }
    const seen = new Set();
    for (const item of urls) {
      if (!isOfficial(item.url)) continue;
      const key = item.url.split('?')[0];
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ set_num: setNum, view: item.view, source: item.source, image_url: item.url, vector_id: vectorId(setNum, item.view) });
    }
  }
  await writeFile(outputPath, out.map((row) => JSON.stringify(row)).join('\n') + (out.length ? '\n' : ''));
  console.log(`wrote ${out.length} official views to ${outputPath}`);
}

async function embedUrls({ embedUrl, inputPath, outputPath, limit, progressPath }) {
  const base = embedUrl.replace(/\/+$/, '');
  const done = new Set();
  if (progressPath) {
    try {
      const prev = await readFile(progressPath, 'utf8');
      for (const line of prev.split('\n')) {
        if (line.trim()) done.add(JSON.parse(line).vector_id);
      }
    } catch { /* first run */ }
  }
  const rl = readline.createInterface({ input: createReadStream(inputPath) });
  const out = createWriteStream(outputPath, { flags: 'a' });
  let n = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (done.has(row.vector_id)) continue;
    if (!isOfficial(row.image_url)) continue;
    const img = await fetch(row.image_url, { headers: { Accept: 'image/*' } });
    if (!img.ok) {
      console.warn(`skip ${row.vector_id}: HTTP ${img.status}`);
      continue;
    }
    const bytes = Buffer.from(await img.arrayBuffer());
    const mime = (img.headers.get('content-type') || 'image/jpeg').split(';')[0];
    const embedded = await fetch(`${base}/embed`, {
      method: 'POST',
      headers: { 'content-type': mime, accept: 'application/json' },
      body: bytes,
    });
    if (!embedded.ok) {
      console.warn(`embed fail ${row.vector_id}: HTTP ${embedded.status}`);
      continue;
    }
    const payload = await embedded.json();
    const vector = payload.vector || payload.embedding;
    if (!Array.isArray(vector) || vector.length !== DIM) {
      console.warn(`embed fail ${row.vector_id}: bad dim`);
      continue;
    }
    const record = {
      id: row.vector_id,
      values: vector,
      metadata: { set_num: row.set_num, view: row.view, source: row.source, model: MODEL },
    };
    out.write(`${JSON.stringify(record)}\n`);
    if (progressPath) await appendFile(progressPath, `${JSON.stringify({ vector_id: row.vector_id })}\n`);
    n += 1;
    if (limit && n >= limit) break;
  }
  out.end();
  console.log(`embedded ${n} images → ${outputPath}`);
}

async function checkFile(inputPath) {
  const rl = readline.createInterface({ input: createReadStream(inputPath) });
  let n = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (!row.id || !Array.isArray(row.values) || row.values.length !== DIM) {
      throw new Error(`invalid row ${n}: id/dim`);
    }
    n += 1;
  }
  console.log(`ok: ${n} vectors, dim=${DIM}`);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: 'boolean', short: 'h' },
    from: { type: 'string' },
    in: { type: 'string' },
    out: { type: 'string' },
    'embed-url': { type: 'string' },
    limit: { type: 'string' },
    progress: { type: 'string' },
  },
});

const cmd = positionals[0];
if (values.help || !cmd) {
  help();
  process.exit(cmd ? 0 : 1);
}

if (cmd === 'dump-urls') {
  await dumpUrls(values.from, values.out || 'clip-urls.jsonl');
} else if (cmd === 'embed') {
  if (!values['embed-url'] || !values.in) {
    console.error('embed requires --embed-url and --in');
    process.exit(1);
  }
  await embedUrls({
    embedUrl: values['embed-url'],
    inputPath: values.in,
    outputPath: values.out || 'clip-vectors.ndjson',
    limit: values.limit ? Number(values.limit) : 0,
    progressPath: values.progress,
  });
} else if (cmd === 'check') {
  await checkFile(values.in || values.from);
} else {
  help();
  process.exit(1);
}
