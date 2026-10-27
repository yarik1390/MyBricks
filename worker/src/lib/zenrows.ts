import type { Env } from '../types';
import { quotaRemaining, spendQuota } from './api-quota';
import { recordIntegrationAttempt } from './integration-health';
import { sourceEnabled } from './source-config';

// ZenRows Universal Scraper API (free plan, 5,000 credits/month; a plain
// request costs 1): raw-HTML lane after Decodo. Tested 2026-10-27: brickset.com,
// lego.com product pages and Walmart search all came back 200.

const ZENROWS_ENDPOINT = 'https://api.zenrows.com/v1/';

export function zenrowsConfigured(env: Env): boolean {
  return !!env.ZENROWS_API_KEY?.trim();
}

export async function zenrowsAvailable(env: Env): Promise<boolean> {
  return zenrowsConfigured(env) && (await sourceEnabled(env, 'zenrows'));
}

const hostOf = (url: string): string => {
  try { return new URL(url).host; } catch { return 'page'; }
};

/** Raw page HTML through ZenRows, or null (not configured, daily cap, or failure). */
export async function zenrowsScrape(url: string, env: Env, options: { timeoutMs?: number } = {}): Promise<string | null> {
  if (!(await zenrowsAvailable(env))) return null;
  if ((await quotaRemaining(env, 'zenrows')) < 1) {
    console.warn('[zenrows] daily cap reached');
    return null;
  }
  await spendQuota(env, 'zenrows', 1);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  let error: string;
  try {
    const query = new URLSearchParams({ apikey: env.ZENROWS_API_KEY!.trim(), url });
    const response = await fetch(`${ZENROWS_ENDPOINT}?${query}`, { signal: controller.signal });
    const text = await response.text();
    if (response.ok && text.trim()) {
      await recordIntegrationAttempt(env, 'zenrows', true).catch(() => undefined);
      return text;
    }
    // ZenRows answers JSON {code, title, detail} on failure; never echo the key.
    let reason = '';
    try {
      const body = JSON.parse(text) as { code?: string; title?: string };
      reason = [body.code, body.title].filter(Boolean).join(' ');
    } catch { reason = text.replace(/\s+/g, ' ').slice(0, 120); }
    error = response.status === 422 || /RESP001|blocked|target/i.test(reason)
      ? `target page failed: ${hostOf(url)} HTTP ${response.status}${reason ? ` (${reason})` : ''}`
      : `HTTP ${response.status}${reason ? ` (${reason})` : ''} on ${hostOf(url)}`;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    clearTimeout(timeout);
  }
  await recordIntegrationAttempt(env, 'zenrows', false, error).catch(() => undefined);
  return null;
}
