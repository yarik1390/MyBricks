import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, it } from 'node:test';

const me = readFileSync(new URL('../../public/js/views/me.js', import.meta.url), 'utf8');
const legal = readFileSync(new URL('../../public/js/components/legal-sheet.js', import.meta.url), 'utf8');
const sheet = readFileSync(new URL('../../public/js/components/sheet.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../public/app.css', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
const deploy = readFileSync(new URL('../../.github/workflows/deploy-worker.yml', import.meta.url), 'utf8');
const roundAdaptive = readFileSync(new URL('../../android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml', import.meta.url), 'utf8');
const roundForeground = readFileSync(new URL('../../android/app/src/main/res/drawable/ic_launcher_round_foreground.xml', import.meta.url), 'utf8');
const roundMonochrome = readFileSync(new URL('../../android/app/src/main/res/drawable/ic_launcher_round_monochrome.xml', import.meta.url), 'utf8');
const roundRenderer = readFileSync(new URL('../render-round-icon.py', import.meta.url), 'utf8');

const densityPx = { ldpi: 36, mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
function pngSize(path) {
  const data = readFileSync(new URL(path, import.meta.url));
  assert.equal(data.toString('ascii', 1, 4), 'PNG');
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

function pngAlpha(path) {
  const data = readFileSync(new URL(path, import.meta.url));
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  assert.equal(data[24], 8, 'round icons must use 8-bit PNG channels');
  assert.equal(data[25], 6, 'round icons must be RGBA PNGs');
  const chunks = [];
  for (let offset = 8; offset < data.length;) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') chunks.push(data.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const rows = [];
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const source = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? row[x - 4] : 0;
      const up = previous[x];
      const upLeft = x >= 4 ? previous[x - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else assert.equal(filter, 0, `unsupported PNG filter ${filter}`);
      row[x] = (source[x] + predictor) & 0xff;
    }
    rows.push(row);
    previous = row;
  }
  return { alphaAt: (x, y) => rows[y][x * 4 + 3] };
}

describe('Android push, legal sheets, and launcher icon', () => {
  it('keeps Firebase Admin credentials intact through the manual Worker-secret upload path', () => {
    assert.doesNotMatch(deploy, /\[ -n "\$\{\{ secrets\.FIREBASE_SERVICE_ACCOUNT_JSON \}\}" \]/);
    assert.match(deploy, /FIREBASE_SERVICE_ACCOUNT_JSON: \$\{\{ secrets\.FIREBASE_SERVICE_ACCOUNT_JSON \}\}/);
    assert.match(deploy, /if \[ -n "\$FIREBASE_SERVICE_ACCOUNT_JSON" \]; then/);
    assert.match(deploy, /put FIREBASE_SERVICE_ACCOUNT_JSON "\$FIREBASE_SERVICE_ACCOUNT_JSON"/);
  });

  it('opens Privacy and Terms in the app bottom sheet instead of navigating away', () => {
    assert.match(me, /data-legal-sheet="privacy"/);
    assert.match(me, /data-legal-sheet="terms"/);
    assert.doesNotMatch(me, /href="\/privacy\.html"/);
    assert.doesNotMatch(me, /href="\/terms\.html"/);
    assert.match(me, /openLegalSheet\(link\.dataset\.legalSheet\)/);
    assert.match(legal, /showSheet\(/);
    assert.match(legal, /class="legal-sheet-scroll"/);
    assert.match(legal, /setAttribute\('aria-labelledby', titleId\)/);
    assert.match(legal, /tabindex="-1"/);
    assert.match(legal, /Privacy Policy/);
    assert.match(legal, /Terms of Service/);
    assert.match(legal, /fetch\(doc\.url/);
    assert.match(legal, /new DOMParser\(\)/);
    assert.match(legal, /querySelector\('\.wrap'\)/);
    assert.doesNotMatch(legal, /Open full policy in a browser/);
    assert.match(sheet, /sheet\.removeAttribute\("aria-labelledby"\)/);
    assert.match(styles, /\.legal-sheet-link[\s\S]*?min-height:\s*44px/);
    assert.match(sw, /const VERSION = "v473"/);
    assert.match(sw, /'\/js\/components\/legal-sheet\.js'/);
  });

  it('uses the user-approved robot artwork for legacy, adaptive, and themed round icons', () => {
    assert.ok(readFileSync(new URL('../../android/app/src/main/icon-round-approved.jpg', import.meta.url)).length > 60_000);
    assert.deepEqual(pngSize('../../android/app/src/main/icon-round-preview.png'), [1024, 1024]);
    assert.match(roundRenderer, /icon-round-approved\.jpg/);
    assert.match(roundRenderer, /preserve its artwork without redesigning it/);
    assert.match(roundAdaptive, /@drawable\/ic_launcher_round_foreground/);
    assert.match(roundAdaptive, /@drawable\/ic_launcher_round_monochrome/);
    assert.match(roundAdaptive, /@color\/ic_launcher_background/);
    assert.match(roundForeground, /android:fillColor="#FED700"/);
    assert.match(roundForeground, /android:fillColor="#1C1C1E"/);
    assert.match(roundForeground, /M54,2\.1A51\.9,51\.9/);
    assert.match(roundForeground, /M27,17\.5h54a9,9/);
    assert.match(roundForeground, /M32\.5,44\.5A9\.45,9\.45/);
    assert.doesNotMatch(roundForeground, /L82,34V54/);
    assert.match(roundMonochrome, /android:fillColor="#000000"/);
    assert.match(roundMonochrome, /M27,17\.5h54a9,9/);
    assert.match(roundMonochrome, /M32\.5,44\.5A9\.45,9\.45/);
    for (const [density, size] of Object.entries(densityPx)) {
      const path = `../../android/app/src/main/res/mipmap-${density}/ic_launcher_round.png`;
      assert.deepEqual(pngSize(path), [size, size]);
      const { alphaAt } = pngAlpha(path);
      assert.equal(alphaAt(0, 0), 0, `${density} round icon corners must be transparent`);
      assert.ok(
        alphaAt(Math.floor(size / 2), Math.floor(size / 2)) > 0,
        `${density} round icon center must be opaque`,
      );
    }
  });
});
