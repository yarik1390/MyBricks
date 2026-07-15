import type { Env } from '../types';

export type AmazonMarket = 'FR' | 'US' | 'GB' | 'DE' | 'CA' | 'AU';

const HOSTS: Record<AmazonMarket, string> = {
  FR: 'www.amazon.fr',
  US: 'www.amazon.com',
  GB: 'www.amazon.co.uk',
  DE: 'www.amazon.de',
  CA: 'www.amazon.ca',
  AU: 'www.amazon.com.au',
};

const truthy = (value: unknown): boolean => /^(1|true|yes|on)$/i.test(String(value || ''));

export function amazonMarket(value: unknown, env: Env): AmazonMarket {
  const requested = String(value || env.AMAZON_DEFAULT_MARKET || 'FR').toUpperCase();
  return Object.prototype.hasOwnProperty.call(HOSTS, requested) ? requested as AmazonMarket : 'FR';
}

export function amazonPartnerTag(env: Env, market: AmazonMarket, platform: 'web' | 'android'): string | null {
  if (market !== 'FR') return null;
  return platform === 'android'
    ? env.AMAZON_PARTNER_TAG_FR_ANDROID || null
    : env.AMAZON_PARTNER_TAG_FR_WEB || null;
}

export function amazonLinkEnabled(env: Env, platform: 'web' | 'android'): boolean {
  return platform === 'android' ? truthy(env.AMAZON_ANDROID_ENABLED) : truthy(env.AMAZON_WEB_ENABLED);
}

export function buildAmazonSpecialLink(
  setNum: string,
  setName: string,
  market: AmazonMarket,
  tag: string,
): string {
  const params = new URLSearchParams({
    k: `LEGO ${setNum} ${setName}`.trim(),
    tag,
  });
  return `https://${HOSTS[market]}/s?${params.toString()}`;
}

export interface AmazonCachedOffer {
  asin: string;
  price: number;
  currency: string;
  availability?: string | null;
  url: string;
  fetched_at: string;
}

export async function getFreshAmazonOffer(
  env: Env,
  setNum: string,
  market: AmazonMarket,
): Promise<AmazonCachedOffer | null> {
  if (!truthy(env.AMAZON_CREATORS_ENABLED) || !env.CACHE_KV) return null;
  const credentialsReady = !!(env.AMAZON_CREATORS_PUBLIC_KEY && env.AMAZON_CREATORS_PRIVATE_KEY);
  if (!credentialsReady) return null;
  const offer = await env.CACHE_KV.get<AmazonCachedOffer>(`amazon:offer:${market}:${setNum}`, 'json').catch(() => null);
  if (!offer || !offer.fetched_at || Date.now() - Date.parse(offer.fetched_at) >= 23 * 3_600_000) return null;
  return offer;
}

export function amazonReadiness(env: Env) {
  const webTag = !!env.AMAZON_PARTNER_TAG_FR_WEB;
  const androidTag = !!env.AMAZON_PARTNER_TAG_FR_ANDROID;
  const creatorsCredentials = !!(env.AMAZON_CREATORS_PUBLIC_KEY && env.AMAZON_CREATORS_PRIVATE_KEY);
  return {
    web_links_ready: webTag && amazonLinkEnabled(env, 'web'),
    android_links_ready: androidTag && amazonLinkEnabled(env, 'android'),
    mobile_approved: amazonLinkEnabled(env, 'android'),
    creators_credentials_ready: creatorsCredentials,
    creators_enabled: truthy(env.AMAZON_CREATORS_ENABLED) && creatorsCredentials,
    state: !webTag ? 'needs_partner_tag'
      : !amazonLinkEnabled(env, 'web') ? 'links_disabled'
        : !creatorsCredentials ? 'link_only'
          : !truthy(env.AMAZON_CREATORS_ENABLED) ? 'api_ineligible_or_disabled'
            : 'creators_ready',
  };
}

export const AMAZON_ASSOCIATE_DISCLOSURE = 'As an Amazon Associate, Brickvault earns from qualifying purchases.';
export const AMAZON_PRICE_DISCLAIMER = 'Price and availability are accurate as of the time shown and are subject to change. Any price and availability displayed on Amazon at the time of purchase will apply.';
