import { describe, expect, it } from 'vitest';
import {
  amazonLinkEnabled,
  amazonMarket,
  amazonPartnerTag,
  amazonReadiness,
  buildAmazonSpecialLink,
  getFreshAmazonOffer,
} from './lib/amazon';
import { legacySignalsFor } from './lib/valuation-v3';

describe('Amazon affiliate policy boundary', () => {
  const env = {
    AMAZON_DEFAULT_MARKET: 'FR',
    AMAZON_PARTNER_TAG_FR_WEB: 'brickvault-web-21',
    AMAZON_PARTNER_TAG_FR_ANDROID: 'brickvault-app-21',
    AMAZON_WEB_ENABLED: '1',
    AMAZON_ANDROID_ENABLED: '0',
  } as any;

  it('uses the correct locale and separate platform tracking IDs', () => {
    expect(amazonMarket('FR', env)).toBe('FR');
    expect(amazonPartnerTag(env, 'FR', 'web')).toBe('brickvault-web-21');
    expect(amazonPartnerTag(env, 'FR', 'android')).toBe('brickvault-app-21');
    expect(buildAmazonSpecialLink('10300-1', 'Time Machine', 'FR', 'brickvault-web-21'))
      .toMatch(/^https:\/\/www\.amazon\.fr\/s\?.*tag=brickvault-web-21/);
  });

  it('keeps Android disabled until mobile approval', () => {
    expect(amazonLinkEnabled(env, 'web')).toBe(true);
    expect(amazonLinkEnabled(env, 'android')).toBe(false);
    expect(amazonReadiness(env).mobile_approved).toBe(false);
  });

  it('hides stale Creators API offers at the 23-hour boundary', async () => {
    const old = new Date(Date.now() - 23 * 3_600_000).toISOString();
    const fresh = new Date(Date.now() - 22 * 3_600_000).toISOString();
    const cache = new Map<string, any>([
      ['amazon:offer:FR:OLD-1', { asin: 'OLD', price: 10, currency: 'EUR', url: 'https://amazon.fr', fetched_at: old }],
      ['amazon:offer:FR:NEW-1', { asin: 'NEW', price: 20, currency: 'EUR', url: 'https://amazon.fr', fetched_at: fresh }],
    ]);
    const withKv = {
      ...env,
      AMAZON_CREATORS_ENABLED: '1',
      AMAZON_CREATORS_PUBLIC_KEY: 'public',
      AMAZON_CREATORS_PRIVATE_KEY: 'private',
      CACHE_KV: { get: async (key: string) => cache.get(key) || null },
    } as any;
    expect(await getFreshAmazonOffer(withKv, 'OLD-1', 'FR')).toBeNull();
    expect((await getFreshAmazonOffer(withKv, 'NEW-1', 'FR'))?.asin).toBe('NEW');
  });

  it('never converts Amazon data into a resale pricing signal', () => {
    const signals = legacySignalsFor({
      valuation_method: 'formula_bulk', current_value: 100,
      amazon_price: 70, amazon_availability: 'in_stock',
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].source).toBe('formula');
  });
});
