#!/usr/bin/env node
// Collects Creative Commons photos of LEGO sets from Openverse into D1
// (training_images) for the scan model's real-photo training set.
//
// Runs on a GitHub runner (workflow "Openverse photos"), not in the Worker:
// Openverse throttles requests from shared Cloudflare Workers IPs, both the
// token endpoint and searches, even with a valid token (2026-11-28).
//
// One search per set, "lego <number>", commercial-use licences only, kept when
// the title or tags carry the set number. Licence, creator and source page are
// stored for attribution. Writes go through the Cloudflare D1 REST API.
//
// Env: OPENVERSE_CLIENT_ID, OPENVERSE_CLIENT_SECRET, CLOUDFLARE_API_TOKEN,
//      CLOUDFLARE_ACCOUNT_ID; optional LIMIT (sets per run, default 150).

const OPENVERSE = 'https://api.openverse.org/v1';
const UA = 'BricksVault/1.0 (+https://bricksvault.app)';

export const bareSetNum = (s) => s.replace(/-\d+$/, '');

/** Keep a result only when its title or tags name the set number as a whole token. */
export function openverseMatches(setNum, img) {
  const num = bareSetNum(setNum);
  if (!/^\d{3,}$/.test(num) || !img?.url || !/^https:\/\//.test(img.url)) return false;
  const re = new RegExp(`(^|[^0-9])${num}([^0-9]|$)`);
  return re.test(img.title ?? '') || (img.tags ?? []).some((t) => re.test(t?.name ?? ''));
}

/** training_images rows for the kept results of one set. */
export function imageRows(setNum, items) {
  return items.filter((i) => openverseMatches(setNum, i)).map((i) => [
    setNum, i.url, `openverse:${i.source ?? 'unknown'}`,
    [i.license, i.license_version].filter(Boolean).join(' ') || null,
    i.creator ?? null, i.foreign_landing_url ?? null,
  ]);
}

async function main() {
  const env = process.env;
  for (const k of ['OPENVERSE_CLIENT_ID', 'OPENVERSE_CLIENT_SECRET', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
    if (!env[k]) { console.log(`::notice::${k} not set; nothing to do`); return; }
  }
  const limit = Math.max(1, Math.min(Number(env.LIMIT) || 150, 500));
  const cf = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}`;
  const cfHeaders = { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' };

  const dbList = await (await fetch(`${cf}/d1/database?name=brickvault`, { headers: cfHeaders })).json();
  const dbId = dbList?.result?.[0]?.uuid;
  if (!dbId) throw new Error('D1 database brickvault not found');
  const sql = async (query, params = []) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${cf}/d1/database/${dbId}/query`, { method: 'POST', headers: cfHeaders, body: JSON.stringify({ sql: query, params }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.success) return body.result?.[0]?.results ?? [];
      const msg = JSON.stringify(body.errors ?? body).slice(0, 300);
      // D1 sometimes answers "overloaded"; retry a few times like the deploy does.
      if (attempt < 4 && /overloaded|7429|timeout/i.test(msg)) { await sleep(2000 * (attempt + 1)); continue; }
      throw new Error(`D1 HTTP ${res.status}: ${msg}`);
    }
  };

  const tokRes = await fetch(`${OPENVERSE}/auth_tokens/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.OPENVERSE_CLIENT_ID, client_secret: env.OPENVERSE_CLIENT_SECRET }),
  });
  if (!tokRes.ok) {
    console.log(`::warning::Openverse token HTTP ${tokRes.status}: ${(await tokRes.text()).slice(0, 200)}`);
    return;
  }
  const token = (await tokRes.json()).access_token;
  if (!token) throw new Error('Openverse token reply had no access_token');
  console.log(`::add-mask::${token}`);

  // Owned/wishlisted sets first, then recent sets with 50+ pieces (rarely photographed otherwise).
  const sets = await sql(
    `SELECT s.set_num FROM lego_sets s
      LEFT JOIN training_photo_queries q ON q.set_num = s.set_num AND q.source = 'openverse'
      WHERE q.set_num IS NULL AND s.name IS NOT NULL AND COALESCE(s.pieces, 0) >= 50
      ORDER BY EXISTS (SELECT 1 FROM user_collection uc WHERE uc.set_num = s.set_num AND uc.deleted_at IS NULL) DESC,
               EXISTS (SELECT 1 FROM user_wishlist uw WHERE uw.set_num = s.set_num) DESC,
               s.year DESC
      LIMIT ?`, [limit]);

  let queried = 0; let photos = 0; let errors = 0;
  for (const { set_num } of sets) {
    const q = new URLSearchParams({ q: `lego ${bareSetNum(set_num)}`, license_type: 'commercial', page_size: '50' });
    const res = await fetch(`${OPENVERSE}/images/?${q}`, { headers: { 'User-Agent': UA, Authorization: `Bearer ${token}` } });
    if (res.status === 429) { console.log(`::warning::Openverse search throttled: ${(await res.text()).slice(0, 200)}`); break; }
    if (!res.ok) { errors++; console.log(`search ${set_num}: HTTP ${res.status}`); continue; }
    const items = (await res.json()).results ?? [];
    queried++;
    const rows = imageRows(set_num, items);
    for (let j = 0; j < rows.length; j += 14) { // 6 params per row, D1 max 100
      const chunk = rows.slice(j, j + 14);
      await sql(`INSERT OR IGNORE INTO training_images (set_num, url, source, license, creator, landing_url)
        VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}`, chunk.flat());
    }
    photos += rows.length;
    await sql(`INSERT OR REPLACE INTO training_photo_queries (set_num, source, hits, queried_at)
      VALUES (?, 'openverse', ?, datetime('now'))`, [set_num, rows.length]);
    await sleep(1000); // stay well under Openverse's per-minute limit
  }
  const total = await sql("SELECT COUNT(*) AS n FROM training_images WHERE source LIKE 'openverse%'");
  console.log(`Openverse: ${sets.length} sets picked, ${queried} searched, ${photos} photos kept, ${errors} errors; ${total[0]?.n ?? '?'} Openverse photos in total`);
  if (errors > 0 && queried === 0) process.exitCode = 1;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`::error::${e.message}`); process.exit(1); });
}
