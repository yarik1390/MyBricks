import { describe, it, expect } from 'vitest';
import { affiliatePublicConfig, parseTemplates, validTemplate } from './lib/affiliate-links';

describe('affiliate link config', () => {
  it('is null until an id is set and a platform is on', () => {
    expect(affiliatePublicConfig({})).toBeNull();
    expect(affiliatePublicConfig({ EPN_CAMPAIGN_ID: '', AFFILIATE_LINK_TEMPLATES: '{}', AFFILIATE_WEB_ENABLED: '1' })).toBeNull();
    expect(affiliatePublicConfig({ EPN_CAMPAIGN_ID: '5339000000', AFFILIATE_WEB_ENABLED: '0', AFFILIATE_ANDROID_ENABLED: '0' })).toBeNull();
  });

  it('exposes a valid eBay campaign id and the platform switches', () => {
    expect(affiliatePublicConfig({ EPN_CAMPAIGN_ID: ' 5339000000 ', AFFILIATE_WEB_ENABLED: '1' })).toEqual({
      web: true, android: false, ebay_campid: '5339000000', templates: {},
    });
    expect(affiliatePublicConfig({ EPN_CAMPAIGN_ID: 'abc', AFFILIATE_WEB_ENABLED: '1' })).toBeNull();
  });

  it('keeps only https templates with {url} for known stores', () => {
    expect(validTemplate('https://click.linksynergy.com/deeplink?id=1&mid=2&murl={url}')).toBe(true);
    expect(validTemplate('http://x.example/?u={url}')).toBe(false);
    expect(validTemplate('https://x.example/')).toBe(false);
    expect(parseTemplates(JSON.stringify({
      lego: 'https://click.linksynergy.com/deeplink?id=1&mid=2&murl={url}',
      'LEGO:fr': 'https://www.awin1.com/cread.php?awinmid=1&awinaffid=2&ued={url}',
      walmart: 'javascript:alert(1)//{url}',
      unknown: 'https://x.example/?u={url}',
    }))).toEqual({
      lego: 'https://click.linksynergy.com/deeplink?id=1&mid=2&murl={url}',
      'lego:FR': 'https://www.awin1.com/cread.php?awinmid=1&awinaffid=2&ued={url}',
    });
    expect(parseTemplates('not json')).toEqual({});
  });
});
