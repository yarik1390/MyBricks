#!/usr/bin/env node
// Renders the BricksVault "Vault Dial" app icon (yellow tile, dark vault dial,
// stud hub) and its gold Pro variant into every PWA, Android and Play Store
// size. The artwork is defined below as SVG, so this file is the master.
//
//   node scripts/render-vault-icons.mjs
//
// Needs the repo's @playwright/test dev dependency with a Chromium build
// (set PLAYWRIGHT_CHROMIUM to a binary path to use a specific one).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const RES = join(ROOT, 'android/app/src/main/res');

const DENSITY_PX = { ldpi: 36, mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const ADAPTIVE_PX = { ldpi: 81, mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

const PALETTES = {
  classic: { a0: '#ffe672', a1: '#ffd23a', a2: '#f2bb12', ink: '#21241c' },
  gold: { a0: '#fff1b8', a1: '#e9c35a', a2: '#b88220', ink: '#16120a' },
};
const DARK = '#191c16';

const defs = (p) => `<defs>
  <linearGradient id="acc" x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="${p.a0}"/><stop offset=".55" stop-color="${p.a1}"/><stop offset="1" stop-color="${p.a2}"/></linearGradient>
  <radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${p.a1}" stop-opacity=".45"/><stop offset="1" stop-color="${p.a1}" stop-opacity="0"/></radialGradient>
  <filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity=".45"/></filter>
</defs>`;

function ticks(n, r1, r2) {
  let out = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI - Math.PI / 2;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    out += `<line x1="${(256 + c * r1).toFixed(1)}" y1="${(256 + s * r1).toFixed(1)}" x2="${(256 + c * r2).toFixed(1)}" y2="${(256 + s * r2).toFixed(1)}" stroke="url(#acc)" stroke-width="12" stroke-linecap="round"/>`;
  }
  return out;
}

// The dark vault door with its yellow stud hub, on a 512 canvas.
const dial = (p, scale = 1) => `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
  <g filter="url(#sh)"><circle cx="256" cy="256" r="158" fill="${p.ink}"/></g>
  ${ticks(8, 118, 138)}
  <circle cx="256" cy="256" r="98" fill="none" stroke="url(#acc)" stroke-width="6" stroke-opacity=".35"/>
  <circle cx="256" cy="256" r="60" fill="url(#acc)"/>
  <circle cx="256" cy="256" r="60" fill="none" stroke="#000" stroke-opacity=".12" stroke-width="4"/>
  <ellipse cx="240" cy="236" rx="18" ry="10" fill="#fff" opacity=".35"/>
</g>`;

const svg = (p, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${defs(p)}${body}</svg>`;

const ART = {
  // Full-bleed square: PWA, Apple, Play Store.
  tile: (p, scale = 1) => svg(p, `<rect width="512" height="512" fill="url(#acc)"/>${dial(p, scale)}`),
  // Circle-cropped tile for legacy Android launchers (transparent corners).
  round: (p) => svg(p, `<clipPath id="c"><circle cx="256" cy="256" r="256"/></clipPath><g clip-path="url(#c)"><rect width="512" height="512" fill="url(#acc)"/>${dial(p, 0.92)}</g>`),
  // Adaptive icon layers: the launcher shows the middle 72 of 108dp.
  background: (p) => svg(p, `<rect width="512" height="512" fill="url(#acc)"/>`),
  foreground: (p) => svg(p, dial(p, 72 / 108)),
  // Open Graph card and splash: the rounded tile floating on dark.
  glow: (p, tile = 0.62) => svg(p, `<rect width="512" height="512" fill="${DARK}"/><circle cx="256" cy="256" r="230" fill="url(#glow)"/>
    <g transform="translate(256 256) scale(${tile}) translate(-256 -256)"><g filter="url(#sh)"><rect width="512" height="512" rx="112" fill="url(#acc)"/></g>${dial(p)}</g>`),
};

function png(width, height, rgba, alpha) {
  const channels = alpha ? 4 : 3;
  const raw = Buffer.alloc((width * channels + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * channels + 1);
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) raw[row + 1 + x * channels + c] = rgba[(y * width + x) * 4 + c];
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = alpha ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const page = await browser.newPage();

async function render(markup, size, path, { alpha = false } = {}) {
  const pixels = await page.evaluate(async ({ markup, size }) => {
    const img = new Image();
    img.src = `data:image/svg+xml;base64,${btoa(markup)}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, size, size);
    return Array.from(ctx.getImageData(0, 0, size, size).data);
  }, { markup, size });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png(size, size, Uint8Array.from(pixels), alpha));
}

for (const [variant, p] of Object.entries(PALETTES)) {
  const suffix = variant === 'gold' ? '_gold' : '';
  writeFileSync(join(ROOT, `assets/brand/icon-vault${variant === 'gold' ? '-gold' : ''}.svg`), `${ART.tile(p)}\n`);
  for (const [density, size] of Object.entries(DENSITY_PX)) {
    await render(ART.round(p), size, join(RES, `mipmap-${density}/ic_launcher${suffix}.png`), { alpha: true });
    await render(ART.round(p), size, join(RES, `mipmap-${density}/ic_launcher${suffix}_round.png`), { alpha: true });
  }
  for (const [density, size] of Object.entries(ADAPTIVE_PX)) {
    await render(ART.background(p), size, join(RES, `mipmap-${density}/ic_launcher${suffix}_background.png`));
    await render(ART.foreground(p), size, join(RES, `mipmap-${density}/ic_launcher${suffix}_foreground.png`), { alpha: true });
  }
}

const classic = PALETTES.classic;
writeFileSync(join(PUBLIC, 'icon.svg'), `${ART.tile(classic)}\n`);
await render(ART.tile(classic), 192, join(PUBLIC, 'icon-192.png'));
await render(ART.tile(classic), 512, join(PUBLIC, 'icon-512.png'));
await render(ART.tile(classic, 0.82), 512, join(PUBLIC, 'icon-maskable-512.png'));
await render(ART.tile(classic), 180, join(PUBLIC, 'apple-touch-icon.png'));
await render(ART.glow(classic), 512, join(PUBLIC, 'icon-glow-512.png'));
await render(ART.glow(classic, 0.3), 2732, join(RES, 'drawable/splash.png'));
await render(ART.tile(classic), 512, join(ROOT, 'store/play/icon-512.png'), { alpha: true });
await render(ART.tile(classic), 512, join(ROOT, 'expo-preview/assets/icon-512.png'));
await render(ART.tile(classic, 0.82), 512, join(ROOT, 'expo-preview/assets/icon-maskable-512.png'));
await render(svg(classic, `<rect width="512" height="512" fill="#16161C"/><g transform="translate(256 256) scale(0.84) translate(-256 -256)">${ART.round(classic).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</g>`), 1024, join(ROOT, 'android/app/src/main/icon-round-preview.png'));

await browser.close();
console.log('Rendered BricksVault Vault Dial icon package');
