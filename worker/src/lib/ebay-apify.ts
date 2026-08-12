import type { Env } from '../types';
import { fetchWithRetry } from './http';
import { isValidLegoSetSaleTitle, summarizeSoldPrices } from './ebay';
import type { EbaySoldScrapeResult } from './ebay-firecrawl';

const APIFY_BASE = 'https://api.apify.com/v2';
const ACTOR_ID = 'memo23~ebay-search-scraper-ppe';
const MAX_ITEMS_PER_SET = 5;
const POLL_INTERVAL_MS = 1_000;
const MAX_POLLS = 300;
const START_FETCH_OPTIONS = { retries: 0, backoffMs: 500, timeoutMs: 40_000 } as const;
const FETCH_OPTIONS = { retries: 4, backoffMs: 500, timeoutMs: 40_000 } as const;

interface ApifyRunData {
  id?: string;
  status?: string;
  statusMessage?: string;
  defaultDatasetId?: string;
}

interface ApifyListingRow {
  type?: string;
  title?: string;
  priceValue?: number | string;
  currency?: string;
  sold?: boolean;
  soldDate?: string;
  /** sold-price-summary rows only: plain keyword for the search chain. */
  query?: string;
  /** sold-price-summary rows only: number of listings that chain produced. */
  count?: number;
}

const emptyResult = (
  status: EbaySoldScrapeResult['status'],
  error?: string,
): EbaySoldScrapeResult => ({
  status,
  new_value: null,
  new_count: 0,
  used_value: null,
  used_count: 0,
  ...(error ? { error } : {}),
});

function resultsFor(
  setNums: string[],
  status: EbaySoldScrapeResult['status'],
  error?: string,
): Record<string, EbaySoldScrapeResult> {
  return Object.fromEntries(setNums.map((setNum) => [setNum, emptyResult(status, error)]));
}

function baseSetNum(setNum: string): string {
  return String(setNum || '').replace(/-\d+$/, '');
}

function soldSearchUrl(setNum: string): string {
  const query = `LEGO ${baseSetNum(setNum)}`.trim().replace(/\s+/g, '+');
  return `https://www.ebay.com/sch/i.html?_nkw=${query}&LH_ItemCondition=1000`;
}

function normalizeSoldDate(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const trimmed = raw.trim();
  const iso = trimmed.slice(0, 10);
  const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? Date.parse(iso) : Date.parse(trimmed);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  if (date.getUTCFullYear() < 2000 || timestamp > Date.now() + 86_400_000) return null;
  return date.toISOString().slice(0, 10);
}

