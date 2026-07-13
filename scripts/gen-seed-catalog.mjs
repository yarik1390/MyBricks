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
const LIMIT = Number(process.env.SEED_LIMIT) || 2000;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'seed-catalog.json');

async function main() {
  const url = `${API_BASE}/api/catalog/seed?limit=${LIMIT}`;
  console.log(`[seed] fetching ${url}`);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`seed endpoint ${res.status}`);
  const json = await res.json();
  const sets = Array.isArray(json?.sets) ? json.sets : [];
  if (sets.length < 50) throw new Error(`seed suspiciously small (${sets.length} sets) — keeping existing snapshot`);
  await mkdir(dirname(OUT), { recursive: true });
  const body = JSON.stringify({ generated_at: json.generated_at || new Date().toISOString(), count: sets.length, sets });
  await writeFile(OUT, body);
  console.log(`[seed] wrote ${sets.length} sets (${(body.length / 1024).toFixed(0)} KB) → public/data/seed-catalog.json`);
}

main().catch((e) => {
  // Non-fatal: keep the committed snapshot so the build still ships offline data.
  console.warn(`[seed] generation failed, keeping existing snapshot: ${e.message}`);
  process.exit(0);
});
