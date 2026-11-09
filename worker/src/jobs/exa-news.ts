import type { Env } from '../types';
import { exaConfigured, exaSearch, hostOf, LEGO_NEWS_DOMAINS, type ExaResult } from '../lib/exa';
import { quotaRemaining } from '../lib/api-quota';
import { rescoreRetirementRisk } from '../lib/set-news';

// LEGO news via Exa (Iaroslav, 2026-11-04: "News scan + missing data").
//
// runExaNewsScan (daily): a handful of searches of LEGO news sites for
// articles from the last week about retiring or newly revealed sets. Each
// article's sets go into set_news. Retiring reports raise the retirement risk
// score (Retiring soon); newly revealed sets reported by two sites, or by
// lego.com, join Coming soon when the catalog doesn't show them on sale.
//
// runExaRetirementLookups (daily): the missing-data fill. Real sets already
// have a retail price (2026-11-04: 5 of ~3,400 active sets lacked one), but
// ~1,300 active sets have no retirement date. For a few of them a day, ask Exa
// whether any LEGO site reports when the set retires.

const DAY_MS = 86_400_000;

type NewsKind = 'retiring' | 'upcoming';

export interface NewsRow {
  set_num: string;
  kind: NewsKind;
  url: string;
  domain: string;
  title: string | null;
  name: string | null;
  published_at: string | null;
  expected_date: string | null;
  price_usd: number | null;
}

/** "76419", "76419-1" or "Set 76419" -> "76419-1"; null when not a set number. */
export function normalizeSetNum(raw: unknown): string | null {
  const m = String(raw ?? '').match(/\b(\d{4,7})(?:-(\d{1,2}))?\b/);
  return m ? `${m[1]}-${m[2] ?? '1'}` : null;
}

/**
 * A date from an article as YYYY-MM-DD. A month or a year alone means its end
 * for a retirement (LEGO retires sets at the end of a month or year) and its
 * start for a release. Null when missing or implausible.
 */
export function normalizeNewsDate(raw: unknown, kind: NewsKind, now = new Date()): string | null {
  const s = String(raw ?? '').trim();
  const y0 = now.getUTCFullYear();
  const ok = (y: number) => y >= y0 - 1 && y <= y0 + 3;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return ok(+m[1]) && +m[2] >= 1 && +m[2] <= 12 ? `${m[1]}-${m[2]}-${m[3]}` : null;
  m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    if (!ok(+m[1]) || +m[2] < 1 || +m[2] > 12) return null;
    if (kind === 'upcoming') return `${m[1]}-${m[2]}-01`;
    const last = new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate();
    return `${m[1]}-${m[2]}-${String(last).padStart(2, '0')}`;
  }
  m = s.match(/^(\d{4})$/);
  if (m) return ok(+m[1]) ? (kind === 'upcoming' ? `${m[1]}-01-01` : `${m[1]}-12-31`) : null;
  return null;
}

const plausiblePrice = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 2000 ? Math.round(v * 100) / 100 : null);

// ---------------------------------------------------------------------------
// News scan
// ---------------------------------------------------------------------------

const NEWS_QUERIES = [
  'LEGO sets retiring soon',
  'LEGO sets retiring at the end of the year, retirement dates',
  'new LEGO sets officially revealed',
  'upcoming LEGO sets announced with release date and price',
  'LEGO sets leaving LEGO.com, last chance to buy',
  // Added 2026-11-09 (credits moved from the per-set lookups, which found 1 date in 60).
  'LEGO retiring sets list by theme: Star Wars, Technic, Icons, Ideas, Harry Potter',
  'LEGO sets confirmed retiring next year',
  'LEGO new sets January 2027 first look',
  'LEGO new sets revealed this week with set numbers and prices',
  'LEGO sets discontinued, final months on sale',
];

const NEWS_SCHEMA = {
  type: 'object',
  properties: {
    sets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          set_number: { type: 'string', description: 'LEGO set number, digits only (e.g. 76419)' },
          name: { type: 'string' },
          status: { type: 'string', enum: ['retiring', 'new', 'other'] },
          date: { type: 'string', description: 'Retirement date for a retiring set, release date for a new set: YYYY-MM-DD, YYYY-MM or YYYY. Empty when not stated.' },
          price_usd: { type: 'number', description: 'US price in USD, only when the article states it' },
        },
      },
    },
  },
};

