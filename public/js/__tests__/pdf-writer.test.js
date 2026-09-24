import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PdfDocument, pdfSafe, winAnsiSupported, textWidth, fitText, wrapText, jpegInfo } from '../lib/pdf-writer.js';
import { buildInsuranceReport, reportLabels, REPORT_LABELS_EN } from '../lib/insurance-report.js';

const latin1 = (bytes) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

// Smallest structurally valid JPEG header: SOI, APP0, SOF0 (3×2, 3 components), EOI.
function tinyJpeg(width = 3, height = 2) {
  return new Uint8Array([
    0xFF, 0xD8,
    0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xFF, 0xC0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xFF, 0xD9,
  ]);
}

function xrefIsConsistent(pdf) {
  const text = latin1(pdf);
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
  const table = text.slice(start);
  const rows = [...table.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  return rows.every((offset, i) => text.startsWith(`${i + 1} 0 obj`, offset));
}

describe('pdf writer', () => {
  it('encodes text the standard fonts can draw and transliterates the rest', () => {
    assert.equal(winAnsiSupported('Café · 2 500 € — “ok”'), true);
    assert.equal(winAnsiSupported('Ярослав'), false);
    assert.equal(pdfSafe('Ярослав Жук'), 'Yaroslav Zhuk');
    assert.equal(pdfSafe('Щука'), 'Shchuka');
    assert.equal(pdfSafe('−12 %'), '-12 %');
    assert.equal(pdfSafe('東京'), '??');
    assert.equal(pdfSafe('Łódź'), 'Lódz');
  });

  it('measures Helvetica and fits text with an ellipsis', () => {
    assert.equal(textWidth('A', 10), 6.67);
    assert.equal(textWidth('A', 10, true), 7.22);
    const fitted = fitText('Millennium Falcon Ultimate Collector Series', 10, 80);
    assert.ok(fitted.endsWith('…'));
    assert.ok(textWidth(fitted, 10) <= 80);
    assert.deepEqual(wrapText('one two three four', 10, 40), ['one two', 'three', 'four']);
  });

  it('reads JPEG dimensions and rejects non-JPEG bytes', () => {
    assert.deepEqual(jpegInfo(tinyJpeg(3, 2)), { width: 3, height: 2, components: 3 });
    assert.equal(jpegInfo(new Uint8Array([0x89, 0x50, 0x4E, 0x47])), null);
  });

  it('writes a well-formed PDF with a correct cross-reference table', () => {
    const doc = new PdfDocument({ title: 'Test (1)', author: 'Sam' });
    const img = doc.addJpeg(tinyJpeg());
    assert.equal(img, 'Im1');
    const page = doc.addPage();
    page.text(40, 60, 'Hello (world) \\ back', { size: 12, bold: true });
    page.rect(40, 80, 100, 20, { fill: '#ffda47' });
    page.line(40, 110, 140, 110);
    page.image(img, 40, 120, 30, 20);
    doc.addPage().text(40, 60, 'Second', {});
    const pdf = doc.toBytes();
    const text = latin1(pdf);
    assert.ok(text.startsWith('%PDF-1.4\n'));
    assert.ok(text.endsWith('%%EOF\n'));
    assert.match(text, /\/Count 2/);
    assert.match(text, /\(Hello \\\(world\\\) \\\\ back\) Tj/);
    assert.match(text, /\/Filter \/DCTDecode/);
    assert.match(text, /\/XObject << \/Im1 6 0 R >>/);
    assert.ok(xrefIsConsistent(pdf));
  });
});

describe('insurance report', () => {
  const item = (i) => ({ name: `Set number ${i}`, number: `${10000 + i}-1`, meta: 'Icons · 2024', qty: 1, value: `$${100 + i}`, paid: `$${90 + i}`, photo: i % 2 ? tinyJpeg() : null });
  const base = {
    owner: 'Ярослав', date: '23 Sep 2026', currency: 'USD',
    totals: { value: '$2,626', paid: '$2,100', sets: 40, figs: 2 },
    items: Array.from({ length: 40 }, (_, i) => item(i)),
    figs: [{ name: 'Darth Vader', number: 'sw0636', qty: 1, value: '$24' }, { name: 'Boba Fett', number: 'sw0002', qty: 2, value: '$60' }],
  };

  it('paginates, numbers pages and transliterates the owner', () => {
    const { bytes, pages } = buildInsuranceReport({ ...base, options: { photos: true, paid: true, figs: true } });
    const text = latin1(bytes);
    assert.ok(pages >= 2, `expected several pages, got ${pages}`);
    assert.match(text, new RegExp(`\\(Page 1 of ${pages}\\) Tj`));
    assert.match(text, new RegExp(`\\(Page ${pages} of ${pages}\\) Tj`));
    assert.match(text, /\(Yaroslav \\267 23 Sep 2026\) Tj/);
    assert.match(text, /\(Paid\) Tj/);
    assert.match(text, /\(Minifigures\) Tj/);
    assert.match(text, /\/Subtype \/Image/);
    assert.ok(xrefIsConsistent(bytes));
  });

  it('leaves out prices paid, photos and minifigures when switched off', () => {
    const { bytes } = buildInsuranceReport({ ...base, options: { photos: false, paid: false, figs: false } });
    const text = latin1(bytes);
    assert.doesNotMatch(text, /\(Paid\) Tj/);
    assert.doesNotMatch(text, /\(Total paid\) Tj/);
    assert.doesNotMatch(text, /Minifigures/);
    assert.doesNotMatch(text, /\/Subtype \/Image/);
  });

  it('uses translations only when every label can be drawn', () => {
    assert.equal(reportLabels({ totalValue: 'Gesamtwert' }).totalValue, 'Gesamtwert');
    assert.equal(reportLabels({ totalValue: 'Загальна вартість' }).totalValue, REPORT_LABELS_EN.totalValue);
  });
});
