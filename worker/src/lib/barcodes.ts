import type { Env } from '../types';
import { searchBricksetByBarcode } from './brickset';
import { fetchWithRetry } from './http';

// Barcode → set resolution for the scanner.
//
// A LEGO set is sold under several barcodes: a US UPC-A (12 digits, 673419…)
// and a European EAN-13 (570201…), sometimes more for regional boxes.
// lego_sets.upc keeps just one, so everything else lives in set_barcodes.

// Every spelling a scanned code may be stored under: EAN-13 with a leading 0
// is the same number as a UPC-A, and GTIN-14 pads one more 0.
export function barcodeCandidates(raw: string): string[] {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 14) return [];
  const out = new Set<string>([digits]);
  const stripped = digits.replace(/^0+/, '');
  if (stripped.length >= 8) {
    out.add(stripped);
    if (stripped.length <= 12) out.add(stripped.padStart(12, '0'));
    if (stripped.length <= 13) out.add(stripped.padStart(13, '0'));
    if (stripped.length <= 14) out.add(stripped.padStart(14, '0'));
  }
  return [...out];
}

// GS1 check digit (EAN-8/UPC-A/EAN-13/GTIN-14). A misread code fails this, so
// we never spend a remote lookup (or cache a "miss") on camera noise.
export function isValidGtin(raw: string): boolean {
  const d = String(raw || '').replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(d.length)) return false;
  let sum = 0;
  for (let i = d.length - 2, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(d[i]) * w;
  return (10 - (sum % 10)) % 10 === Number(d[d.length - 1]);
}

export function barcodeKind(code: string): string {
  const d = code.replace(/^0+/, '');
  if (code.length === 12) return 'upc';
  if (code.length === 13 && d.length === 12) return 'upc';
  if (code.length === 13) return 'ean';
  if (code.length === 8) return 'ean8';
  return 'other';
}

export type BarcodeMatchSource = 'catalog' | 'barcode_table' | 'taught_by_you' | 'brickset' | 'upcitemdb';

export interface BarcodeMatch {
  setNum: string;
  source: BarcodeMatchSource;
}

const MISS_TTL_DAYS = 7;

function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(',');
}

// Local lookups only (no network): the catalog's single upc, the barcode
// table, then the caller's own "Teach us this barcode" submissions (pending or
// approved), so a code someone taught works for them straight away.
export async function findSetByBarcodeLocal(env: Env, raw: string, userId?: string | null): Promise<BarcodeMatch | null> {
  const codes = barcodeCandidates(raw);
  if (!codes.length) return null;
  const ph = placeholders(codes.length);
  const cat = await env.DB.prepare(`SELECT set_num FROM lego_sets WHERE upc IN (${ph}) LIMIT 1`)
    .bind(...codes).first<{ set_num: string }>();
  if (cat?.set_num) return { setNum: cat.set_num, source: 'catalog' };
  try {
    const row = await env.DB.prepare(
      `SELECT b.set_num FROM set_barcodes b JOIN lego_sets s ON s.set_num = b.set_num
       WHERE b.code IN (${ph}) AND b.set_num <> '' LIMIT 1`,
    ).bind(...codes).first<{ set_num: string }>();
    if (row?.set_num) return { setNum: row.set_num, source: 'barcode_table' };
  } catch { /* table missing on an old DB: fall through */ }
  if (userId) {
    try {
      const mine = await env.DB.prepare(
        `SELECT set_num FROM set_contributions
         WHERE user_id = ? AND kind = 'barcode' AND status IN ('pending','approved') AND deleted_at IS NULL
           AND json_extract(payload, '$.upc') IN (${ph})
         ORDER BY created_at DESC LIMIT 1`,
      ).bind(userId, ...codes).first<{ set_num: string }>();
      if (mine?.set_num) return { setNum: mine.set_num, source: 'taught_by_you' };
    } catch { /* malformed payload JSON: ignore */ }
  }
  return null;
}

// Save codes for a set. A real mapping replaces a cached miss but never an
// existing different mapping (first trustworthy source wins).
export function saveBarcodeStatements(env: Env, setNum: string, codes: Array<string | null | undefined>, source: string): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [];
  const seen = new Set<string>();
  for (const c of codes) {
    const code = String(c || '').replace(/\D/g, '');
    if (code.length < 8 || seen.has(code)) continue;
    seen.add(code);
    out.push(env.DB.prepare(
      `INSERT INTO set_barcodes (code, set_num, kind, source) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(code) DO UPDATE SET set_num = excluded.set_num, kind = excluded.kind,
         source = excluded.source, created_at = CURRENT_TIMESTAMP
       WHERE set_barcodes.set_num = ''`,
    ).bind(code, setNum, barcodeKind(code), source));
  }
  return out;
}

