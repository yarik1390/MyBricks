// OCR-first set identification: parse printed LEGO set numbers from client
// text (ML Kit / TextDetector) and resolve them against lego_sets. Never
// invents a set — empty, unmapped, or ambiguous results fall through to
// Brickognize / the vision cascade.

const MAX_STRINGS = 32;
const MAX_STRING_CHARS = 200;
const MAX_TOKENS = 12;
const MAX_LOOKUP_KEYS = 48;

export type OcrResolveResult =
  | { kind: 'accepted'; setNum: string; token: string; name: string }
  | { kind: 'ambiguous'; setNums: string[] }
  | { kind: 'unmapped' }
  | { kind: 'empty' };

export function sanitizeOcrInput(input: unknown): string[] {
  const list = Array.isArray(input) ? input : (typeof input === 'string' || typeof input === 'number' ? [input] : []);
  const out: string[] = [];
  for (const item of list) {
    if (typeof item === 'string') out.push(item.slice(0, MAX_STRING_CHARS));
    else if (typeof item === 'number' && Number.isFinite(item)) out.push(String(item).slice(0, MAX_STRING_CHARS));
    if (out.length >= MAX_STRINGS) break;
  }
  return out;
}

// Brickognize-style catalog keys: raw token, canonical `-1` when the OCR
// read had no suffix, and the bare digits so `75313-1` still hits `75313`.
export function expandSetNumKeys(token: string): { raw: string; canonical: string; bare: string; keys: string[] } {
  const match = String(token || '').trim().match(/^(\d{3,6})(?:-(\d{1,2}))?$/);
  if (!match) return { raw: token, canonical: token, bare: token, keys: [] };
  const base = match[1];
  const suffix = match[2];
  const raw = suffix ? `${base}-${suffix}` : base;
  const canonical = suffix ? `${base}-${suffix}` : `${base}-1`;
  const bare = base;
  return { raw, canonical, bare, keys: [...new Set([raw, canonical, bare])] };
}

export function parseOcrSetNumbers(input: unknown): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const text of sanitizeOcrInput(input)) {
    for (const token of extractSetNumbersFromText(text)) {
      if (seen.has(token)) continue;
      seen.add(token);
      tokens.push(token);
      if (tokens.length >= MAX_TOKENS) return tokens;
    }
  }
  return tokens;
}

function extractSetNumbersFromText(raw: string): string[] {
  const trimmed = raw.trim();
  // The client sends already-extracted tokens (`75192`, `75313-1`) — never
  // re-run the label gate on those. Shape-validate them instead; they can only
  // ever resolve to exact catalog keys via expandSetNumKeys.
  if (/^\d{3,6}(?:-\d{1,2})?$/.test(trimmed)) return [trimmed];
  let text = raw.replace(/[\u2013\u2014\u2212]/g, '-');
  // OCR often inserts spaces around the variant hyphen ("75313 - 1").
  text = text.replace(/(\d{3,6})\s*-\s*(\d{1,2})\b/g, '$1-$2');
  const found: string[] = [];
  // Do not interpret arbitrary box numbers. A year, piece count or truncated
  // barcode can map to a real set, so require an explicit set-number label.
  const re = /\bset(?:\s+(?:number|no\.?|#))?\s*[:#.-]?\s*(\d{3,6})(?:-(\d{1,2}))?\b/gi;
  let match: RegExpExecArray | null = re.exec(text);
  while (match) {
    const base = match[1];
    const suffix = match[2];
    found.push(suffix ? `${base}-${suffix}` : base);
    match = re.exec(text);
  }
  return found;
}

export async function resolveOcrSetNum(db: D1Database, tokens: string[]): Promise<OcrResolveResult> {
  if (!tokens.length) return { kind: 'empty' };
  const expansions = tokens
    .map((token) => ({ token, ...expandSetNumKeys(token) }))
    .filter((row) => row.keys.length);
  const allKeys = [...new Set(expansions.flatMap((row) => row.keys))].slice(0, MAX_LOOKUP_KEYS);
  if (!allKeys.length) return { kind: 'empty' };

  const placeholders = allKeys.map(() => '?').join(',');
  const { results } = await db.prepare(
    `SELECT set_num, name FROM lego_sets WHERE set_num IN (${placeholders})`,
  ).bind(...allKeys).all<{ set_num: string; name: string }>();

  const byNum = new Map<string, { set_num: string; name: string }>();
  for (const row of results) byNum.set(String(row.set_num), row);

  const matched = new Map<string, { setNum: string; token: string; name: string }>();
  const bareBases = [...new Set(expansions.filter((row) => !row.raw.includes('-')).map((row) => row.bare))];
  const variantsByBase = new Map<string, Array<{ set_num: string; name: string }>>();
  if (bareBases.length) {
    const clauses = bareBases.map(() => 'set_num LIKE ?').join(' OR ');
    const variantRows = await db.prepare(
      `SELECT set_num, name FROM lego_sets WHERE ${clauses}`,
    ).bind(...bareBases.map((base) => `${base}-%`)).all<{ set_num: string; name: string }>();
    for (const row of variantRows.results) {
      const base = String(row.set_num).split('-', 1)[0];
      const rows = variantsByBase.get(base) || [];
      rows.push(row);
      variantsByBase.set(base, rows);
    }
  }
  for (const expansion of expansions) {
    const hits = expansion.keys
      .map((key) => byNum.get(key))
      .filter((row): row is { set_num: string; name: string } => !!row);
    const hasExplicitVariant = expansion.raw.includes('-');
    const exact = hasExplicitVariant ? hits.find((row) => row.set_num === expansion.raw) : undefined;
    // A bare OCR token can refer to any catalog variant (`375-1`, `375-2`, …).
    // Include every variant before deciding the candidate is unique.
    let candidates = exact ? [exact] : hits;
    if (!hasExplicitVariant) {
      candidates = [...candidates, ...(variantsByBase.get(expansion.bare) || [])];
    }
    for (const hit of candidates) {
      const setNum = String(hit.set_num);
      if (!matched.has(setNum)) {
        matched.set(setNum, { setNum, token: expansion.token, name: String(hit.name || '') });
      }
    }
  }

  const unique = [...matched.values()];
  if (unique.length === 1) return { kind: 'accepted', ...unique[0] };
  if (unique.length > 1) return { kind: 'ambiguous', setNums: unique.map((row) => row.setNum) };
  return { kind: 'unmapped' };
}
