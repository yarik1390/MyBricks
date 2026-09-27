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