async function responseJson<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${label} HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ''}`);
  }
  return response.json() as Promise<T>;
}

async function pollRun(runId: string, headers: HeadersInit): Promise<ApifyRunData> {
  for (let poll = 0; poll < MAX_POLLS; poll++) {
    const response = await fetchWithRetry(
      `${APIFY_BASE}/actor-runs/${encodeURIComponent(runId)}`,
      { headers },
      FETCH_OPTIONS,
    );
    const body = await responseJson<{ data?: ApifyRunData }>(response, 'Apify run poll');
    const run = body.data || {};
    const status = String(run.status || '').toUpperCase();
    if (status === 'SUCCEEDED' || ['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) return run;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return { id: runId, status: 'TIMED-OUT', statusMessage: 'Apify run polling timed out' };
}

/**
 * Fetch a migration-free, corroborating batch of new-condition eBay sold comps.
 * One Apify actor run carries one condition-filtered eBay search chain per set.
 */
export async function fetchEbaySoldViaApifyBatch(
  setNums: string[],
  env: Env,
): Promise<Record<string, EbaySoldScrapeResult>> {
  const uniqueSetNums = [...new Set(setNums.map(String).filter(Boolean))];
  if (!uniqueSetNums.length) return {};
  if (!env.APIFY_API_TOKEN) return resultsFor(uniqueSetNums, 'disabled');

  const headers = {
    Authorization: `Bearer ${env.APIFY_API_TOKEN}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  try {
    const startResponse = await fetchWithRetry(
      `${APIFY_BASE}/acts/${ACTOR_ID}/runs`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          mode: 'sold',
          marketplace: 'ebay.com',
          detailedItems: false,
          maxItems: MAX_ITEMS_PER_SET,
          startUrls: uniqueSetNums.map((setNum) => ({ url: soldSearchUrl(setNum) })),
        }),
      },
      START_FETCH_OPTIONS,
    );
    const startBody = await responseJson<{ data?: ApifyRunData }>(startResponse, 'Apify actor start');
    const runId = startBody.data?.id;
    if (!runId) throw new Error('Apify actor start returned no run id');

    const run = await pollRun(runId, headers);
    const status = String(run.status || '').toUpperCase();
    if (status !== 'SUCCEEDED') {
      return resultsFor(
        uniqueSetNums,
        'error',
        `Apify actor run ${status || 'UNKNOWN'}${run.statusMessage ? `: ${run.statusMessage}` : ''}`,
      );
    }

    const datasetId = run.defaultDatasetId || startBody.data?.defaultDatasetId;
    if (!datasetId) return resultsFor(uniqueSetNums, 'error', 'Apify actor run returned no dataset id');
    const datasetResponse = await fetchWithRetry(
      `${APIFY_BASE}/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json`,
      { headers },
      FETCH_OPTIONS,
    );
    const rows = await responseJson<ApifyListingRow[]>(datasetResponse, 'Apify dataset fetch');

    // memo23 emits ALL listing rows first (one search chain at a time, in
    // completion order), then ALL sold-price-summary rows at the end — one per
    // chain, in the same completion order, each carrying the plain keyword
    // (e.g. "LEGO 75313 AT-AT") and the number of listings that chain produced
    // (`count`). Chains can complete out of input order (parallel requests), so
    // we bind listings to sets via each summary's `count`, consuming the
    // listing buffer in order — never by input order or by URL matching.
    // Preserve every non-summary row until after count-based slicing. Filtering
    // rows first would shift later chain boundaries whenever a row is malformed,
    // non-USD, or explicitly not sold, because the summary count describes the
    // actor's raw output rows rather than our accepted subset.
    const listingRows: ApifyListingRow[] = [];
    const summaries: Array<{ setNum: string; count: number }> = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row?.type === 'sold-price-summary' && typeof row.query === 'string') {
        const setNum = matchSetFromQuery(row.query, uniqueSetNums);
        if (setNum) summaries.push({ setNum, count: Number(row.count) || 0 });
        continue;
      }
      listingRows.push(row);
    }

    const chainSet = new Map(uniqueSetNums.map((setNum) => [setNum, [] as Array<{ price: number; soldDate: string | null }>]));
    let listingIndex = 0;
    for (const summary of summaries) {
      const count = Math.min(Math.max(summary.count, 0), listingRows.length - listingIndex);
      for (let i = 0; i < count; i++) {
        const listing = listingRows[listingIndex + i];
        if (typeof listing?.title !== 'string') continue;
        if (listing.sold === false || String(listing.currency || 'USD').toUpperCase() !== 'USD') continue;
        const price = Number(listing.priceValue);
        if (!Number.isFinite(price) || price <= 0) continue;
        if (isValidLegoSetSaleTitle(listing.title, summary.setNum)) {
          chainSet.get(summary.setNum)?.push({ price, soldDate: normalizeSoldDate(listing.soldDate) });
        }
      }
      listingIndex += count;
    }

    const output: Record<string, EbaySoldScrapeResult> = {};
    for (const setNum of uniqueSetNums) {
      const setMatches = chainSet.get(setNum) || [];
      const summary = summarizeSoldPrices(setMatches.map((match) => match.price));
      const dates = setMatches.map((match) => match.soldDate).filter((date): date is string => !!date);
      if (summary.value == null) {
        output[setNum] = {
          ...emptyResult('no_data'),
          new_count: summary.sample_count,
          new_last_sold: dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null,
        };
      } else {
        output[setNum] = {
          status: 'ok',
          new_value: summary.value,
          new_count: summary.sample_count,
          new_last_sold: dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null,
          used_value: null,
          used_count: 0,
          used_last_sold: null,
        };
      }
    }
    return output;
  } catch (error) {
    return resultsFor(uniqueSetNums, 'error', (error as Error)?.message || 'Apify request failed');
  }
}

/** Extract the set number from a memo23 sold-price-summary `query` field.
 *  Real queries are plain keywords (e.g. "LEGO 75313 AT-AT"); tolerate
 *  _nkw= URLs too, in case the actor changes format.
 *  Match by EXACT 4-6 digit token (never all-digits-joined): a title like
 *  "LEGO 75379 R2-D2" must not be read as 7537922. */
function matchSetFromQuery(query: string, candidates: string[]): string | null {
  const nkwMatch = /[?&]_nkw=([^&]+)/.exec(query);
  const decoded = nkwMatch ? decodeURIComponent(nkwMatch[1]).replace(/\+/g, ' ') : query;
  const bases = candidates.map((setNum) => baseSetNum(setNum));
  const tokens = decoded.split(/[^0-9]+/).filter((t) => /^\d{4,6}$/.test(t));
  for (const token of tokens) {
    const idx = bases.indexOf(token);
    if (idx >= 0) return candidates[idx];
  }
  return null;
}
