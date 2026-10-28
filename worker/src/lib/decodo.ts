import type { Env } from '../types';
import { quotaRemaining, spendQuota } from './api-quota';
import { recordIntegrationAttempt } from './integration-health';
import { sourceEnabled } from './source-config';

// Decodo Web Scraping API (free plan, ~$5/month of requests): a third raw-HTML
// lane after Bright Data. Returns the page HTML so the same deterministic
// parsers (Brickset dt/dd, LEGO.com JSON-LD, store product JSON) read it.
// Tested 2026-10-27: brickset.com, lego.com product pages and Walmart search
// all came back 200 and parsed.

const DECODO_ENDPOINT = 'https://data.decodo.com/v1/scrape';

export function decodoConfigured(env: Env): boolean {
  return !!env.DECODO_AUTH_TOKEN?.trim();
}

export async function decodoAvailable(env: Env): Promise<boolean> {
  return decodoConfigured(env) && (await sourceEnabled(env, 'decodo'));
}

const hostOf = (url: string): string => {
  try { return new URL(url).host; } catch { return 'page'; }
};

/** Raw page HTML through Decodo, or null (not configured, daily cap, or failure). */
export async function decodoScrape(url: string, env: Env, options: { timeoutMs?: number } = {}): Promise<string | null> {
  return (await decodoFetch(url, env, options)).html;
}

/**
 * Like decodoScrape, but also says when the site itself has no such page
 * (404/410). Then Decodo did its job, and no other lane will find the page either.
 */
export async function decodoFetch(url: string, env: Env, options: { timeoutMs?: number } = {}): Promise<{ html: string | null; missing: boolean }> {
  const none = { html: null, missing: false };
  if (!(await decodoAvailable(env))) return none;
  if ((await quotaRemaining(env, 'decodo')) < 1) {
    console.warn('[decodo] daily cap reached');
    return none;
  }
  await spendQuota(env, 'decodo', 1);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  let error: string;
  try {
    const response = await fetch(DECODO_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.DECODO_AUTH_TOKEN!.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ target: 'universal', url }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (response.ok) {
      const result = (JSON.parse(text) as { results?: Array<{ content?: unknown; status_code?: number }> }).results?.[0];
      const content = typeof result?.content === 'string' ? result.content : '';
      if (content.trim() && (result?.status_code ?? 200) < 400) {
        await recordIntegrationAttempt(env, 'decodo', true).catch(() => undefined);
        return { html: content, missing: false };
      }
      if (result?.status_code === 404 || result?.status_code === 410) {
        await recordIntegrationAttempt(env, 'decodo', true).catch(() => undefined);
        return { html: null, missing: true };
      }
      // Decodo answered but the site did not serve the page: one target failing.
      error = `target page failed: ${hostOf(url)} HTTP ${result?.status_code ?? 'empty'}`;
    } else {
      const reason = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
      error = `HTTP ${response.status}${reason ? ` (${reason})` : ''} on ${hostOf(url)}`;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    clearTimeout(timeout);
  }
  await recordIntegrationAttempt(env, 'decodo', false, error).catch(() => undefined);
  return none;
}