async function catalogHas(env: Env, setNum: string): Promise<{ set_num: string; name: string } | null> {
  return env.DB.prepare('SELECT set_num, name FROM lego_sets WHERE set_num = ?').bind(setNum).first<{ set_num: string; name: string }>();
}

const STOP_WORDS = new Set(['lego', 'with', 'from', 'pieces', 'piece', 'building', 'toy', 'set', 'kit', 'and', 'the', 'for', 'new', 'sealed']);
function nameWords(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP_WORDS.has(w));
}

// Pull a catalog set out of a retailer product title ("LEGO City Police
// Training Academy 60372 Building Toy"). The number must exist in our catalog
// AND share a real word with that set's name, so "823 pieces" or a year can't
// pass for a set number.
export async function setFromProductTitle(env: Env, title: string): Promise<string | null> {
  if (!/lego/i.test(title)) return null;
  const nums = [...new Set((title.match(/\b\d{4,7}\b/g) || []))]
    .filter(n => !(n.length === 4 && Number(n) >= 1949 && Number(n) <= 2035))
    .sort((a, b) => Math.abs(a.length - 5) - Math.abs(b.length - 5));
  const titleWords = new Set(nameWords(title));
  for (const n of nums.slice(0, 4)) {
    const row = await catalogHas(env, `${n}-1`);
    if (!row) continue;
    if (nameWords(row.name || '').some(w => titleWords.has(w))) return row.set_num;
  }
  return null;
}

async function lookupUpcItemDb(env: Env, code: string): Promise<string | null> {
  try {
    const resp = await fetchWithRetry(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`, {
      headers: { Accept: 'application/json' },
    }, { timeoutMs: 5000, retries: 0 });
    if (!resp.ok) return null;
    const data = await resp.json() as { items?: Array<{ title?: string; brand?: string }> };
    for (const item of data.items ?? []) {
      const title = `${item.brand || ''} ${item.title || ''}`;
      const hit = await setFromProductTitle(env, title);
      if (hit) return hit;
    }
  } catch { /* non-fatal */ }
  return null;
}

async function recentMiss(env: Env, codes: string[]): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      `SELECT 1 AS x FROM set_barcodes WHERE code IN (${placeholders(codes.length)}) AND set_num = ''
       AND created_at > datetime('now', '-${MISS_TTL_DAYS} days') LIMIT 1`,
    ).bind(...codes).first();
    return !!row;
  } catch {
    return false;
  }
}

// Remote fallbacks for a code nobody local knows: Brickset's search (verified
// against the barcodes it returns), then UPCitemdb's free lookup (title must
// name a catalog set). Hits are saved so the next scan is instant; misses are
// remembered for a week.
export async function findSetByBarcodeRemote(env: Env, raw: string): Promise<BarcodeMatch | null> {
  const codes = barcodeCandidates(raw);
  // All-zero / padded junk ("0000000000000") passes the checksum; skip it.
  if (!codes.length || !isValidGtin(raw) || String(raw).replace(/\D/g, '').replace(/^0+/, '').length < 8) return null;
  if (await recentMiss(env, codes)) return null;
  const scanned = String(raw).replace(/\D/g, '');

  const bs = await searchBricksetByBarcode(codes, env);
  if (bs && await catalogHas(env, bs.setNum)) {
    await saveAll(env, bs.setNum, [scanned, bs.codes.upc, bs.codes.ean], 'brickset');
    return { setNum: bs.setNum, source: 'brickset' };
  }
  const upcHit = await lookupUpcItemDb(env, scanned);
  if (upcHit) {
    await saveAll(env, upcHit, [scanned], 'upcitemdb');
    return { setNum: upcHit, source: 'upcitemdb' };
  }
  try {
    await env.DB.prepare(
      `INSERT INTO set_barcodes (code, set_num, kind, source) VALUES (?1, '', ?2, 'miss')
       ON CONFLICT(code) DO UPDATE SET created_at = CURRENT_TIMESTAMP WHERE set_barcodes.set_num = ''`,
    ).bind(scanned, barcodeKind(scanned)).run();
  } catch { /* best-effort */ }
  return null;
}

async function saveAll(env: Env, setNum: string, codes: Array<string | null | undefined>, source: string): Promise<void> {
  try {
    const stmts = saveBarcodeStatements(env, setNum, codes, source);
    if (stmts.length) await env.DB.batch(stmts);
  } catch { /* best-effort */ }
}

