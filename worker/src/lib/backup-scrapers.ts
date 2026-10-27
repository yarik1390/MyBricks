import type { Env } from '../types';
import { decodoAvailable, decodoScrape } from './decodo';
import { zenrowsAvailable, zenrowsScrape } from './zenrows';

// Free-plan raw-HTML lanes tried after Bright Data: Decodo, then ZenRows.
// Each returns page HTML for the same deterministic parsers, or null.

export async function backupScrapersAvailable(env: Env): Promise<boolean> {
  return (await decodoAvailable(env)) || (await zenrowsAvailable(env));
}

export async function backupScrape(url: string, env: Env, options: { timeoutMs?: number } = {}): Promise<string | null> {
  return (await decodoScrape(url, env, options)) ?? zenrowsScrape(url, env, options);
}
