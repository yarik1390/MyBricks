#!/usr/bin/env node
// Generate the bundled OFFLINE seed catalog: fetches the top sets from the live
// /api/catalog/seed endpoint and writes public/data/seed-catalog.json, which
// Capacitor bundles into the app so a fresh install with no network can browse
// and search the top sets. Run in CI before `cap sync` (Android) and before the
// Pages deploy; non-fatal — on any failure the previously committed snapshot is
// kept so a build never breaks over this.
//
//   API_BASE=https://brickvault-api.zhydenko.workers.dev SEED_LIMIT=2000 \
//     node scripts/gen-seed-catalog.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const API_BASE = process.env.API_BASE || 'https://brickvault-api.zhydenko.workers.dev';
// SEED_LIMIT caps the total sets bundled (default: the full catalog). The
// endpoint serves at most PAGE per request, so we page through with offset.
const TOTAL = Number(process.env.SEED_LIMIT) || 100000;
const PAGE = 5000;
const REQUIRED_MODEL_VERSION = 'v4';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'seed-catalog.json');

async function main() {
  const all = [];
  let valuationGeneration = null;
  for (let offset = 0; offset < TOTAL; offset += PAGE) {
    const limit = Math.min(PAGE, TOTAL - offset);
    const url = `${API_BASE}/api/catalog/seed?limit=${limit}&offset=${offset}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`seed endpoint ${res.status} at offset ${offset}`);
    const json = await res.json();
    if (json?.model_version !== REQUIRED_MODEL_VERSION) {
      throw new Error(`seed model ${json?.model_version || 'missing'}; expected ${REQUIRED_MODEL_VERSION}`);
    }
    if (!json?.valuation_generation) throw new Error('seed valuation generation missing');
    if (valuationGeneration && valuationGeneration !== json.valuation_generation) {
      throw new Error(`seed generation changed while paging (${valuationGeneration} -> ${json.valuation_generation})`);
    }
    valuationGeneration = json.valuation_generation;
    const sets = Array.isArray(json?.sets) ? json.sets : [];
    all.push(...sets);
    console.log(`[seed] +${sets.length} (offset ${offset}, total ${all.length})`);
    if (sets.length < limit) break; // last page reached
  }
  if (all.length < 50) throw new Error(`seed suspiciously small (${all.length} sets) — keeping existing snapshot`);
  await mkdir(dirname(OUT), { recursive: true });
  const body = JSON.stringify({ model_version: REQUIRED_MODEL_VERSION, valuation_generation: valuationGeneration, generated_at: new Date().toISOString(), count: all.length, sets: all });
  await writeFile(OUT, body);
  console.log(`[seed] wrote ${all.length} sets (${(body.length / 1024 / 1024).toFixed(1)} MB) → public/data/seed-catalog.json`);
}

main().catch((e) => {
  // Non-fatal: keep the committed snapshot so the build still ships offline data.
  console.warn(`[seed] generation failed, keeping existing snapshot: ${e.message}`);
  process.exit(0);
});
