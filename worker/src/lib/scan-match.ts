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

    // 2. FTS fallback by the described name.
    if (!row && norm(cand.name)) {
      const q = ftsPrefixQuery(norm(cand.name));
      if (q) {
        try {
          row = await env.DB.prepare(
            `SELECT s.* FROM lego_sets s JOIN lego_sets_fts f ON s.rowid = f.rowid
             WHERE f.lego_sets_fts MATCH ? ORDER BY f.rank LIMIT 1`,
          ).bind(q).first<Record<string, unknown>>();
        } catch (e) {
          console.warn('[scan-match] FTS lookup failed:', (e as Error).message);
        }
      }
    }

    if (row) {
      const setNum = String(row.set_num);
      if (seen.has(setNum)) continue;
      seen.add(setNum);
      matched.push(enrichSetRecord({ ...row, retired: !!row.retired, confidence: cand.confidence, reasoning: cand.reasoning }));
      if (topConfidence === 'none' || cand.confidence === 'high') {
        topConfidence = cand.confidence ?? topConfidence;
        reasoning = cand.reasoning ?? reasoning;
      }
    }
  }

  return { sets: matched, topConfidence, reasoning };
}
