/**
 * Pure identity rules for PriceCharting products whose link to a catalog set is
 * in doubt (the admin "Quarantined source matches" queue).
 *
 * PriceCharting titles carry the set number ("The Frog House #21256") and that
 * number is curated, while its UPC field is not: some products carry another
 * set's barcode, so a barcode match alone paired Frog House with 75370-1
 * Stormtrooper Mech. The rules below trust the title number when it names a set
 * in the catalog AND the title's name agrees with that set, keep a candidate
 * only when the names agree, and reject everything that can be shown wrong.
 */

export interface TitleToken {
  /** Full provider token when it carries a variant suffix ("75188-2"). */
  explicit: string | null;
  /** Base number ("21256"), or null when the title has no single number. */
  base: string | null;
}

/** Same token rule as the bulk CSV parser: exactly one number, else none. */
export function parseTitleToken(title: string | null | undefined): TitleToken {
  const tokens = [...String(title || '').matchAll(/(?:^|[^\w-])(#?\d{3,7}(?:-\d+)?)(?![\w-])/g)]
    .map((m) => m[1]).filter((t) => t.startsWith('#') || t.includes('-') || /^\d{4,6}$/.test(t));
  const token = tokens.length === 1 ? tokens[0].replace(/^#/, '') : null;
  return {
    explicit: token?.includes('-') ? token : null,
    base: token?.replace(/-\d+$/, '') ?? null,
  };
}

const STOP = new Set(['lego', 'the', 'and', 'set', 'with', 'of', 'a', 'an', 'new', 'sealed']);

function nameTokens(value: string): string[] {
  return String(value || '')
    .toLowerCase()
    .replace(/#\s*\d+(?:-\d+)?/g, ' ')
    .replace(/['’]s\b/g, 's')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t) && !/^\d+$/.test(t));
}

function bigrams(value: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < value.length - 1; i++) out.push(value.slice(i, i + 2));
  return out;
}

/**
 * True when a provider title and a catalog name describe the same product:
 * every word of the shorter name appears in the longer one ("Cassette Player"
 * vs "Portable Cassette Player"), or the two are near-identical spellings.
 *
 * `loose` is for a set the title number already names: there the name is only
 * a guard against another numbering scheme ("VW Van #258" is not 258-1 "Zoo
 * with Baseboard"), so half of the shorter name's words is enough
 * ("Flexible and Straight Tracks #7499" is 7499-1 "Flexible Rails").
 */
export function namesAgree(providerTitle: string, catalogName: string, loose = false): boolean {
  const a = nameTokens(providerTitle);
  const b = nameTokens(catalogName);
  if (!a.length || !b.length) return false;
  const [shorter, longer] = a.length <= b.length ? [a, new Set(b)] : [b, new Set(a)];
  const shared = shorter.filter((t) => longer.has(t)).length;
  if (shared === shorter.length || (loose && shared * 2 >= shorter.length)) return true;
  const x = bigrams(a.join(' '));
  const y = bigrams(b.join(' '));
  if (!x.length || !y.length) return false;
  const pool = [...y];
  let common = 0;
  for (const g of x) {
    const i = pool.indexOf(g);
    if (i >= 0) { common++; pool.splice(i, 1); }
  }
  return (2 * common) / (x.length + y.length) >= 0.8;
}

export interface CatalogSet { set_num: string; name: string }

export interface QuarantinedMatch {
  source_item_id: string;
  set_num: string | null;
  source_title: string | null;
  match_method: string | null;
  match_confidence?: number | null;
}

/**
 * Confidence the bulk import's contradiction sweep stamps on a verified link it
 * demotes. Together with a once-verified match_method it marks a row the feed
 * itself contradicted, as opposed to one a person parked in quarantine.
 */
export const DEMOTED_CONFIDENCE = 0.1;

export type TriageDecision =
  /** Link the product to `set_num` (the title's set, or the agreeing candidate). */
  | { action: 'verify'; set_num: string; reason: string }
  /**
   * Keep the candidate although the title number names another catalog set:
   * the names agree with the candidate, not with that set. Stored as a manual
   * decision so the bulk import's title-contradiction sweep leaves it alone.
   */
  | { action: 'manual'; set_num: string; reason: string }
  | { action: 'reject'; reason: string }
  /** Delete a retired synthetic key (only once a real product owns the set). */
  | { action: 'drop'; reason: string }
  /**
   * Leave it for a human. `set_num`, when present, is a better candidate to show
   * than the current one (which the title proves wrong).
   */
  | { action: 'keep'; reason: string; set_num?: string };

/**
 * Decide one quarantined PriceCharting match.
 *
 * @param candidate the catalog set the row currently points at (null if none)
 * @param titleSets catalog sets the title number resolves to: the exact set for
 *   an explicit "-N" token, else every variant sharing the base number
 */
export function decideQuarantinedMatch(
  row: QuarantinedMatch,
  candidate: CatalogSet | null,
  titleSets: CatalogSet[],
): TriageDecision {
  const id = String(row.source_item_id || '');
  // Synthetic price-agreement keys are retired once a real product id replaced
  // them. They are not provider products and there is nothing to review.
  if (id.startsWith('legacy:')) return { action: 'drop', reason: 'superseded synthetic link' };
  // Legacy pc_id rows carry our own catalog name as their "title", so the name
  // check below would only compare the catalog with itself. A token conflict is
  // a category/variant call the import already refused to make.
  if (row.match_method === 'legacy_pc_id' || row.match_method === 'set_token_conflict') {
    return { action: 'keep', reason: 'needs a person' };
  }
  const decision = decideByTitle(row, candidate, titleSets);
  // A base-number candidate was never verified: the import deliberately does
  // not accept a bare number as identity. Only provable mismatches are settled;
  // a plausible one stays for review, pointed at the set the title supports.
  // The same holds for a once-verified row a person (not the sweep) parked.
  const demoted = row.match_method !== 'base_candidate'
    && Number(row.match_confidence ?? DEMOTED_CONFIDENCE) <= DEMOTED_CONFIDENCE;
  if (!demoted && (decision.action === 'verify' || decision.action === 'manual')) {
    return {
      action: 'keep', reason: 'plausible match awaits review',
      ...(decision.set_num !== row.set_num ? { set_num: decision.set_num } : {}),
    };
  }
  if (!demoted && decision.action === 'reject' && row.match_method !== 'base_candidate') {
    return { action: 'keep', reason: 'parked by a person' };
  }
  return decision;
}

function decideByTitle(
  row: QuarantinedMatch,
  candidate: CatalogSet | null,
  titleSets: CatalogSet[],
): TriageDecision {
  const title = String(row.source_title || '');
  const token = parseTitleToken(title);
  const candidateAgrees = !!candidate && namesAgree(title, candidate.name);

  if (token.base && titleSets.length) {
    const agreeing = titleSets.filter((s) => namesAgree(title, s.name, true));
    const target = titleSets.length === 1 ? titleSets[0] : (agreeing.length === 1 ? agreeing[0] : null);
    if (target && namesAgree(title, target.name, true)) {
      return { action: 'verify', set_num: target.set_num, reason: 'title number and name agree' };
    }
    if (candidate && candidateAgrees && !titleSets.some((s) => s.set_num === candidate.set_num)) {
      return { action: 'manual', set_num: candidate.set_num, reason: 'name agrees with candidate, not title number' };
    }
    if (!target && agreeing.length > 1) {
      const onVariant = !!candidate && agreeing.some((s) => s.set_num === candidate.set_num);
      return {
        action: 'keep', reason: 'several variants match the title',
        ...(onVariant ? {} : { set_num: agreeing[0].set_num }),
      };
    }
    if (candidate && candidateAgrees) {
      return { action: 'verify', set_num: candidate.set_num, reason: 'name agrees with candidate variant' };
    }
    return { action: 'reject', reason: 'title names a different set' };
  }

  // No usable number (unknown to the catalog, a shop item number, or none).
  if (candidate && candidateAgrees) {
    return { action: 'verify', set_num: candidate.set_num, reason: 'name agrees with candidate' };
  }
  return { action: 'reject', reason: candidate ? 'title and candidate name disagree' : 'no catalog set matches' };
}
