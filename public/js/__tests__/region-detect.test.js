import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normCountry, regionOfTag, pickCountry, defaultsForCountry, detectRegion } from '../lib/region-detect.js';

const androidWindow = (plugin, language = 'en-US') => ({
  navigator: { language },
  Capacitor: { isNativePlatform: () => true, Plugins: plugin ? { PhoneRegion: plugin } : {} },
});

describe('region detection for first-launch defaults', () => {
  it('normalises country codes', () => {
    assert.equal(normCountry('fr'), 'FR');
    assert.equal(normCountry('uk'), 'GB');
    assert.equal(normCountry('XX'), '');
    assert.equal(normCountry('T1'), '');
    assert.equal(normCountry(''), '');
    assert.equal(normCountry('FRA'), '');
  });

  it('reads the region of a language tag', () => {
    assert.equal(regionOfTag('en-GB'), 'GB');
    assert.equal(regionOfTag('fr'), 'FR');
    assert.equal(regionOfTag('nl_NL'), 'NL');
    assert.equal(regionOfTag(''), '');
  });

  it('web prefers the visitor country over the browser language', () => {
    assert.deepEqual(pickCountry({ locale: 'en-US', ip: 'FR' }), { country: 'FR', source: 'ip' });
    assert.deepEqual(pickCountry({ locale: 'en-GB', ip: '' }), { country: 'GB', source: 'locale' });
  });

  it('Android prefers the SIM country, then the phone region, then the visitor country', () => {
    assert.deepEqual(pickCountry({ native: true, sim: 'de', locale: 'en-US', ip: 'FR' }), { country: 'DE', source: 'sim' });
    assert.deepEqual(pickCountry({ native: true, sim: '', locale: 'en-AU', ip: 'FR' }), { country: 'AU', source: 'locale' });
    assert.deepEqual(pickCountry({ native: true, sim: '', locale: '', ip: 'CA' }), { country: 'CA', source: 'ip' });
  });

  it('maps a country to currency and shop, keeping defaults outside the list', () => {
    assert.deepEqual(defaultsForCountry('FR'), { country: 'FR', currency: 'EUR', market: 'FR' });
    assert.deepEqual(defaultsForCountry('GB'), { country: 'GB', currency: 'GBP', market: 'GB' });
    assert.deepEqual(defaultsForCountry('BE'), { country: 'BE', currency: 'EUR', market: null });
    assert.deepEqual(defaultsForCountry('UA'), { country: 'UA', currency: null, market: null });
    assert.deepEqual(defaultsForCountry(''), { country: '', currency: null, market: null });
  });

  it('asks the server only when the phone does not settle it', async () => {
    let asked = 0;
    const ip = async () => { asked += 1; return 'FR'; };
    const withSim = await detectRegion({ win: androidWindow({ getCountry: async () => ({ sim: 'nl', network: '' }) }), ipCountry: ip });
    assert.equal(withSim.market, 'NL');
    assert.equal(withSim.source, 'sim');
    assert.equal(asked, 0);
    const web = await detectRegion({ win: { navigator: { language: 'en-US' } }, ipCountry: ip });
    assert.deepEqual([web.market, web.currency, web.source], ['FR', 'EUR', 'ip']);
    assert.equal(asked, 1);
  });

  it('survives a failing native plugin and a failing server', async () => {
    const r = await detectRegion({ win: androidWindow({ getCountry: async () => { throw new Error('no telephony'); } }, 'en-CA'), ipCountry: async () => { throw new Error('offline'); } });
    assert.deepEqual([r.market, r.currency, r.source], ['CA', 'CAD', 'locale']);
    const none = await detectRegion({ win: { navigator: { language: '' } }, ipCountry: async () => { throw new Error('offline'); } });
    assert.deepEqual([none.market, none.currency], [null, null]);
  });
});
