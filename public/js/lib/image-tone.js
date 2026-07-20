// Classify a product photo's BACKGROUND so the set-detail hero can present it
// well. Rebrickable-style cutouts ship on white/transparent and look great
// "floating" via mix-blend multiply — but photographic shots on a black or
// coloured backdrop turn into a hard rectangle under multiply. We sample the
// image's border pixels and tell the caller which treatment to use.
//
// Sampling runs on a SEPARATE crossOrigin image, never the visible <img>, so a
// missing CORS header can only make us resolve null (caller keeps the default
// float) — it can never break the on-screen photo. Needs the image host to send
// Access-Control-Allow-Origin (our /api/img proxy does); otherwise the canvas
// is tainted, getImageData throws, and we fall back gracefully.

export function classifyImageTone(src) {
  return new Promise((resolve) => {
    if (!src || typeof src !== 'string' || src.startsWith('data:')) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => done(null), 4000);
    img.onerror = () => { clearTimeout(timer); done(null); };
    img.onload = () => {
      clearTimeout(timer);
      try {
        const S = 32;
        const cv = document.createElement('canvas');
        cv.width = S; cv.height = S;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        if (!ctx) { done(null); return; }
        ctx.drawImage(img, 0, 0, S, S);
        const { data } = ctx.getImageData(0, 0, S, S);
        let r = 0, g = 0, b = 0, lum = 0, n = 0, opaque = 0, total = 0;
        const border = (x, y) => x < 3 || y < 3 || x >= S - 3 || y >= S - 3;
        for (let y = 0; y < S; y++) {
          for (let x = 0; x < S; x++) {
            if (!border(x, y)) continue;
            const i = (y * S + x) * 4;
            total++;
            if (data[i + 3] < 24) continue; // transparent border pixel
            opaque++;
            const R = data[i], G = data[i + 1], B = data[i + 2];
            r += R; g += G; b += B;
            lum += (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;
            n++;
          }
        }
        // Mostly-transparent border → a cutout PNG, floats fine with multiply.
        if (n === 0 || opaque < total * 0.25) { done({ tone: 'light' }); return; }
        const avgLum = lum / n;
        const bg = { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
        // Near-white borders keep the floating-cutout look.
        if (avgLum > 0.82) { done({ tone: 'light', bg }); return; }
        // Dark or coloured backdrop → frame it on a plate that matches the bg.
        done({ tone: 'framed', bg, dark: avgLum < 0.4 });
      } catch {
        done(null); // tainted canvas (no ACAO) or other failure
      }
    };
    img.src = src;
  });
}
