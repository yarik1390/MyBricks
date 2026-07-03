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
 *  candidates. Unique match wins; otherwise disambiguate by year; if still not
 *  unique, return null (don't guess). */
export function resolveBlId(
  candidates: Array<{ bl_id: string; year: number | null }>,
  rbYear: number | null,
): string | null {
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].bl_id;
  if (rbYear != null) {
    const byYear = candidates.filter((c) => c.year === rbYear);
    if (byYear.length === 1) return byYear[0].bl_id;
  }
  return null;
}