const NEWS_PROMPT = 'List every LEGO set this article reports as retiring (being discontinued) or as newly revealed / upcoming (not on sale yet). For each give the LEGO set number, name, status "retiring" or "new" ("other" for anything else), the retirement or release date the article gives, and the US price if stated. Only sets the article names with a set number.';

/** set_news rows from one news search result. */
export function newsRowsFromResult(r: ExaResult, now = new Date()): NewsRow[] {
  const summary = r.summary as { sets?: unknown } | null;
  const sets = summary && Array.isArray(summary.sets) ? summary.sets : [];
  const domain = hostOf(r.url);
  if (!domain) return [];
  const rows: NewsRow[] = [];
  const seen = new Set<string>();
  for (const item of sets.slice(0, 80) as Array<Record<string, unknown>>) {
    const setNum = normalizeSetNum(item?.set_number);
    const status = String(item?.status ?? '').toLowerCase();
    const kind: NewsKind | null = status === 'retiring' ? 'retiring' : status === 'new' ? 'upcoming' : null;
    if (!setNum || !kind || seen.has(`${kind}:${setNum}`)) continue;
    seen.add(`${kind}:${setNum}`);
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 120) || null : null;
    rows.push({
      set_num: setNum, kind, url: r.url.slice(0, 500), domain,
      title: r.title?.slice(0, 200) ?? null, name,
      published_at: r.publishedDate, expected_date: normalizeNewsDate(item.date, kind, now),
      price_usd: kind === 'upcoming' ? plausiblePrice(item.price_usd) : null,
    });
  }
  return rows;
}

