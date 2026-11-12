import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidGtin, acceptScannedBarcode, barcodeCandidates } from '../lib/pure.js';
import { indexSeed, barcodeFromSeed } from '../lib/seed-catalog-core.js';
import { ocrContextLines } from '../lib/scan-ocr.js';

describe('barcode check digits', () => {
  it('accepts real LEGO EAN-13 / UPC-A codes', () => {
    assert.equal(isValidGtin('5702017153209'), true);
    assert.equal(isValidGtin('673419356190'), true);
    assert.equal(isValidGtin('00673419356190'), true);
  });
  it('rejects a one-digit misread, all zeros and wrong lengths', () => {
    assert.equal(isValidGtin('5702017153200'), false);
    assert.equal(isValidGtin('0000000000000'), false);
    assert.equal(isValidGtin('57020171532'), false);
    assert.equal(isValidGtin(''), false);
  });
  it('only lets a live read through when a retail code checks out', () => {
    assert.equal(acceptScannedBarcode('5702017153209'), true);
    assert.equal(acceptScannedBarcode('5702017153200'), false);
    assert.equal(acceptScannedBarcode('01234565'), true); // EAN-8 / UPC-E go to the lookup
    assert.equal(acceptScannedBarcode('ABC-123'), true);   // Code 128 text
    assert.equal(acceptScannedBarcode(''), false);
  });
  it('expands UPC/EAN spellings like the Worker', () => {
    assert.deepEqual(barcodeCandidates('673419356190').sort(), ['0673419356190', '00673419356190', '673419356190'].sort());
    assert.deepEqual(barcodeCandidates('123'), []);
  });
});

describe('offline barcode lookup', () => {
  const seed = indexSeed({
    sets: [
      { set_num: '75313-1', name: 'AT-AT', barcodes: ['673419356190', '5702017153209'] },
      { set_num: '10294-1', name: 'Titanic' },
    ],
  });
  it('finds a set by its US UPC, its EAN-13 spelling or its EU EAN', () => {
    assert.equal(barcodeFromSeed(seed, '673419356190').set_num, '75313-1');
    assert.equal(barcodeFromSeed(seed, '0673419356190').set_num, '75313-1');
    assert.equal(barcodeFromSeed(seed, '5702017153209').set_num, '75313-1');
    assert.equal(barcodeFromSeed(seed, '5702017153209')._seed, true);
  });
  it('returns null for an unknown code', () => {
    assert.equal(barcodeFromSeed(seed, '4006381333931'), null);
  });
});

describe('OCR box text sent to the server', () => {
  it('keeps lines with words or set-sized numbers, bounded', () => {
    assert.deepEqual(ocrContextLines(['LEGO', '  STAR   WARS ', '75313', '18+', '', '6785 pcs']), ['LEGO', 'STAR WARS', '75313', '6785 pcs']);
    const many = ocrContextLines(Array.from({ length: 50 }, (_, i) => `line ${i} ${'x'.repeat(300)}`));
    assert.equal(many.length, 32);
    assert.ok(many.every((l) => l.length <= 200));
  });
});
