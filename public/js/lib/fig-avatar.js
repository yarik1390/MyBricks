// fig-avatar.js — deterministic "mystery minifig" placeholder.
// When a minifig has no photo (Rebrickable never published one), we draw a
// goofy chunky-outline block figure instead of a blank gray box. Same seed
// always draws the same character, so a given fig keeps "its" identity.
// Pure string output — no DOM, safe to embed in template literals.

// FNV-1a over the fig number → stable pseudo-random bits per fig.
function figSeed(figNum) {
  let h = 0x811c9dc5;
  const s = String(figNum || "?");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Cheerful torso/legs color pairs (LEGO-toy palette).
const OUTFITS = [
  ["#DA291C", "#1C2E50"], // red / dark navy
  ["#0055BF", "#F2CD37"], // blue / yellow
  ["#237841", "#FFFFFF"], // green / white
  ["#F2CD37", "#DA291C"], // yellow / red
  ["#923978", "#00A3DA"], // purple / azure
  ["#FF6D3B", "#2E5A1C"], // coral / forest
];
const HAT_COLORS = ["#1C1C1E", "#DA291C", "#0055BF", "#237841", "#F2CD37"];

/**
 * Funny placeholder avatar for a minifig.
 * @param {string} figNum  stable seed ("fig-016165")
 * @param {string=} name   used for the jersey initial
 * @returns {string} inline <svg> markup
 */
export function figAvatarSVG(figNum, name) {
  const h = figSeed(figNum);
  const [torso, legsC] = OUTFITS[h % OUTFITS.length];
  const face = (h >>> 3) % 4;        // 0 smile · 1 shades · 2 surprised · 3 wink
  const hat = (h >>> 6) % 4;         // 0 cap · 1 hair · 2 beanie · 3 bald
  const hatC = HAT_COLORS[(h >>> 9) % HAT_COLORS.length];
  const ink = "#2A2A2E";

  // Jersey initial: white on dark torsos, ink on light ones (#F2CD37).
  const initialColor = (() => {
    const n = parseInt(torso.slice(1), 16);
    const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
    return lum > 150 ? ink : "#FFFFFF";
  })();

  const initial = (() => {
    const c = String(name || "").trim().toUpperCase()[0];
    return /[A-Z0-9]/.test(c) ? c : "?";
  })();

  const eyes = `<circle cx="27" cy="18" r="1.9" fill="${ink}"/><circle cx="37" cy="18" r="1.9" fill="${ink}"/>`;
  const faces = [
    // 0 — classic grin (+ blush)
    `${eyes}<circle cx="23.5" cy="22.5" r="2.1" fill="#FF9EB0" opacity=".55"/><circle cx="40.5" cy="22.5" r="2.1" fill="#FF9EB0" opacity=".55"/><path d="M26 23 Q32 28.5 38 23" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round"/>`,
    // 1 — sunglasses + smirk
    `<rect x="23.5" y="14.5" width="7.5" height="5.5" rx="1.6" fill="${ink}"/><rect x="33" y="14.5" width="7.5" height="5.5" rx="1.6" fill="${ink}"/><path d="M31 16.5 L33 16.5" stroke="${ink}" stroke-width="1.6"/><path d="M27 24.5 Q32 27 37.5 24" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round"/>`,
    // 2 — surprised "o"
    `<circle cx="27" cy="17.5" r="2.4" fill="${ink}"/><circle cx="37" cy="17.5" r="2.4" fill="${ink}"/><ellipse cx="32" cy="25" rx="3" ry="3.6" fill="${ink}"/>`,
    // 3 — wink + big grin
    `<path d="M24.5 18 L29.5 18" stroke="${ink}" stroke-width="2" stroke-linecap="round"/><circle cx="37" cy="18" r="1.9" fill="${ink}"/><path d="M26 22.5 Q32 29.5 38 22.5 Z" fill="${ink}"/>`,
  ];

  const hats = [
    // 0 — baseball cap, brim to the right
    `<path d="M19.5 13 A12.5 10 0 0 1 44.5 13 L44.5 14.5 L19.5 14.5 Z" fill="${hatC}" stroke="${ink}" stroke-width="1.8"/><rect x="42" y="12.5" width="11" height="4" rx="2" fill="${hatC}" stroke="${ink}" stroke-width="1.8"/>`,
    // 1 — wild hair spikes
    `<path d="M20 13 L23 6.5 L27 12 L31.5 5.5 L36 12 L40 6.5 L43.5 13 Z" fill="${hatC}" stroke="${ink}" stroke-width="1.8" stroke-linejoin="round"/>`,
    // 2 — beanie with pom-pom
    `<circle cx="32" cy="6" r="3" fill="${hatC}" stroke="${ink}" stroke-width="1.8"/><path d="M19.5 13 A12.5 10 0 0 1 44.5 13 L44.5 14.5 L19.5 14.5 Z" fill="${hatC}" stroke="${ink}" stroke-width="1.8"/>`,
    // 3 — bald & proud
    ``,
  ];

  return `<svg class="fig-avatar" viewBox="0 0 64 92" role="img" aria-hidden="true" preserveAspectRatio="xMidYMid meet">`
    + `<g stroke="${ink}" stroke-width="1.8">`
    + `<rect x="20" y="63" width="10" height="21" rx="3" fill="${legsC}"/>`
    + `<rect x="34" y="63" width="10" height="21" rx="3" fill="${legsC}"/>`
    + `<rect x="8.5" y="37" width="7" height="19" rx="3.2" fill="${torso}"/>`
    + `<rect x="48.5" y="37" width="7" height="19" rx="3.2" fill="${torso}"/>`
    + `<circle cx="12" cy="59" r="3.6" fill="#FFD83B"/>`
    + `<circle cx="52" cy="59" r="3.6" fill="#FFD83B"/>`
    + `<rect x="16" y="35" width="32" height="29" rx="4.5" fill="${torso}"/>`
    + `</g>`
    + `<text x="32" y="54.5" text-anchor="middle" font-family="'Courier New',monospace" font-weight="700" font-size="13" fill="${initialColor}">${initial}</text>`
    + `<g stroke="${ink}" stroke-width="1.8"><circle cx="32" cy="20" r="13.2" fill="#FFD83B"/></g>`
    + hats[hat]
    + faces[face]
    + `</svg>`;
}
