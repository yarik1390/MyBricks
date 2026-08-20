import type { Env } from '../types';
import { enrichSetRecord } from './market-sources';

// AI-described set from any vision provider (Gemini / OpenRouter / OpenAI).
export interface DescribedSet {
  set_num?: string | number | null;
  name?: string | null;
  theme?: string | null;
  year?: number | null;
  confidence?: string;
  reasoning?: string;
}

export interface SetMatchResult {
  sets: Record<string, unknown>[];
  topConfidence: string;
  reasoning: string;
}

// Tokenize free text into an FTS5 prefix query ("Millennium Falcon" -> "Millennium* Falcon*").
// Mirrors the catalog search route's helper.
export function ftsPrefixQuery(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(tok => `${tok}*`)
    .join(' ');
}

function normalizeMatchText(value: unknown): string {
  return value == null
    ? ''
    : String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function rankCatalogMatch(row: Record<string, unknown>, cand: DescribedSet): number {
  const rowName = normalizeMatchText(row.name);
  const wantedName = normalizeMatchText(cand.name);
  const rowTheme = normalizeMatchText(row.theme);
  const wantedTheme = normalizeMatchText(cand.theme);
  const rowYear = Number(row.year);
  const wantedYear = Number(cand.year);

  let score = 0;
  if (wantedName && rowName === wantedName) score += 100;
  else if (wantedName && rowName.startsWith(`${wantedName} `)) score += 30;
  if (wantedTheme && rowTheme === wantedTheme) score += 20;
  if (Number.isFinite(wantedYear) && rowYear === wantedYear) score += 10;
  return score;
}

// Resolve AI-described sets to catalog rows. Strategy:
//   1. Exact set number (and its "-1" variant) in one batched query.
//   2. Fall back to the FTS search index by the described name — this is what
//      lets built sets and wrong-number guesses still resolve to a real set.
// Dedupes by set_num, preserves the AI's confidence/reasoning, and returns the
// best matches (empty array when nothing resolves). Fails soft on FTS errors.
export async function matchSetsToCatalog(env: Env, described: DescribedSet[]): Promise<SetMatchResult> {
  const candidates = (described || []).filter(s => (s?.confidence ?? 'none') !== 'none');
  const norm = (v: unknown) => (v == null ? '' : String(v).trim());

  // 1. Batch exact set_num lookups (covers "75192" and "75192-1").
  const exactNums = [...new Set(
    candidates.flatMap(s => {
      const n = norm(s.set_num);
      return n ? [n, `${n}-1`] : [];
    }),
  )];
  const byNum = new Map<string, Record<string, unknown>>();
  if (exactNums.length) {
    const placeholders = exactNums.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT * FROM lego_sets WHERE set_num IN (${placeholders})`,
    ).bind(...exactNums).all<Record<string, unknown>>();
    for (const r of results) byNum.set(String(r.set_num), r);
  }

  const matched: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let topConfidence = 'none';
  let reasoning = '';

  for (const cand of candidates) {
    const n = norm(cand.set_num);
    let row: Record<string, unknown> | null = n ? (byNum.get(n) ?? byNum.get(`${n}-1`) ?? null) : null;

    // 2. FTS fallback by the described name. BM25 alone can rank an accessory
    // such as "Millennium Falcon Bag Tag" above the actual Millennium Falcon.
    // Pull a small candidate window, then prefer exact name/theme/year evidence.
    if (!row && norm(cand.name)) {
      const q = ftsPrefixQuery(norm(cand.name));
      if (q) {
        try {
          const { results } = await env.DB.prepare(
            `SELECT s.*, f.rank AS _scan_fts_rank
             FROM lego_sets s JOIN lego_sets_fts f ON s.rowid = f.rowid
             WHERE f.lego_sets_fts MATCH ? ORDER BY f.rank LIMIT 12`,
          ).bind(q).all<Record<string, unknown>>();
          row = results
            .map((candidate, index) => ({ candidate, index, score: rankCatalogMatch(candidate, cand) }))
            .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.candidate ?? null;
          if (row) delete row._scan_fts_rank;
        } catch (e) {
          console.warn('[scan-match] FTS lookup failed:', (e as Error).message);
        }
      }
    }

    if (row) {
      const setNum = String(row.set_num);
      if (seen.has(setNum)) continue;
      seen.add(setNum);
      // enrichSetRecord recomputes `confidence` as PRICING confidence, so the
      // AI's identification confidence travels under its own key — the shelf
      // checklist shows it per row ("medium match" ≠ "estimated price").
      matched.push(enrichSetRecord({ ...row, retired: !!row.retired, confidence: cand.confidence, reasoning: cand.reasoning, match_confidence: cand.confidence ?? null }));
      if (topConfidence === 'none' || cand.confidence === 'high') {
        topConfidence = cand.confidence ?? topConfidence;
        reasoning = cand.reasoning ?? reasoning;
      }
    }
  }

  return { sets: matched, topConfidence, reasoning };
}

// AI-described minifigure from any vision provider.
export interface DescribedMinifig {
  name?: string | null;
  theme?: string | null;
  confidence?: string;
  reasoning?: string;
}

// Resolve AI-described minifigures to catalog rows by ANDing the distinctive name
// tokens against the minifigs table (which has no FTS index). Returns up to a few
// candidates per description, deduped. Fails soft on query errors.
export async function matchMinifigsToCatalog(env: Env, described: DescribedMinifig[]): Promise<{ minifigs: Record<string, unknown>[] }> {
  const candidates = (described || []).filter(m => (m?.confidence ?? 'none') !== 'none');
  const matched: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const cand of candidates) {
    const raw = (cand.name ?? '').toString().trim();
    if (!raw) continue;
    // Distinctive tokens (drop very short words); cap to keep the LIKE query lean.
    const tokens = raw.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(t => t.length >= 3).slice(0, 4);
    if (!tokens.length) continue;
    const whereLike = tokens.map(() => 'LOWER(m.name) LIKE ?').join(' AND ');
    const binds = tokens.map(t => `%${t}%`);
    try {
      const { results } = await env.DB.prepare(
        `SELECT m.fig_num, m.name, m.series, m.rarity, m.image_url, m.current_value, m.year
         FROM minifigs m
         WHERE ${whereLike}
         ORDER BY (m.current_value IS NOT NULL) DESC, m.name ASC
         LIMIT 3`,
      ).bind(...binds).all<Record<string, unknown>>();
      for (const r of results) {
        const fn = String(r.fig_num);
        if (seen.has(fn)) continue;
        seen.add(fn);
        matched.push({ ...r, confidence: cand.confidence, reasoning: cand.reasoning });
      }
    } catch (e) {
      console.warn('[scan-match] minifig lookup failed:', (e as Error).message);
    }
  }

  return { minifigs: matched };
}
