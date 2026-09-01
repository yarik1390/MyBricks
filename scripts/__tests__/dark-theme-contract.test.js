import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const appStyles = read('public/app.css');
const kidsStyles = read('public/skin-kids.css');
const serviceWorker = read('public/sw.js');

function luminance(hex) {
  const channels = hex.match(/[\da-f]{2}/gi).map(channel => Number.parseInt(channel, 16) / 255);
  const [r, g, b] = channels.map(channel =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function token(block, name) {
  return block.match(new RegExp(`${name}:\\s*(#[\\da-f]{6})`, 'i'))?.[1];
}

describe('dark theme contracts', () => {
  it('keeps the intentionally light Kids skin isolated from global dark variables', () => {
    assert.match(
      appStyles,
      /:root\[data-theme="dark"\]:not\(\[data-skin="kids"\]\)\s*\{/,
      'the base dark palette must not override the Kids light tokens',
    );
    assert.match(
      appStyles,
      /:root\[data-theme="dark"\]:not\(\[data-skin\]\)\s*\{/,
      'the warm retro dark palette must only target the default skin',
    );
    assert.doesNotMatch(
      appStyles,
      /:root\[data-theme="dark"\]\s*\{/,
      'no unscoped base dark :root block may leak onto the Kids skin',
    );
    assert.match(kidsStyles, /:root\[data-skin="kids"\]\s*\{[\s\S]*--bg:\s*#FFF7E6/);
    assert.match(kidsStyles, /:root\[data-skin="kids"\]\s*\{[\s\S]*color-scheme:\s*light/);
  });

  it('gives Kids semantic pills and red CTAs readable foregrounds', () => {
    const kids = kidsStyles.match(/:root\[data-skin="kids"\]\s*\{([\s\S]*?)\n\}/)?.[1] || '';
    assert.ok(contrast(token(kids, '--up-text'), token(kids, '--up-pale')) >= 4.5);
    assert.ok(contrast(token(kids, '--down-text'), token(kids, '--down-pale')) >= 4.5);
    assert.ok(contrast(token(kids, '--red-fg'), token(kids, '--bv-red')) >= 4.5);
    assert.match(appStyles, /\.delta\.up\s*\{[^}]*color:\s*var\(--up-text,\s*var\(--up\)\)/);
    assert.match(appStyles, /\.btn-primary\s*\{[\s\S]*?background:\s*var\(--bv-red\);\s*color:\s*var\(--red-fg,\s*#fff\)/);
  });

  it('uses an explicit foreground token on yellow brand surfaces', () => {
    assert.match(appStyles, /\.avatar\s*\{[\s\S]*?color:\s*var\(--yellow-fg,\s*var\(--line\)\)/);
    assert.match(appStyles, /\.install-card\s*\{[\s\S]*?color:\s*var\(--yellow-fg,\s*var\(--line\)\)/);
  });

  it('bumps the static cache for the theme asset change', () => {
    assert.match(serviceWorker, /const VERSION = "v475";/);
  });
});
