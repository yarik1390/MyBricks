// ---------------------------------------------------------------------------
// BrickLink minifig catalog helpers.
//
// Rebrickable doesn't expose BrickLink minifig ids, so BrickLink minifig price
// lookups (which need "sw0001"-style ids, not Rebrickable "fig-000123") had no
// working id. The admin uploads BrickLink's minifig catalog export (a TAB-
// separated file: Category ID / Category Name / Number / Name / Year / Weight);
// we store id + name + year and resolve each Rebrickable minifig's bl_id by
// matching on a normalized name (year-disambiguated). Precision over recall: we
// only assign a bl_id when the match is unambiguous — a wrong id would price the
// wrong figure, which is worse than falling back to eBay/formula.
// ---------------------------------------------------------------------------

export interface BlMinifig {
  bl_id: string;
  name: string;
  category: string;
  year: number | null;
  norm_name: string;
}

/** Normalize a minifig name for cross-catalog matching: lowercase, drop
 *  parenthetical variant notes, collapse punctuation to single spaces. */
export function normalizeMinifigName(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\([^)]*\)/g, ' ')     // drop parenthetical notes e.g. "(Tatooine)"
    .replace(/[^a-z0-9]+/g, ' ')    // any punctuation -> space
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse BrickLink's TAB-separated minifig catalog export.
 *  Columns: Category ID | Category Name | Number | Name | Year | Weight.
 *  Skips the header and any blank/short rows. */
export function parseMinifigCatalog(text: string): BlMinifig[] {
  const out: BlMinifig[] = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cols = raw.split('\t');
    if (cols.length < 4) continue;
    const c0 = (cols[0] || '').trim();
    if (c0.toLowerCase() === 'category id') continue; // header
    const bl_id = (cols[2] || '').trim();
    const name = (cols[3] || '').trim();
    if (!bl_id || !name) continue;
    const yearRaw = (cols[4] || '').trim();
    const year = /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : null;
    out.push({ bl_id, name, category: (cols[1] || '').trim(), year, norm_name: normalizeMinifigName(name) });
  }
  return out;
}

/** Pick the BrickLink id for a Rebrickable minifig from same-normalized-name
 *  candidates. Unique match wins; otherwise disambiguate by year (exact, then
 *  ±1 — the two catalogs disagree by a year on release-boundary figs); if still
 *  not unique, return null (don't guess). */
