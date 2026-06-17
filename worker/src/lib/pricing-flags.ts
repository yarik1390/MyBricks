import type { Env } from '../types';

// Central kill-switches for pricing sources that currently lack provider
// access. They are OFF unless the matching env var is truthy, so production
// is disabled by default and re-enabling is a wrangler [vars] entry (or
// secret) — no code change or redeploy of source needed:
//   EBAY_SOLD_COMPS_ENABLED = "1"   (after eBay Marketplace Insights approval)
//   BRICKOWL_ENABLED        = "1"   (after a valid BRICKOWL_API_KEY is set)
// The basic-scope eBay Browse *ask* path is independent and always on.
function flagOn(value: unknown): boolean {
  return /^(1|true|yes|on)$/i.test(String(value ?? ''));
}

export function ebaySoldCompsEnabled(env: Env): boolean {
  return flagOn((env as Record<string, unknown>).EBAY_SOLD_COMPS_ENABLED);
}

export function brickOwlEnabled(env: Env): boolean {
  return flagOn((env as Record<string, unknown>).BRICKOWL_ENABLED);
}
