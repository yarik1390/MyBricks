import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPreviewBot, cleanHandle, cleanSetNum, profileOg, setOg, ogHtml, handleShareLink } from '../../../worker/og/og-page.js';

describe('share link previews', () => {
  it('tells preview bots from people', () => {
    assert.equal(isPreviewBot('facebookexternalhit/1.1'), true);
    assert.equal(isPreviewBot('Mozilla/5.0 (compatible; Discordbot/2.0)'), true);
    assert.equal(isPreviewBot('WhatsApp/2.23'), true);
    assert.equal(isPreviewBot('Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36'), false);
  });
  it('accepts only handle and set-number shapes', () => {
    assert.equal(cleanHandle('@phantom'), 'phantom');
    assert.equal(cleanHandle('<script>'), '');
    assert.equal(cleanSetNum('10182'), '10182-1');
    assert.equal(cleanSetNum('10182-1'), '10182-1');
    assert.equal(cleanSetNum('../x'), '');
  });
  it('describes a public profile and hides value unless exposed', () => {
    const p = { handle: 'phantom', is_public: true, display_name: 'phantom', set_count: 8, piece_count: 18295, total_value: 8899.35, expose_public_value: true, top_themes: [{ theme: 'Modular Buildings' }, { theme: 'Other' }], showcase: [] };
    const og = profileOg('phantom', p);
    assert.equal(og.title, "@phantom's LEGO vault");
    assert.match(og.description, /8 sets · 18,295 pieces · worth \$8,899\. Top themes: Modular Buildings$/);
    assert.doesNotMatch(profileOg('phantom', { ...p, expose_public_value: false }).description, /worth/);
    assert.equal(profileOg('ghost', null).title, '@ghost on BricksVault');
  });
  it('describes a set and escapes the HTML', () => {
    const og = setOg('10182-1', { name: 'Cafe <Corner>', theme: 'Modular Buildings', year: 2007, pieces: 2058, retired: true, blended_value: 3133.07, image_url: 'https://cdn.example/x.jpg' });
    assert.equal(og.description, '10182-1 · Modular Buildings · 2007 · 2,058 pieces · Retired. Market value about $3,133.');
    const html = ogHtml(og, '#/set/10182-1');
    assert.match(html, /og:title" content="Cafe &lt;Corner&gt; \(10182-1\)"/);
    assert.match(html, /summary_large_image/);
  });
  it('redirects people and serves bots the preview', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ set: { name: 'Cafe Corner', blended_value: 3133 } }), { status: 200 });
    try {
      const ctx = (ua) => ({ request: new Request('https://bricksvault.app/s/10182-1', { headers: { 'user-agent': ua } }), params: { id: '10182-1' }, env: {} });
      const person = await handleShareLink('s', ctx('Mozilla/5.0 Chrome/130'));
      assert.equal(person.status, 302);
      assert.equal(person.headers.get('location'), 'https://bricksvault.app/#/set/10182-1');
      const bot = await handleShareLink('s', ctx('Slackbot-LinkExpanding 1.0'));
      assert.equal(bot.status, 200);
      assert.match(await bot.text(), /Cafe Corner \(10182-1\)/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
