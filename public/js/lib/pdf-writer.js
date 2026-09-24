// @ts-check
// A small, dependency-free PDF 1.4 writer: pages, Helvetica text (WinAnsi),
// filled/stroked rectangles and lines, and baseline JPEG images. Enough for
// a multi-page report with a table and photos. Coordinates are top-left
// based (y grows downwards) and converted to PDF space on output.

export const A4 = { width: 595.28, height: 841.89 };

// Helvetica / Helvetica-Bold advance widths (1/1000 em) for ASCII 32–126.
const W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const W_EXTRA = { 0x80: 556, 0x85: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0x96: 556, 0x97: 1000, 0x99: 1000, 0xA0: 278, 0xA3: 556, 0xA5: 556, 0xA9: 737, 0xAE: 737, 0xB7: 278 };

// Unicode code points outside Latin-1 that WinAnsiEncoding still carries.
/** @type {Record<number, number>} */
const WIN_ANSI_EXTRA = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88,
  0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93,
  0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B,
  0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F,
};
// Look-alikes folded before encoding (typographic minus, thin spaces…).
/** @type {Record<string, string>} */
const FOLD = { '\u2212': '-', '\u202F': ' ', '\u2009': ' ', '\u2007': ' ', '\u200B': '', '\u2011': '-', '\u2010': '-', '\u0141': 'L', '\u0142': 'l', '\u0110': 'D', '\u0111': 'd', '\u0131': 'i' };
// Ukrainian national transliteration (word-initial forms), plus Russian extras.
/** @type {Record<string, string>} */
const CYRILLIC = {
  А: 'A', Б: 'B', В: 'V', Г: 'H', Ґ: 'G', Д: 'D', Е: 'E', Є: 'Ye', Ж: 'Zh', З: 'Z', И: 'Y', І: 'I', Ї: 'Yi', Й: 'Y',
  К: 'K', Л: 'L', М: 'M', Н: 'N', О: 'O', П: 'P', Р: 'R', С: 'S', Т: 'T', У: 'U', Ф: 'F', Х: 'Kh', Ц: 'Ts', Ч: 'Ch',
  Ш: 'Sh', Щ: 'Shch', Ь: '', Ю: 'Yu', Я: 'Ya', Ё: 'Yo', Ъ: '', Ы: 'Y', Э: 'E',
};

/** @param {number} cp */
function winAnsiByte(cp) {
  if (cp >= 0x20 && cp <= 0x7E) return cp;
  if (cp >= 0xA0 && cp <= 0xFF) return cp;
  return WIN_ANSI_EXTRA[cp] ?? -1;
}

/** True when every character can be drawn with the standard fonts. */
export function winAnsiSupported(str) {
  for (const ch of String(str ?? '')) {
    const folded = FOLD[ch] ?? ch;
    for (const c of folded) if (winAnsiByte(/** @type {number} */ (c.codePointAt(0))) < 0) return false;
  }
  return true;
}

/**
 * Make any string drawable: fold look-alikes, transliterate Cyrillic, drop
 * diacritics the encoding lacks, and replace what's left with "?".
 * @param {unknown} value
 */
export function pdfSafe(value) {
  let out = '';
  for (const ch of String(value ?? '')) {
    const folded = FOLD[ch] ?? ch;
    if (winAnsiSupported(folded)) { out += folded; continue; }
    const upper = ch.toUpperCase();
    if (CYRILLIC[upper] !== undefined) {
      const lat = CYRILLIC[upper];
      out += ch === upper ? lat : lat.toLowerCase();
      continue;
    }
    const stripped = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    out += stripped && winAnsiSupported(stripped) ? stripped : '?';
  }
  return out;
}

/** @param {string} str @returns {number[]} */
function encode(str) {
  const bytes = [];
  for (const ch of pdfSafe(str)) bytes.push(winAnsiByte(/** @type {number} */ (ch.codePointAt(0))));
  return bytes;
}

/** Width of `str` in points. @param {string} str @param {number} size @param {boolean} [bold] */
export function textWidth(str, size, bold = false) {
  const table = bold ? W_BOLD : W_REG;
  let units = 0;
  for (const b of encode(str)) units += b >= 32 && b <= 126 ? table[b - 32] : (W_EXTRA[b] ?? (bold ? 611 : 556));
  return (units * size) / 1000;
}

/** Trim `str` with an ellipsis so it fits `maxWidth`. */
export function fitText(str, size, maxWidth, bold = false) {
  const safe = pdfSafe(str);
  if (textWidth(safe, size, bold) <= maxWidth) return safe;
  let lo = 0;
  let hi = safe.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(`${safe.slice(0, mid).trimEnd()}…`, size, bold) <= maxWidth) lo = mid; else hi = mid - 1;
  }
  return `${safe.slice(0, lo).trimEnd()}…`;
}

/** Word-wrap `str` into lines no wider than `maxWidth`. */
export function wrapText(str, size, maxWidth, bold = false) {
  const words = pdfSafe(str).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (!line || textWidth(next, size, bold) <= maxWidth) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

/** @param {number[]} bytes */
function pdfString(bytes) {
  let s = '(';
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5C) s += `\\${String.fromCharCode(b)}`;
    else if (b < 32 || b > 126) s += `\\${b.toString(8).padStart(3, '0')}`;
    else s += String.fromCharCode(b);
  }
  return `${s})`;
}

const n2 = (v) => (Math.round(v * 100) / 100).toString();
/** @param {string} hex */
function rgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const v = m ? parseInt(m[1], 16) : 0;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => n2(c / 255)).join(' ');
}

/**
 * Read width/height from a baseline or progressive JPEG (SOF marker).
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number, components: number } | null}
 */
