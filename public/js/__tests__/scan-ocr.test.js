import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseOcrSetNumbers, collectOcrCandidates } from '../lib/scan-ocr.js';
import { nativeOcrSupported, recognizeTextNative } from '../lib/native-ocr.js';

describe('scan OCR candidate parsing', () => {
  it('extracts only explicit printed LEGO set-number labels', () => {
    assert.deepEqual(parseOcrSetNumbers('LEGO Set 75313-1 Star Wars'), ['75313-1']);
    assert.deepEqual(parseOcrSetNumbers('Set number: 75313'), ['75313']);
    assert.deepEqual(parseOcrSetNumbers('SET NO. 375 - 1'), ['375-1']);
  });

  it('does not turn years, piece counts, prices, barcodes, or unlabeled numbers into candidates', () => {
    assert.deepEqual(parseOcrSetNumbers('Released in 2017'), []);
    assert.deepEqual(parseOcrSetNumbers('2,316 pieces'), []);
    assert.deepEqual(parseOcrSetNumbers('LEGO 75313 Star Wars'), []);
    assert.deepEqual(parseOcrSetNumbers('UPC 673419376785'), []);
    assert.deepEqual(parseOcrSetNumbers('$49.99'), []);
  });

  it('bounds, normalizes, and deduplicates candidates', () => {
    assert.deepEqual(
      parseOcrSetNumbers(['Set 75313 – 1', 'Set number 75313-1', 'Set 375-1']),
      ['75313-1', '375-1'],
    );
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
                return { texts: ['LEGO SET 75313-1 Star Wars'], fullText: 'LEGO SET 75313-1 Star Wars' };
              },
            }
          : null,
      },
    };
    assert.equal(await nativeOcrSupported(win), true);
    assert.deepEqual(await recognizeTextNative('data:image/jpeg;base64,AA==', win), ['LEGO SET 75313-1 Star Wars']);
    assert.deepEqual(await collectOcrCandidates('data:image/jpeg;base64,AA==', win), ['75313-1']);
  });

  it('falls through cleanly when OCR is unavailable or fails', async () => {
    const noPlugin = { Capacitor: { isNativePlatform: () => true, registerPlugin: () => null } };
    assert.equal(await nativeOcrSupported(noPlugin), false);
    assert.deepEqual(await collectOcrCandidates('data:image/jpeg;base64,AA==', noPlugin), []);

    const failingPlugin = {
      Capacitor: {
        isNativePlatform: () => true,
        registerPlugin: () => ({
          async isSupported() { return { supported: true }; },
          async recognize() { throw new Error('recognizer unavailable'); },
        }),
      },
    };
    assert.deepEqual(await collectOcrCandidates('data:image/jpeg;base64,AA==', failingPlugin), []);
  });
});