function upsertNews(env: Env, row: NewsRow): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO set_news (set_num, kind, url, domain, title, name, published_at, expected_date, price_usd, seen_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, datetime('now'))
     ON CONFLICT(set_num, kind, url) DO UPDATE SET
       expected_date = COALESCE(excluded.expected_date, set_news.expected_date),
       price_usd = COALESCE(excluded.price_usd, set_news.price_usd),
       seen_at = excluded.seen_at`,
  ).bind(row.set_num, row.kind, row.url, row.domain, row.title, row.name, row.published_at, row.expected_date, row.price_usd);
}

async function existingSets(env: Env, setNums: string[]): Promise<Map<string, {
  name: string; year: number | null; retired: number; lego_availability: string | null;
}>> {
  const out = new Map<string, { name: string; year: number | null; retired: number; lego_availability: string | null }>();
  for (let i = 0; i < setNums.length; i += 90) {
    const chunk = setNums.slice(i, i + 90);
    const { results } = await env.DB.prepare(
      `SELECT set_num, name, year, retired, lego_availability FROM lego_sets WHERE set_num IN (${chunk.map(() => '?').join(',')})`,
    ).bind(...chunk).all<{ set_num: string; name: string; year: number | null; retired: number; lego_availability: string | null }>();
    for (const r of results ?? []) out.set(r.set_num, r);
  }
  return out;
}

/**
 * Add newly revealed sets to Coming soon. Needs two sites (or lego.com), and
 * the catalog must not show the set on sale: no catalog row, or one that isn't
 * retired, has no LEGO.com status yet, and is next year's or has a release
 * date still ahead. A Coming soon row clears a retiring flag, so this stays strict.
 * Never overwrites a row from the LEGO.com coming-soon scrape.
 */
async function promoteUpcoming(env: Env, setNums: string[], now: Date): Promise<number> {
  if (!setNums.length) return 0;
  const catalog = await existingSets(env, setNums);
  const today = now.toISOString().slice(0, 10);
  let added = 0;
  for (let i = 0; i < setNums.length; i += 90) {
    const chunk = setNums.slice(i, i + 90);
    const { results } = await env.DB.prepare(
      `SELECT set_num, COUNT(DISTINCT domain) AS sources, SUM(domain = 'lego.com') AS official,
              MAX(name) AS name, AVG(price_usd) AS price, MAX(expected_date) AS release_date
       FROM set_news
       WHERE kind = 'upcoming' AND datetime(seen_at) >= datetime('now', '-120 days')
         AND set_num IN (${chunk.map(() => '?').join(',')})
       GROUP BY set_num`,
    ).bind(...chunk).all<{ set_num: string; sources: number; official: number; name: string | null; price: number | null; release_date: string | null }>();
    const stmts: D1PreparedStatement[] = [];
    for (const r of results ?? []) {
      if (!(Number(r.sources) >= 2 || Number(r.official) > 0)) continue;
      const cat = catalog.get(r.set_num);
      if (cat) {
        if (cat.retired || cat.lego_availability) continue;
        const future = (cat.year ?? 0) > now.getUTCFullYear() || (!!r.release_date && r.release_date > today);
        if (!future) continue;
      }
      const name = cat?.name || r.name;
      if (!name) continue;
      stmts.push(env.DB.prepare(
        `INSERT INTO upcoming_sets (set_num, name, price_usd, availability, scraped_at)
         VALUES (?1, ?2, ?3, NULL, NULL) ON CONFLICT(set_num) DO NOTHING`,
      ).bind(r.set_num, name, plausiblePrice(r.price)));
    }
    if (stmts.length) {
      const res = await env.DB.batch(stmts);
      added += res.reduce((sum, x) => sum + (x.meta.changes ?? 0), 0);
    }
  }
  return added;
}

export async function runExaNewsScan(env: Env, options: { now?: Date } = {}) {
  if (!exaConfigured(env)) return { skipped: 'EXA_API_KEY not set' };
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - 7 * DAY_MS).toISOString();

  const rows: NewsRow[] = [];
  let searches = 0;
  let searchErrors = 0;
  for (const query of NEWS_QUERIES) {
    const results = await exaSearch(env, {
      query, numResults: 8, includeDomains: LEGO_NEWS_DOMAINS, startPublishedDate: since,
      summary: { query: NEWS_PROMPT, schema: NEWS_SCHEMA },
    });
    if (!results) { searchErrors++; continue; }
    searches++;
    for (const r of results) rows.push(...newsRowsFromResult(r, now));
  }

  // Retiring reports only matter for sets the catalog knows.
  const catalog = await existingSets(env, [...new Set(rows.filter((r) => r.kind === 'retiring').map((r) => r.set_num))]);
  const kept = rows.filter((r) => r.kind === 'upcoming' || (catalog.has(r.set_num) && !catalog.get(r.set_num)!.retired));
  const stmts = kept.map((r) => upsertNews(env, r));
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));

  const retiring = [...new Set(kept.filter((r) => r.kind === 'retiring').map((r) => r.set_num))];
  const upcoming = [...new Set(kept.filter((r) => r.kind === 'upcoming').map((r) => r.set_num))];
  const rescored = await rescoreRetirementRisk(env, retiring);
  const upcomingAdded = await promoteUpcoming(env, upcoming, now);
  // Announced sets that never reached LEGO.com's own listing drop off after 150 days.
  const pruned = (await env.DB.prepare(
    `DELETE FROM upcoming_sets WHERE scraped_at IS NULL AND datetime(first_seen_at) < datetime('now', '-150 days')`,
  ).run()).meta.changes ?? 0;

  return { searches, search_errors: searchErrors, reports: kept.length, retiring: retiring.length, rescored, upcoming: upcoming.length, upcoming_added: upcomingAdded, pruned };
}

// ---------------------------------------------------------------------------
// Missing data: expected retirement dates
// ---------------------------------------------------------------------------

const LOOKUP_SCHEMA = {
  type: 'object',
  properties: {
    mentions_set: { type: 'boolean', description: 'The page is about or lists this exact LEGO set number' },
    retiring: { type: 'boolean', description: 'The page says this set is retiring / being discontinued' },
    retirement_date: { type: 'string', description: 'When it retires: YYYY-MM-DD, YYYY-MM or YYYY. Empty when not stated.' },
  },
};

/** A summary's yes/no answer: true, or the text "true"/"yes". */
const yes = (v: unknown): boolean => v === true || (typeof v === 'string' && /^(true|yes)$/i.test(v.trim()));

/** A set_news row from one lookup result, or null when the page doesn't report it retiring. */
export function lookupRowFromResult(setNum: string, r: ExaResult, now = new Date()): NewsRow | null {
  const s = r.summary as { mentions_set?: unknown; retiring?: unknown; retirement_date?: unknown } | null;
  const domain = hostOf(r.url);
  if (!s || !yes(s.mentions_set) || !yes(s.retiring) || !domain) return null;
  return {
    set_num: setNum, kind: 'retiring', url: r.url.slice(0, 500), domain,
    title: r.title?.slice(0, 200) ?? null, name: null, published_at: r.publishedDate,
    expected_date: normalizeNewsDate(s.retirement_date, 'retiring', now), price_usd: null,
  };
}

export async function runExaRetirementLookups(env: Env, options: { limit?: number; now?: Date } = {}) {
  if (!exaConfigured(env)) return { skipped: 'EXA_API_KEY not set' };
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(options.limit ?? 20, 30));
  const year = now.getUTCFullYear();
  // Active regular sets (4-5 digit numbers; polybags and magazine gifts have
  // no retirement news) with no retirement date, owned or wishlisted first,
  // then the ones LEGO already flags, then the oldest.
  const { results } = await env.DB.prepare(`
    SELECT ls.set_num, ls.name FROM lego_sets ls
    LEFT JOIN exa_lookups x ON x.set_num = ls.set_num
    WHERE ls.retired = 0 AND COALESCE(ls.exit_date, '') = ''
      AND ls.year BETWEEN ?1 AND ?2
      AND (ls.set_num GLOB '[0-9][0-9][0-9][0-9]-*' OR ls.set_num GLOB '[0-9][0-9][0-9][0-9][0-9]-*')
      AND COALESCE(ls.theme, '') NOT IN ('Gear', 'Books', 'Games')
      AND COALESCE(ls.lego_availability, '') NOT IN ('coming_soon', 'pre_order')
      AND NOT EXISTS (SELECT 1 FROM upcoming_sets up WHERE up.set_num = ls.set_num)
      AND (x.attempted_at IS NULL OR datetime(x.attempted_at) < datetime('now',
        CASE x.status WHEN 'error' THEN '-1 day' ELSE '-60 days' END))
    ORDER BY
      CASE WHEN EXISTS (SELECT 1 FROM user_collection uc WHERE uc.set_num = ls.set_num AND uc.deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM user_wishlist uw WHERE uw.set_num = ls.set_num) THEN 0 ELSE 1 END,
      COALESCE(ls.lego_retiring_soon, 0) DESC,
      ls.year ASC
    LIMIT ?3
  `).bind(year - 6, year, limit).all<{ set_num: string; name: string }>();

  const since = new Date(now.getTime() - 365 * DAY_MS).toISOString();
  const stmts: D1PreparedStatement[] = [];
  const found: string[] = [];
  let processed = 0;
  let searchErrors = 0;
  for (const { set_num, name } of results ?? []) {
    if ((await quotaRemaining(env, 'exa')) < 1) break;
    processed++;
    const num = set_num.replace(/-\d+$/, '');
    const hits = await exaSearch(env, {
      query: `LEGO ${num} ${name} retiring retirement date`,
      numResults: 3, includeDomains: LEGO_NEWS_DOMAINS, startPublishedDate: since,
      summary: {
        query: `Does this page say LEGO set ${num} "${name}" is retiring or being discontinued? If so, when?`,
        schema: LOOKUP_SCHEMA,
      },
    });
    let status = 'none';
    if (!hits) { status = 'error'; searchErrors++; }
    for (const r of hits ?? []) {
      const row = lookupRowFromResult(set_num, r, now);
      if (row) { stmts.push(upsertNews(env, row)); status = 'found'; }
    }
    if (status === 'found') found.push(set_num);
    stmts.push(env.DB.prepare(
      `INSERT INTO exa_lookups (set_num, attempted_at, status) VALUES (?1, datetime('now'), ?2)
       ON CONFLICT(set_num) DO UPDATE SET attempted_at = excluded.attempted_at, status = excluded.status`,
    ).bind(set_num, status));
  }
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  const rescored = await rescoreRetirementRisk(env, found);
  return { processed, found: found.length, search_errors: searchErrors, rescored };
}
