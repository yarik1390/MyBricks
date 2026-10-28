import type { Env } from '../types';
import { decodoAvailable, decodoFetch } from './decodo';
import { zenrowsAvailable, zenrowsFetch } from './zenrows';

// Free-plan raw-HTML lanes tried after Bright Data: Decodo, then ZenRows.
// Each returns page HTML for the same deterministic parsers, or null.

export async function backupScrapersAvailable(env: Env): Promise<boolean> {
  return (await decodoAvailable(env)) || (await zenrowsAvailable(env));
}

export async function backupScrape(url: string, env: Env, options: { timeoutMs?: number } = {}): Promise<string | null> {
  return (await backupFetch(url, env, options)).html;
}

/**
 * Decodo, then ZenRows. `missing` means the site answered 404/410: retired
 * LEGO.com products do this, so the next lane (and Firecrawl) is skipped
 * instead of paying again for the same missing page.
 */
export async function backupFetch(url: string, env: Env, options: { timeoutMs?: number } = {}): Promise<{ html: string | null; missing: boolean }> {
  const first = await decodoFetch(url, env, options);
  if (first.html || first.missing) return first;
  return zenrowsFetch(url, env, options);
}
