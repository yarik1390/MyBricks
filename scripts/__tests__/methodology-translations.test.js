import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const english = read('public/methodology.html').match(/<main id="methodologyContent">([\s\S]*?)<\/main>/)[1];
const count = (html, tag) => (html.match(new RegExp(`<${tag}[ >]`, 'g')) || []).length;
const LOCALES = ['de', 'es', 'fr', 'hi', 'ja', 'nl', 'uk', 'zh'];

describe('translated How we price', () => {
  for (const locale of LOCALES) {
    it(`${locale} keeps the English structure (numbered sections, tables, badges, links)`, () => {
      const html = read(`public/methodology/${locale}.html`);
      for (const tag of ['h1', 'h2', 'li', 'tr', 'table', 'footer']) assert.equal(count(html, tag), count(english, tag), `${locale} <${tag}>`);
      for (const cls of ['tier high', 'tier med', 'tier low', 'callout', 'updated', 'muted']) assert.ok(html.includes(`class="${cls}"`), `${locale} .${cls}`);
      for (const href of ['/data-partners.html', '/privacy.html', '/terms.html']) assert.ok(html.includes(`href="${href}"`), `${locale} ${href}`);
      assert.doesNotMatch(html, /<script|<html|<main/);
    });
  }

  it('the sheet loads the fragment for the current language', () => {
    const component = read('public/js/components/methodology.js');
    assert.match(component, /\/methodology\/\$\{locale\}\.html/);
    assert.match(component, /getLocale\(\)/);
  });
});