export function resolveBlId(
  candidates: Array<{ bl_id: string; year: number | null }>,
  rbYear: number | null,
): string | null {
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].bl_id;
  if (rbYear != null) {
    const byYear = candidates.filter((c) => c.year === rbYear);
    if (byYear.length === 1) return byYear[0].bl_id;
    if (byYear.length === 0) {
      const near = candidates.filter((c) => c.year != null && Math.abs(c.year - rbYear) <= 1);
      if (near.length === 1) return near[0].bl_id;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tiered name matching.
//
// Exact normalized-name equality resolves only ~12% of the figs we want to
// price: the two catalogs describe the same figure at different levels of
// detail ("Gorzan" vs "Gorzan - Fire Chi", "Batman, Black Suit, Black Cape"
// vs "Batman - Black Suit"). Measured over the eligible population, allowing a
// name to be a PREFIX of the other roughly triples the candidate hit rate
// (17% → 62% of figs get at least one candidate).
//
// Precision is preserved by keeping the tiers strictly ordered — an exact
// match is never traded for a prefix one — and by only auto-assigning when the
// winning tier resolves to a single id. Everything else is handed to the
// price-agreement verifier (jobs/minifig-verify.ts) rather than guessed at.
// ---------------------------------------------------------------------------

export interface BlNameCandidate { bl_id: string; norm_name: string; year: number | null }

export interface BlNameMatch {
  /** Unambiguous id, or null when the caller should verify instead. */
  bl_id: string | null;
  /** Best-tier candidates to park for price-agreement verification (empty when
   *  bl_id is set, or when nothing plausible matched). */
  ambiguous: BlNameCandidate[];
  /** 'exact' | 'bl_longer' | 'rb_longer' — which tier produced the result. */
  tier: 'exact' | 'bl_longer' | 'rb_longer' | null;
}

/** Cumulative multi-token prefixes of a normalized name, longest first. Used to
 *  find BrickLink rows whose (shorter) name is a prefix of the Rebrickable one.
 *  Single-token prefixes are excluded on purpose: "batman" alone would match a
 *  generic figure rather than the variant we are pricing. */
export function namePrefixes(norm: string, max = 12): string[] {
  const tokens = String(norm || '').split(' ').filter(Boolean);
  const out: string[] = [];
  for (let n = tokens.length - 1; n >= 2 && out.length < max; n--) out.push(tokens.slice(0, n).join(' '));
  return out;
}

const MAX_AMBIGUOUS = 6; // cap the verification fan-out (each candidate costs a BrickLink call)

/** Rank pre-filtered BrickLink rows against a Rebrickable minifig. `rows` should
 *  contain exact matches, names extending `rbNorm`, and names that `rbNorm`
 *  extends; anything unrelated is ignored here. */
export function matchBlCandidates(
  rows: BlNameCandidate[],
  rbNorm: string,
  rbYear: number | null,
): BlNameMatch {
  const exact: BlNameCandidate[] = [];
  const blLonger: BlNameCandidate[] = [];
  const rbLonger: BlNameCandidate[] = [];
  for (const r of rows ?? []) {
    const n = r?.norm_name;
    if (!n) continue;
    if (n === rbNorm) exact.push(r);
    else if (n.startsWith(`${rbNorm} `)) blLonger.push(r);
    else if (rbNorm.startsWith(`${n} `)) rbLonger.push(r);
  }

  // Within the "Rebrickable is more specific" tier, only the LONGEST BrickLink
  // prefix is a real candidate — shorter ones are ancestors of it, not rivals.
  let rbLongerBest: BlNameCandidate[] = [];
  if (rbLonger.length) {
    const longest = Math.max(...rbLonger.map((c) => c.norm_name.length));
    rbLongerBest = rbLonger.filter((c) => c.norm_name.length === longest);
  }

  const tiers: Array<[BlNameMatch['tier'], BlNameCandidate[]]> = [
    ['exact', exact],
    ['bl_longer', blLonger],
    ['rb_longer', rbLongerBest],
  ];
  for (const [tier, candidates] of tiers) {
    if (!candidates.length) continue;
    // An exact name match is self-corroborating: same name, same figure. The two
    // PREFIX tiers are not — they matched on a truncation, so a lone candidate is
    // NOT evidence on its own and must agree on release year before we assign it.
    //
    // This is not hypothetical. Rebrickable "Captain America - Zombie" (2021)
    // truncates to "captain america", which is exactly what BrickLink sh0028
    // "Captain America (Toy Fair 2012 Exclusive)" normalizes to once the
    // parenthetical is dropped — and that figure is worth $884. Without the year
    // gate, a $9 fig inherited a $884 price. Rivals and un-corroborated matches
    // go to the price-agreement verifier instead.
    const picked = tier === 'exact'
      ? resolveBlId(candidates, rbYear)
      : resolveBlId(candidates.filter((c) => yearAgrees(c.year, rbYear)), rbYear);
    if (picked) return { bl_id: picked, ambiguous: [], tier };
    // Hand the closest few to the verifier, nearest release year first.
    const ranked = [...candidates].sort((a, b) => yearDistance(a.year, rbYear) - yearDistance(b.year, rbYear));
    return { bl_id: null, ambiguous: ranked.slice(0, MAX_AMBIGUOUS), tier };
  }
  return { bl_id: null, ambiguous: [], tier: null };
}

/** Do the two catalogs agree on the release year? Unknown on either side is NOT
 *  agreement — the prefix tiers need positive corroboration, not absence of
 *  contradiction. ±1 absorbs release-boundary disagreements. */
function yearAgrees(year: number | null, rbYear: number | null): boolean {
  return year != null && rbYear != null && Math.abs(year - rbYear) <= 1;
}

function yearDistance(year: number | null, rbYear: number | null): number {
  if (year == null || rbYear == null) return 9999;
  return Math.abs(year - rbYear);
}