export function jpegInfo(bytes) {
  if (!(bytes?.length > 4) || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xFF) { i++; continue; }
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8], components: bytes[i + 9] };
    }
    i += 2 + len;
  }
  return null;
}

export class PdfPage {
  /** @param {number} width @param {number} height */
  constructor(width, height) {
    this.width = width;
    this.height = height;
    /** @type {string[]} */
    this.ops = [];
    /** @type {Set<string>} */
    this.images = new Set();
  }

  /** Draw text with its baseline at (x, y) from the top-left. */
  text(x, y, str, { size = 11, bold = false, color = '#252820', align = 'left', maxWidth = 0 } = {}) {
    const s = maxWidth > 0 ? fitText(str, size, maxWidth, bold) : pdfSafe(str);
    const w = textWidth(s, size, bold);
    const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${n2(size)} Tf ${rgb(color)} rg ${n2(left)} ${n2(this.height - y)} Td ${pdfString(encode(s))} Tj ET`);
    return w;
  }

  rect(x, y, w, h, { fill = '', stroke = '', lineWidth = 1 } = {}) {
    const box = `${n2(x)} ${n2(this.height - y - h)} ${n2(w)} ${n2(h)} re`;
    if (fill && stroke) this.ops.push(`${rgb(fill)} rg ${rgb(stroke)} RG ${n2(lineWidth)} w ${box} B`);
    else if (fill) this.ops.push(`${rgb(fill)} rg ${box} f`);
    else this.ops.push(`${rgb(stroke || '#000000')} RG ${n2(lineWidth)} w ${box} S`);
  }

  line(x1, y1, x2, y2, { color = '#dadcd1', lineWidth = 0.75 } = {}) {
    this.ops.push(`${rgb(color)} RG ${n2(lineWidth)} w ${n2(x1)} ${n2(this.height - y1)} m ${n2(x2)} ${n2(this.height - y2)} l S`);
  }

  /** Place an image registered with PdfDocument#addJpeg. */
  image(name, x, y, w, h) {
    this.images.add(name);
    this.ops.push(`q ${n2(w)} 0 0 ${n2(h)} ${n2(x)} ${n2(this.height - y - h)} cm /${name} Do Q`);
  }
}

export class PdfDocument {
  constructor({ title = '', author = '', size = A4 } = {}) {
    this.title = title;
    this.author = author;
    this.size = size;
    /** @type {PdfPage[]} */
    this.pages = [];
    /** @type {Map<string, { bytes: Uint8Array, width: number, height: number, components: number }>} */
    this.jpegs = new Map();
  }

  addPage() {
    const page = new PdfPage(this.size.width, this.size.height);
    this.pages.push(page);
    return page;
  }

  /**
   * Register a JPEG; returns its resource name, or null if it isn't a JPEG.
   * @param {Uint8Array} bytes
   */
  addJpeg(bytes) {
    const info = jpegInfo(bytes);
    if (!info || ![1, 3].includes(info.components)) return null;
    const name = `Im${this.jpegs.size + 1}`;
    this.jpegs.set(name, { bytes, ...info });
    return name;
  }

  /** Serialize to PDF bytes. @returns {Uint8Array} */
  toBytes() {
    /** @type {(Uint8Array)[]} */
    const chunks = [];
    const offsets = [];
    let length = 0;
    const pushStr = (s) => { const b = latin1(s); chunks.push(b); length += b.length; };
    const pushBytes = (b) => { chunks.push(b); length += b.length; };
    const latin1 = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };

    const pages = this.pages.length ? this.pages : [this.addPage()];
    const imageNames = [...this.jpegs.keys()];
    // Object numbering: 1 catalog, 2 pages, 3 F1, 4 F2, 5 info, then images, then page+content pairs.
    const imageObj = new Map(imageNames.map((name, i) => [name, 6 + i]));
    const firstPageObj = 6 + imageNames.length;
    const pageObj = (i) => firstPageObj + i * 2;
    const total = firstPageObj + pages.length * 2;

    const begin = (num) => { offsets[num] = length; pushStr(`${num} 0 obj\n`); };
    pushStr('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    begin(1); pushStr('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    begin(2); pushStr(`<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`);
    begin(3); pushStr('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n');
    begin(4); pushStr('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n');
    begin(5); pushStr(`<< /Producer (BricksVault) /Title ${pdfString(encode(this.title))} /Author ${pdfString(encode(this.author))} >>\nendobj\n`);
    for (const name of imageNames) {
      const img = /** @type {{ bytes: Uint8Array, width: number, height: number, components: number }} */ (this.jpegs.get(name));
      begin(/** @type {number} */ (imageObj.get(name)));
      pushStr(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /${img.components === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`);
      pushBytes(img.bytes);
      pushStr('\nendstream\nendobj\n');
    }
    pages.forEach((page, i) => {
      const xobjects = [...page.images].filter((n) => imageObj.has(n)).map((n) => `/${n} ${imageObj.get(n)} 0 R`).join(' ');
      begin(pageObj(i));
      pushStr(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n2(page.width)} ${n2(page.height)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobjects ? ` /XObject << ${xobjects} >>` : ''} >> /Contents ${pageObj(i) + 1} 0 R >>\nendobj\n`);
      const content = page.ops.join('\n');
      begin(pageObj(i) + 1);
      pushStr(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    });
    const xref = length;
    let table = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let num = 1; num < total; num++) table += `${String(offsets[num]).padStart(10, '0')} 00000 n \n`;
    pushStr(`${table}trailer\n<< /Size ${total} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

    const out = new Uint8Array(length);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }
}
