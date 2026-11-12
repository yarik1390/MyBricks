// OCR-first set identification: parse printed LEGO set numbers from client
// text (ML Kit / TextDetector) and resolve them against lego_sets. Never
// invents a set — empty, unmapped, or ambiguous results fall through to
// Brickognize / the vision cascade.

const MAX_STRINGS = 32;
const MAX_STRING_CHARS = 200;
const MAX_TOKENS = 12;
const MAX_LOOKUP_KEYS = 48;

export type OcrResolveResult =
  | { kind: 'accepted'; setNum: string; token: string; name: string; method: 'label' | 'box-front' }
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

export async function resolveOcrSetNum(db: D1Database, tokens: string[], lines: string[] = []): Promise<OcrResolveResult> {
  const labelled = await resolveLabelledSetNum(db, tokens);
  // An explicit label wins; an ambiguous label is not overridden by box text.
  if (labelled.kind === 'accepted' || labelled.kind === 'ambiguous') return labelled;
  const boxFront = await resolveBoxFrontSetNum(db, lines);
  if (boxFront.kind !== 'empty') return boxFront;
  return labelled;
}

async function resolveLabelledSetNum(db: D1Database, tokens: string[]): Promise<OcrResolveResult> {
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
  if (unique.length === 1) return { kind: 'accepted', ...unique[0], method: 'label' };
  if (unique.length > 1) return { kind: 'ambiguous', setNums: unique.map((row) => row.setNum) };
  return { kind: 'unmapped' };
}

// ---------------------------------------------------------------------------
// Box-front numbers. Most LEGO boxes print the set number on its own ("75313"
// in a corner) with no "Set" label, so the label parser above missed them and
// those scans went on to Brickognize and the AI. A bare number alone is not
// trusted (a year, piece count or age range can also be a real set number),
// so it is accepted only when the rest of the box text backs it up: the set's
// piece count, or words from its name. The theme alone is not enough.

const MAX_BARE_NUMBERS = 12;
const NAME_STOP = new Set([
  'lego', 'the', 'and', 'with', 'from', 'set', 'pack', 'edition', 'series', 'building',
  'toy', 'kit', 'collection', 'new', 'for', 'of', 'build', 'bricks',
]);

function normalizeOcrWords(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Bare 4-6 digit numbers that could be a set number printed on a box front. */
export function extractBoxFrontNumbers(lines: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const line = String(raw || '').replace(/[\u2013\u2014\u2212]/g, '-');
    const re = /\d+(?:[.,]\d+)*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      const token = m[0];
      if (!/^\d{4,6}$/.test(token)) continue; // decimals, 2,316, barcodes, short numbers
      const before = line.slice(Math.max(0, m.index - 12), m.index).toLowerCase();
      const after = line.slice(m.index + token.length, m.index + token.length + 10).toLowerCase();
      if (/[$\u20ac\u00a3]\s*$/.test(before)) continue;             // price
      if (/(?:\u00a9|\(c\)|copyright)\s*$/.test(before)) continue;    // © 2024
      if (/\bages?\s*$/.test(before) || /^\s*\+/.test(after)) continue; // ages 18+, 9+
      if (/-\s*$/.test(before) || /^\s*-\s*\d/.test(after)) continue;  // ranges 8-14
      if (/^\s*(?:pcs|pc|pieces?|pzs|pz|pi[eè]ces|teile|stk|st\.|el\b|elem|db|kpl|onderdelen|dílků|elementy?|частей|деталей)/i.test(after)) continue; // piece counts
      if (/^\s*(?:g|kg|ml|cm|mm|in)\b/.test(after)) continue;          // measurements
      if (seen.has(token)) continue;
      seen.add(token);
      out.push(token);
      if (out.length >= MAX_BARE_NUMBERS) return out;
    }
  }
  return out;
}

type BoxRow = { set_num: string; name: string; theme?: string | null; pieces?: number | null };

async function boxRows(db: D1Database, keys: string[]): Promise<BoxRow[]> {
  const placeholders = keys.map(() => '?').join(',');
  try {
    const { results } = await db.prepare(
      `SELECT set_num, name, theme, pieces FROM lego_sets WHERE set_num IN (${placeholders})`,
    ).bind(...keys).all<BoxRow>();
    return results || [];
  } catch {
    // Minimal schemas (unit tests) have no theme/pieces columns.
    const { results } = await db.prepare(
      `SELECT set_num, name FROM lego_sets WHERE set_num IN (${placeholders})`,
    ).bind(...keys).all<BoxRow>();
    return results || [];
  }
}

/** How well the box text backs up this catalog row (0 = not at all). */
export function boxFrontEvidence(row: BoxRow, lines: string[], token: string): number {
  const text = ` ${normalizeOcrWords(lines.join(' '))} `;
  // Piece counts on boxes may carry a thousands separator ("6,785" / "6.785").
  const digits = ` ${lines.join(' ').replace(/(\d)[.,](?=\d{3}\b)/g, '$1').replace(/[^0-9]+/g, ' ').trim()} `;
  let score = 0;
  const pieces = Number(row.pieces);
  if (Number.isFinite(pieces) && pieces >= 25 && String(pieces) !== token && digits.includes(` ${pieces} `)) score += 2;
  const name = normalizeOcrWords(row.name);
  const words = name.split(' ').filter((w) => w.length >= 4 && !NAME_STOP.has(w) && !/^\d+$/.test(w));
  const phrase = name.length >= 4 && text.includes(` ${name} `);
  if (phrase || words.some((w) => text.includes(` ${w} `))) score += 2;
  const theme = normalizeOcrWords(row.theme);
  if (theme && theme.length >= 3 && text.includes(` ${theme} `)) score += 1;
  return score;
}

async function resolveBoxFrontSetNum(db: D1Database, lines: string[]): Promise<OcrResolveResult> {
  if (!lines.length) return { kind: 'empty' };
  const numbers = extractBoxFrontNumbers(lines);
  if (!numbers.length) return { kind: 'empty' };
  const keys = [...new Set(numbers.flatMap((n) => [n, `${n}-1`]))];
  const rows = await boxRows(db, keys);
  const scored = rows.map((row) => {
    const token = String(row.set_num).split('-', 1)[0];
    return { row, token, score: boxFrontEvidence(row, lines, token) };
  }).filter((r) => r.score >= 2);
  if (!scored.length) return { kind: 'unmapped' };
  // Strongest evidence first; a modern 5-6 digit number beats a 4-digit one
  // that could be a year.
  scored.sort((a, b) => b.score - a.score || b.token.length - a.token.length);
  const best = scored[0];
  const rivals = scored.filter((r) => r.score === best.score && r.token.length === best.token.length
    && r.row.set_num !== best.row.set_num);
  if (rivals.length) return { kind: 'ambiguous', setNums: [best.row.set_num, ...rivals.map((r) => r.row.set_num)] };
  return { kind: 'accepted', setNum: String(best.row.set_num), token: best.token, name: String(best.row.name || ''), method: 'box-front' };
}
