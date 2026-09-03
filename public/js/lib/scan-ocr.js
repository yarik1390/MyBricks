// Client-side OCR for photo scans. Android uses on-device ML Kit (TextOcr
// plugin). Web uses the platform TextDetector API when the browser actually
// exposes it — we do not bundle a WASM OCR engine into the PWA. If neither
// path yields text, the identify request goes out without ocr_candidates and
// the Worker falls through to Brickognize / the vision cascade.
import { nativeOcrSupported, recognizeTextNative } from './native-ocr.js';

const MAX_STRINGS = 32;
const MAX_STRING_CHARS = 200;
const MAX_TOKENS = 12;
const OCR_TIMEOUT_MS = 2500;

export function parseOcrSetNumbers(input) {
  const seen = new Set();
  const tokens = [];
  for (const text of sanitizeOcrInput(input)) {
    for (const token of extractSetNumbersFromText(text)) {
      if (seen.has(token)) continue;
      seen.add(token);
      tokens.push(token);
      if (tokens.length >= MAX_TOKENS) return tokens;
    }
  }
  return tokens;
}

export async function collectOcrCandidates(dataUrl, win) {
  const texts = await readImageText(dataUrl, win);
  return parseOcrSetNumbers(texts);
}

function sanitizeOcrInput(input) {
  const list = Array.isArray(input) ? input : (typeof input === 'string' || typeof input === 'number' ? [input] : []);
  const out = [];
  for (const item of list) {
    if (typeof item === 'string') out.push(item.slice(0, MAX_STRING_CHARS));
    else if (typeof item === 'number' && Number.isFinite(item)) out.push(String(item).slice(0, MAX_STRING_CHARS));
    if (out.length >= MAX_STRINGS) break;
  }
  return out;
}

function extractSetNumbersFromText(raw) {
  let text = String(raw || '').replace(/[\u2013\u2014\u2212]/g, '-');
  text = text.replace(/(\d{3,6})\s*-\s*(\d{1,2})\b/g, '$1-$2');
  const found = [];
  // Precision first: box text contains years, piece counts, ages, barcodes and
  // prices. Only trust a short number when OCR also captured an explicit LEGO
  // box label immediately before it.
  const re = /\bset(?:\s+(?:number|no\.?|#))?\s*[:#.-]?\s*(\d{3,6})(?:-(\d{1,2}))?\b/gi;
  let match = re.exec(text);
  while (match) {
    const base = match[1];
    const suffix = match[2];
    found.push(suffix ? `${base}-${suffix}` : base);
    match = re.exec(text);
  }
  return found;
}

async function readImageText(dataUrl, win) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return [];
  const nativeOk = await nativeOcrSupported(win).catch(() => false);
  if (nativeOk) {
    const native = await withTimeout(recognizeTextNative(dataUrl, win), OCR_TIMEOUT_MS);
    if (native.length) return native;
  }
  return withTimeout(recognizeTextWeb(dataUrl, win), OCR_TIMEOUT_MS);
}

async function recognizeTextWeb(dataUrl, win) {
  const root = win || (typeof globalThis !== 'undefined' ? globalThis : undefined);
  const Detector = root?.TextDetector;
  if (typeof Detector !== 'function') return [];
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const detector = new Detector();
    const results = await detector.detect(bitmap);
    try { bitmap.close?.(); } catch { /* ImageBitmap.close is optional */ }
    return (results || [])
      .map((row) => row?.rawValue || row?.data || '')
      .filter((line) => typeof line === 'string' && line.trim());
  } catch {
    return [];
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(Array.isArray(value) ? value : []);
    };
    const timer = setTimeout(() => finish([]), ms);
    Promise.resolve(promise).then((value) => {
      clearTimeout(timer);
      finish(value);
    }, () => {
      clearTimeout(timer);
      finish([]);
    });
  });
}
