import type { Env } from '../types';
import { spendQuotaFailClosed } from './api-quota';
import { recordIntegrationAttempt } from './integration-health';
import {
  configuredScrapingAntKeys,
  markScrapingAntExhausted,
  pickScrapingAntKey,
  reserveScrapingAntUnit,
} from './scrapingant-keys';

const SCRAPINGANT_ENDPOINT = 'https://api.scrapingant.com/v2/general';
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 30_000;

export interface ScrapingAntFetchOptions {
  timeoutMs?: number;
}

export function scrapingAntEnabled(env: Env): boolean {
  return configuredScrapingAntKeys(env).length > 0;
}

function boundedTimeout(value?: number): number {
  if (!Number.isFinite(value) || Number(value) <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.floor(Number(value)), 250), MAX_TIMEOUT_MS);
}

/**
 * Fetch raw HTML through ScrapingAnt's cheapest plain-page contract.
 *
 * Each outbound request is claim-first in both ledgers: the existing daily
 * fail-closed quota and the per-key monthly safety cap. A 401/429 exhausts the
 * selected key for the current UTC month and retries another configured key.
 */
export async function scrapingAntFetchHtml(
  targetUrl: string,
  env: Env,
  options: ScrapingAntFetchOptions = {},
): Promise<string | null> {
  if (!scrapingAntEnabled(env)) return null;
  const maxAttempts = configuredScrapingAntKeys(env).length;
  let lastError = 'no live ScrapingAnt key (monthly budget drained)';

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const picked = await pickScrapingAntKey(env).catch(() => null);
    if (!picked) {
      lastError = 'ScrapingAnt key ledger unavailable or monthly budget drained';
      break;
    }

    // Keep the established daily accounting intact. It remains fail-closed, and
    // is claimed before the monthly unit so a daily rejection cannot drain a key.
    if (!(await spendQuotaFailClosed(env, 'scrapingant', 1))) {
      lastError = 'ScrapingAnt daily cap reached or quota ledger unavailable';
      break;
    }

    let reserved = false;
    try {
      reserved = await reserveScrapingAntUnit(env, picked);
    } catch {
      lastError = 'ScrapingAnt key ledger unavailable — failing closed';
      break;
    }
    if (!reserved) continue;

    const endpoint = new URL(SCRAPINGANT_ENDPOINT);
    endpoint.searchParams.set('url', targetUrl);
    endpoint.searchParams.set('x-api-key', picked.key);
    endpoint.searchParams.set('browser', 'false');
    endpoint.searchParams.set('proxy_type', 'datacenter');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), boundedTimeout(options.timeoutMs));
    try {
      const response = await fetch(endpoint.toString(), {
        method: 'GET',
        headers: { Accept: 'text/html' },
        signal: controller.signal,
      });
      const exhausted = response.status === 401 || response.status === 429;
      if (exhausted) {
        await markScrapingAntExhausted(env, picked).catch(() => undefined);
        lastError = `HTTP ${response.status} (key exhausted)`;
        continue;
      }
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        break;
      }

      // Plain validated requests cost one credit. Preserve the established daily
      // accounting for larger provider-reported costs without exposing headers.
      const reportedCost = Number.parseInt(response.headers.get('ant-credits-cost') || '1', 10);
      if (Number.isFinite(reportedCost) && reportedCost > 1) {
        await spendQuotaFailClosed(env, 'scrapingant', reportedCost - 1);
      }

      const html = await response.text();
      if (!html.trim()) {
        lastError = 'empty body';
        break;
      }
      await recordIntegrationAttempt(env, 'scrapingant', true).catch(() => undefined);
      return html;
    } catch {
      // Never propagate provider/network exception text: request URLs contain the
      // API key, and some runtimes include that URL in thrown error messages.
      lastError = 'network error';
      break;
    } finally {
      clearTimeout(timer);
    }
  }

  console.warn(`[scrapingant] ${lastError}`);
  await recordIntegrationAttempt(env, 'scrapingant', false, lastError).catch(() => undefined);
  return null;
}
