// Geometry for the live scanner overlay: map a detected barcode quad from the
// camera frame to CSS pixels of the on-screen preview, and turn "default frame
// → locked frame" into per-corner translations so the brackets can snap onto a
// barcode with transform-only animation. Pure: no DOM, no state.

/** Scale/offset of an object-fit: cover video inside a view. */
export function coverTransform(videoW, videoH, viewW, viewH) {
  const scale = Math.max(viewW / videoW, viewH / videoH);
  return { scale, dx: (viewW - videoW * scale) / 2, dy: (viewH - videoH * scale) / 2 };
}

/**
 * Bounding rect (CSS px, relative to the view) of a barcode quad detected in a
 * videoW×videoH frame shown with object-fit: cover in a viewW×viewH element.
 * `pad` grows the rect so the brackets sit just outside the bars. Returns null
 * for degenerate input so callers keep the searching frame.
 */
export function quadToViewRect(points, videoW, videoH, viewW, viewH, pad = 12) {
  if (!Array.isArray(points) || points.length < 2) return null;
  if (!(videoW > 0) || !(videoH > 0) || !(viewW > 0) || !(viewH > 0)) return null;
  const pts = points
    .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 2) return null;
  const { scale, dx, dy } = coverTransform(videoW, videoH, viewW, viewH);
  const xs = pts.map((p) => p.x * scale + dx);
  const ys = pts.map((p) => p.y * scale + dy);
  const left = Math.max(0, Math.min(...xs) - pad);
  const top = Math.max(0, Math.min(...ys) - pad);
  const right = Math.min(viewW, Math.max(...xs) + pad);
  const bottom = Math.min(viewH, Math.max(...ys) + pad);
  if (right - left < 8 || bottom - top < 8) return null;
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * Points already in view coordinates (e.g. the native live scanner reports
 * device pixels over a full-screen preview): divide by the pixel ratio and
 * return the padded rect, or null when degenerate.
 */
export function screenQuadToViewRect(points, viewW, viewH, pixelRatio = 1, pad = 12) {
  const r = Number(pixelRatio) > 0 ? Number(pixelRatio) : 1;
  const scaled = (Array.isArray(points) ? points : []).map((p) => ({ x: Number(p?.x) / r, y: Number(p?.y) / r }));
  return quadToViewRect(scaled, viewW, viewH, viewW, viewH, pad);
}

/**
 * Per-corner translations that move brackets drawn around `from` onto `to`
 * (both {left, top, width, height}). Each corner keeps its size, so strokes
 * never distort.
 */
export function cornerOffsets(from, to) {
  if (!from || !to) return null;
  const fr = from.left + from.width, fb = from.top + from.height;
  const tr = to.left + to.width, tb = to.top + to.height;
  return {
    tl: { x: to.left - from.left, y: to.top - from.top },
    tr: { x: tr - fr, y: to.top - from.top },
    bl: { x: to.left - from.left, y: tb - fb },
    br: { x: tr - fr, y: tb - fb },
  };
}

/** Default searching frame for a view: barcode = wide and short, photo = tall. */
export function defaultFrame(viewW, viewH, mode = 'barcode') {
  const w = Math.round(Math.min(viewW - 64, mode === 'barcode' ? 300 : 320));
  const h = Math.round(mode === 'barcode' ? Math.min(180, w * 0.6) : Math.min(viewH * 0.46, w * 1.15));
  const left = Math.round((viewW - w) / 2);
  const top = Math.round(Math.max(96, viewH * (mode === 'barcode' ? 0.3 : 0.24)));
  return { left, top, width: w, height: h };
}

/**
 * A set's location from the shelf scan (`[ymin, xmin, ymax, xmax]`, each 0–1000
 * of the photo) as a padded rect in a viewW×viewH view showing that imgW×imgH
 * photo with object-fit: cover. Null when the box is missing, malformed or off
 * screen, so the caller can fall back to the frame the user aimed with.
 */
export function normBoxToViewRect(box, imgW, imgH, viewW, viewH, pad = 6) {
  if (!Array.isArray(box) || box.length !== 4) return null;
  if (!(imgW > 0) || !(imgH > 0) || !(viewW > 0) || !(viewH > 0)) return null;
  const [y0, x0, y1, x1] = box.map(Number);
  if (![y0, x0, y1, x1].every((v) => Number.isFinite(v) && v >= 0 && v <= 1000)) return null;
  if (y1 <= y0 || x1 <= x0) return null;
  const quad = [{ x: (x0 / 1000) * imgW, y: (y0 / 1000) * imgH }, { x: (x1 / 1000) * imgW, y: (y1 / 1000) * imgH }];
  const r = quadToViewRect(quad, imgW, imgH, viewW, viewH, pad);
  return r && r.width >= 24 && r.height >= 24 ? r : null;
}

/**
 * Where the roaming scan pointer goes next while a photo is being identified:
 * a size×size square that wanders the upper two thirds of the view (the result
 * sheet rises over the rest). Deterministic per step, so tests can pin it.
 */
export function seekWaypoint(step, viewW, viewH, size = 104) {
  const fx = (0.31 + step * 0.618034) % 1;
  const fy = (0.57 + step * 0.381966) % 1;
  const minX = viewW * 0.08, maxX = viewW * 0.92 - size;
  const minY = viewH * 0.14, maxY = viewH * 0.64 - size;
  return {
    left: Math.round(minX + fx * Math.max(0, maxX - minX)),
    top: Math.round(minY + fy * Math.max(0, maxY - minY)),
    width: size,
    height: size,
  };
}
