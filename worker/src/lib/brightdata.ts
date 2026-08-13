import type { Env } from '../types';
import { recordIntegrationAttempt } from './integration-health';
import { quotaRemaining, spendQuota } from './api-quota';
import {
  brightDataEnabled,
  configuredBrightDataTokens,
  isBrightDataExhaustion,
  markBrightDataExhausted,
  pickBrightDataToken,
  reserveBrightDataUnit,
} from './brightdata-keys';

const BRIGHTDATA_ENDPOINT = 'https://api.brightdata.com/request';
const DEFAULT_ZONE = 'web_unlocker1';

export interface BrightDataUnlockOptions {
  timeoutMs?: number;
  country?: string;
  method?: string;
}

/**
 * Fetch arbitrary raw HTML through Bright Data Web Unlocker.
 *
 * Credit accounting is CLAIM-FIRST: one unit is atomically reserved on a token
 * before the outbound call (a provider failure still consumes the unit, same
 * as a success). Reservation is FAIL-CLOSED — if the monthly ledger cannot be
 * updated or every token is at cap, we return null and let the caller fall
 * back to Firecrawl rather than spend unaccounted credits.
 */
export async function brightDataUnlock(
  url: string,
  env: Env,
  options: BrightDataUnlockOptions = {},
): Promise<string | null> {
  if (!brightDataEnabled(env)) return null;
  const maxAttempts = configuredBrightDataTokens(env).length;
  let lastError = 'no live Bright Data token (monthly budget drained)';

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const picked = await pickBrightDataToken(env).catch(() => null);
    if (!picked) break;

    // Daily source cap check FIRST (read-only): when the day is spent we stop
    // BEFORE touching the monthly ledger — a daily-cap rejection must never
    // consume a monthly reservation (that would drain the pool with no
    // outbound requests on an exhausted day).
    const remaining = await quotaRemaining(env, 'brightdata');
    if (remaining < 1) {
      lastError = 'Bright Data daily cap reached';
      break;
    }

    // Atomic monthly claim BEFORE the request. A ledger outage must not turn
    // into unbounded spend, so any reservation failure is fail-closed.
    let claimed = false;
    try {
      claimed = await reserveBrightDataUnit(env, picked);
    } catch {
      lastError = 'Bright Data ledger unavailable — failing closed';
      break;
    }
    if (!claimed) continue; // token at cap/exhausted: next token

    // Meter the daily ledger (fail-open like every other source; the monthly
    // claim above is the hard ceiling). A false here is only possible in a
    // concurrent race at the day boundary — bounded to a single phantom unit.
    await spendQuota(env, 'brightdata', 1);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
    try {
      const response = await fetch(BRIGHTDATA_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${picked.key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          zone: env.BRIGHTDATA_ZONE || DEFAULT_ZONE,
          url,
          format: 'raw',
          method: options.method || 'GET',
          country: options.country || 'us',
        }),
        signal: controller.signal,
      });
      const body = await response.text();
      const exhausted = isBrightDataExhaustion(response.status, body);
      if (exhausted) await markBrightDataExhausted(env, picked).catch(() => undefined);
      if (response.ok && body.trim()) {
        await recordIntegrationAttempt(env, 'brightdata', true).catch(() => undefined);
        return body;
      }
      lastError = `HTTP ${response.status}${exhausted ? ' (token exhausted)' : ''}`;
      if (!exhausted) break;
    } catch (error) {
      // Network/timeout errors consume the reserved credit but do not prove the
      // key is dead — stop (a retry next run is cheaper than burning the pool).
      lastError = error instanceof Error ? error.message : String(error);
      break;
    } finally {
      clearTimeout(timeout);
    }
  }

  await recordIntegrationAttempt(env, 'brightdata', false, lastError).catch(() => undefined);
  console.warn('[brightdata] unlock failed:', lastError);
  return null;
}
