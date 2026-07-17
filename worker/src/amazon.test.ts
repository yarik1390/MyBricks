import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  amazonLinkEnabled,
  amazonMarket,
  amazonPartnerTag,
  amazonReadiness,
  buildAmazonSpecialLink,
  getFreshAmazonOffer,
} from './lib/amazon';
import { creatorsTokenEndpoint, fetchAmazonCreatorsOffer } from './lib/amazon-creators';
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

describe('Amazon Creators API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  const creatorsEnv = {
    AMAZON_CREATORS_PUBLIC_KEY: 'cred-id',
    AMAZON_CREATORS_PRIVATE_KEY: 'cred-secret',
    // No CACHE_KV → the token is minted per call in these tests (fine for mocks).
  } as any;

  it('routes token minting to the credential region for the marketplace', () => {
    expect(creatorsTokenEndpoint('US')).toBe('https://api.amazon.com/auth/o2/token');
    expect(creatorsTokenEndpoint('FR')).toBe('https://api.amazon.co.uk/auth/o2/token');
    expect(creatorsTokenEndpoint('DE')).toBe('https://api.amazon.co.uk/auth/o2/token');
    expect(creatorsTokenEndpoint('AU')).toBe('https://api.amazon.co.jp/auth/o2/token');
  });

  it('extracts an identity-matched offer and skips wrong-item results', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/auth/o2/token')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({
        searchResult: {
          items: [
            // Wrong item first (a minifig lot without the set number) — must be skipped.
            { asin: 'B0WRONG', itemInfo: { title: { displayValue: 'LEGO Harry Potter minifigure lot' } }, offersV2: { listings: [{ price: { money: { amount: 25, currencyCode: 'EUR' } } }] } },
            // Identity match with the PA-API-style money shape.
            { asin: 'B0RIGHT', detailPageURL: 'https://www.amazon.fr/dp/B0RIGHT', itemInfo: { title: { displayValue: 'LEGO Harry Potter 71043 Hogwarts Castle' } }, offersV2: { listings: [{ price: { money: { amount: 399.9, currencyCode: 'EUR' } }, availability: { type: 'IN_STOCK' } }] } },
          ],
        },
      }), { status: 200 });
    });

    const offer = await fetchAmazonCreatorsOffer(creatorsEnv, { set_num: '71043-1', name: 'Hogwarts Castle' }, 'FR');
    expect(offer?.asin).toBe('B0RIGHT');
    expect(offer?.price).toBe(399.9);
    expect(offer?.currency).toBe('EUR');
    // The product call carries the marketplace header, not a per-locale host.
    const search = calls.find(c => c.url.includes('/catalog/v1/searchItems'));
    expect(search).toBeTruthy();
    expect((search!.init.headers as Record<string, string>)['x-marketplace']).toBe('www.amazon.fr');
  });

  it('returns null (never throws) on provider failure', async () => {
    vi.stubGlobal('fetch', async () => new Response('denied', { status: 403 }));
    const offer = await fetchAmazonCreatorsOffer(creatorsEnv, { set_num: '10300-1' }, 'US');
    expect(offer).toBeNull();
  });

  it('returns null when no result matches the set number', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes('/auth/o2/token')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ searchResult: { items: [
        { asin: 'B0OTHER', itemInfo: { title: { displayValue: 'LEGO 10299 something else' } }, offersV2: { listings: [{ price: { amount: 99, currency: 'USD' } }] } },
      ] } }), { status: 200 });
    });
    const offer = await fetchAmazonCreatorsOffer(creatorsEnv, { set_num: '10300-1' }, 'US');
    expect(offer).toBeNull();
  });
});
