// Affiliate links for the store links the app already shows (Compare stores,
// LEGO.com deals). Amazon has its own integration (lib/amazon.ts); this covers
// every other store.
//
// Affiliate IDs are public by design (every tracked link carries them), so they
// live in wrangler.toml [vars], like the Amazon tag. Nothing is tagged until
// an ID is set, and each platform has its own switch because most networks
// approve websites and apps separately (the Android switch stays off until the
// network approves the app).
//
//   EPN_CAMPAIGN_ID              eBay Partner Network campaign id (10 digits).
//                                One id works on every eBay country site.
//   AFFILIATE_LINK_TEMPLATES     JSON: store key -> deep-link template, where
//                                {url} is the store page, URL-encoded. A key can
//                                be a store ("walmart") or a store for one
//                                country ("lego:FR"); the country key wins.
//                                Examples (ids come from each network):
//                                  Rakuten  https://click.linksynergy.com/deeplink?id=SID&mid=MID&murl={url}
//                                  Awin     https://www.awin1.com/cread.php?awinmid=MID&awinaffid=AFFID&ued={url}
//                                  Impact   https://goto.walmart.com/c/ID/AD/PROGRAM?u={url}
//   AFFILIATE_WEB_ENABLED        "1" tags links on the website.
//   AFFILIATE_ANDROID_ENABLED    "1" tags links in the Android app.

import type { Env } from '../types';

export const AFFILIATE_STORES = ['lego', 'ebay', 'walmart', 'target', 'bricklink', 'brickowl'] as const;

export interface AffiliatePublicConfig {
  web: boolean;
  android: boolean;
  ebay_campid: string | null;
  templates: Record<string, string>;
}

const KEY_RE = /^(lego|ebay|walmart|target|bricklink|brickowl)(:[A-Z]{2})?$/;

/** A template is usable when it is an https link that carries {url}. */
export function validTemplate(template: unknown): template is string {
  if (typeof template !== 'string' || !template.includes('{url}')) return false;
  try {
    const u = new URL(template.replace('{url}', 'x'));
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function parseTemplates(raw: string | undefined | null): Record<string, string> {
  if (!raw || !raw.trim()) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return {}; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const k = key.trim().toLowerCase().replace(/:([a-z]{2})$/, (_, cc: string) => `:${cc.toUpperCase()}`);
    if (KEY_RE.test(k) && validTemplate(value)) out[k] = value;
  }
  return out;
}

/** What /api/config hands the app, or null when no affiliate link is set up. */
export function affiliatePublicConfig(env: Partial<Env>): AffiliatePublicConfig | null {
  const campid = String(env.EPN_CAMPAIGN_ID || '').trim();
  const ebay_campid = /^\d{6,12}$/.test(campid) ? campid : null;
  const templates = parseTemplates(env.AFFILIATE_LINK_TEMPLATES);
  if (!ebay_campid && !Object.keys(templates).length) return null;
  const web = env.AFFILIATE_WEB_ENABLED === '1';
  const android = env.AFFILIATE_ANDROID_ENABLED === '1';
  if (!web && !android) return null;
  return { web, android, ebay_campid, templates };
}
