import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const renderer = readFileSync(new URL('../render-vault-icons.mjs', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../../public/manifest.json', import.meta.url), 'utf8'));
const serviceWorker = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
const launcher = readFileSync(new URL('../../android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml', import.meta.url), 'utf8');
const roundLauncher = readFileSync(new URL('../../android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../android/app/src/main/res/values/styles.xml', import.meta.url), 'utf8');

function pngInfo(path) {
  const data = readFileSync(new URL(path, import.meta.url));
  assert.equal(data.toString('ascii', 1, 4), 'PNG');
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    bitDepth: data[24],
    colorType: data[25],
  };
}

const densityPx = { ldpi: 36, mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const adaptivePx = { ldpi: 81, mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

describe('Vault Dial icon package', () => {
  it('keeps the classic and gold Vault Dial masters reproducible from one renderer', () => {
    for (const name of ['icon-vault.svg', 'icon-vault-gold.svg']) {
      const master = readFileSync(new URL(`../../assets/brand/${name}`, import.meta.url), 'utf8');
      assert.match(master, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 512 512"/);
    }
    assert.match(readFileSync(new URL('../../public/icon.svg', import.meta.url), 'utf8'), /viewBox="0 0 512 512"/);
    assert.match(renderer, /classic: \{/);
    assert.match(renderer, /gold: \{/);
    assert.match(renderer, /store\/play\/icon-512\.png/);
    assert.deepEqual(pngInfo('../../store/play/icon-512.png'), { width: 512, height: 512, bitDepth: 8, colorType: 6 });
  });

  it('ships the generated PWA, Apple, Open Graph, and Android splash outputs', () => {
    assert.deepEqual(pngInfo('../../public/icon-192.png'), { width: 192, height: 192, bitDepth: 8, colorType: 2 });
    assert.deepEqual(pngInfo('../../public/icon-512.png'), { width: 512, height: 512, bitDepth: 8, colorType: 2 });
    assert.deepEqual(pngInfo('../../public/icon-maskable-512.png'), { width: 512, height: 512, bitDepth: 8, colorType: 2 });
    assert.deepEqual(pngInfo('../../public/apple-touch-icon.png'), { width: 180, height: 180, bitDepth: 8, colorType: 2 });
    assert.deepEqual(pngInfo('../../public/icon-glow-512.png'), { width: 512, height: 512, bitDepth: 8, colorType: 2 });
    assert.deepEqual(pngInfo('../../android/app/src/main/res/drawable/splash.png'), { width: 2732, height: 2732, bitDepth: 8, colorType: 2 });
  });

  it('wires the primary artwork through PWA and Android launch surfaces', () => {
    assert.deepEqual(manifest.icons.map(({ src, purpose }) => [src, purpose]), [
      ['/icon-192.png', 'any'],
      ['/icon-512.png', 'any'],
      ['/icon-maskable-512.png', 'maskable'],
    ]);
    assert.match(serviceWorker, /const VERSION = "v\d+";/);
    assert.match(serviceWorker, /icon: '\/icon-192\.png'/);
    assert.match(serviceWorker, /badge: '\/icon-192\.png'/);
    for (const asset of ['/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png', '/icon-glow-512.png']) {
      assert.match(serviceWorker, new RegExp(`'${asset.replaceAll('/', '\\/')}'`));
    }
    assert.match(launcher, /@mipmap\/ic_launcher_background/);
    assert.match(launcher, /@mipmap\/ic_launcher_foreground/);
    assert.match(roundLauncher, /@mipmap\/ic_launcher_background/);
    assert.match(roundLauncher, /@mipmap\/ic_launcher_foreground/);
    assert.match(styles, /windowSplashScreenAnimatedIcon">@mipmap\/ic_launcher/);
    assert.doesNotMatch(styles, /android:windowBackground">@drawable\/splash/);
  });

  it('renders complete launcher density sets with Android-compatible modes', () => {
    for (const prefix of ['ic_launcher', 'ic_launcher_gold']) {
      for (const [density, size] of Object.entries(densityPx)) {
        const regular = pngInfo(`../../android/app/src/main/res/mipmap-${density}/${prefix}.png`);
        const round = pngInfo(`../../android/app/src/main/res/mipmap-${density}/${prefix}_round.png`);
        assert.deepEqual(regular, { width: size, height: size, bitDepth: 8, colorType: 6 });
        assert.deepEqual(round, { width: size, height: size, bitDepth: 8, colorType: 6 });
      }
      for (const [density, size] of Object.entries(adaptivePx)) {
        assert.deepEqual(pngInfo(`../../android/app/src/main/res/mipmap-${density}/${prefix}_background.png`), { width: size, height: size, bitDepth: 8, colorType: 2 });
        assert.deepEqual(pngInfo(`../../android/app/src/main/res/mipmap-${density}/${prefix}_foreground.png`), { width: size, height: size, bitDepth: 8, colorType: 6 });
      }
    }
  });
});
