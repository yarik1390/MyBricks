import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseOcrSetNumbers, collectOcrCandidates } from '../lib/scan-ocr.js';
import { nativeOcrSupported, recognizeTextNative } from '../lib/native-ocr.js';

describe('scan OCR candidate parsing', () => {
  it('extracts printed LEGO set numbers', () => {
    assert.deepEqual(parseOcrSetNumbers('75313-1'), ['75313-1']);
    assert.deepEqual(parseOcrSetNumbers('Set 75313 Star Wars'), ['75313']);
    assert.deepEqual(parseOcrSetNumbers('75313 - 1'), ['75313-1']);
    assert.deepEqual(parseOcrSetNumbers('375-1'), ['375-1']);
  });

  it('skips years, piece counts, ages and prices', () => {
    assert.deepEqual(parseOcrSetNumbers('Released in 2017'), []);
    assert.deepEqual(parseOcrSetNumbers('2,316 pieces / Set 75313'), ['75313']);
    assert.deepEqual(parseOcrSetNumbers('2316 pcs'), []);
    assert.deepEqual(parseOcrSetNumbers('Ages 9+'), []);
    assert.deepEqual(parseOcrSetNumbers('$49.99'), []);
  });

  it('accepts raw OCR line arrays and numeric values', () => {
    assert.deepEqual(parseOcrSetNumbers(['ITEM 75313', '8+', '2316 pcs']), ['75313']);
    assert.deepEqual(parseOcrSetNumbers(75313), ['75313']);
    assert.deepEqual(parseOcrSetNumbers(null), []);
  });
});

describe('scan OCR collection', () => {
  it('uses ML Kit text when the native plugin is present', async () => {
    const win = {
      Capacitor: {
        isNativePlatform: () => true,
        registerPlugin: (name) => name === 'TextOcr'
          ? {
              async isSupported() { return { supported: true }; },
              async recognize() {
                return { texts: ['LEGO 75313-1 Star Wars'], fullText: 'LEGO 75313-1 Star Wars' };
              },
            }
          : null,
      },
    };
    assert.equal(await nativeOcrSupported(win), true);
    assert.deepEqual(await collectOcrCandidates('data:image/jpeg;base64,QQ==', win), ['75313-1']);
  });

  it('uses TextDetector on web when the platform API exists', async () => {
    const previousFetch = globalThis.fetch;
    const previousCreate = globalThis.createImageBitmap;
    globalThis.fetch = async () => ({ blob: async () => new Blob() });
    globalThis.createImageBitmap = async () => ({ close() {} });
    try {
      const win = {
        TextDetector: class {
          async detect() {
            return [{ rawValue: 'Set 75192-1' }];
          }
        },
      };
      assert.deepEqual(await collectOcrCandidates('data:image/jpeg;base64,QQ==', win), ['75192-1']);
    } finally {
      globalThis.fetch = previousFetch;
      globalThis.createImageBitmap = previousCreate;
    }
  });

  it('returns no candidates when web OCR is unavailable', async () => {
    const win = {};
    assert.equal(await nativeOcrSupported(win), false);
    assert.deepEqual(await recognizeTextNative('data:image/jpeg;base64,QQ==', win), []);
    assert.deepEqual(await collectOcrCandidates('data:image/jpeg;base64,QQ==', win), []);
  });
});
