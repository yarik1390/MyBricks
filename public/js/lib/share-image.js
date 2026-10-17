import { toast } from '../utils.js';
import { getCapacitorPlugin, isNativeCapacitor } from './native-auth.js';

// Share a PNG: Android share sheet (via a cache file), the Web Share API with
// files, else a download. Used by Brick Wrapped and anniversary cards.

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function canvasBlob(canvas) {
  return new Promise((res) => canvas.toBlob(res, 'image/png'));
}

/** Resolves 'shared' | 'cancelled' | 'saved'. `savedText` is toasted on download. */
export async function shareImage(blob, { name, title, savedText } = {}) {
  try {
    if (isNativeCapacitor()) {
      const Filesystem = getCapacitorPlugin('Filesystem');
      const Share = getCapacitorPlugin('Share');
      if (Filesystem?.writeFile && Share?.share) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const res = await Filesystem.writeFile({ path: name, data: toBase64(bytes), directory: 'CACHE', recursive: true });
        await Share.share({ title, files: [res.uri] });
        return 'shared';
      }
    }
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return 'shared';
    }
  } catch (e) {
    if (e?.name === 'AbortError' || /cancel/i.test(String(e?.message || ''))) return 'cancelled';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  if (savedText) toast(savedText, 'success');
  return 'saved';
}

// Canvas helpers shared by the share-card drawers.
export function cssVar(name, fallback) {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch { return fallback; }
}

export function wrapLines(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}
