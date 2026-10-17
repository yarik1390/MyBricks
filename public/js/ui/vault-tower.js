import { escapeHtml, setHue } from '../utils.js';
import { distinctHues } from '../lib/pure.js';
import { themeAllocation } from '../lib/vault-insights.js';
import { t } from '../lib/i18n.js';

// Vault hero brick tower: the collection as a stack of bricks, one layer per
// theme (largest at the bottom, thickness = share of value), topped with studs.
// It grows with the number of sets, so adding a set visibly adds height.

const W = 44;
const STUD_H = 4;

/** Tower height for a holdings count: 22px for one set, 72px from ~75 sets. */
export function towerHeight(holdings) {
  const n = Math.max(1, Number(holdings) || 1);
  return Math.round(Math.min(72, 22 + 8 * Math.log2(n)));
}

/**
 * Layers bottom → top with pixel heights summing to the body height.
 * @returns {{ theme: string, hue: number|null, h: number }[]}
 */
export function towerLayers(items, valueOf, { holdings = 1, otherLabel = '' } = {}) {
  const body = towerHeight(holdings) - STUD_H;
  const min = 7;
  // A short tower (few sets) gets fewer, thicker layers; the tail folds into "Other".
  const fit = Math.max(2, Math.min(6, Math.floor(body / min)));
  const alloc = themeAllocation(items, valueOf, { limit: fit, otherLabel });
  if (!alloc.rows.length) return [];
  let rows = alloc.rows.map(r => ({ theme: r.theme, share: r.share }));
  if (alloc.rest > 0) rows = rows.slice(0, fit - 1);
  const shown = rows.reduce((s, r) => s + r.share, 0);
  if (100 - shown > 0.5) rows.push({ theme: otherLabel, share: 100 - shown, other: true });
  const hues = distinctHues(rows.map(r => setHue({ theme: r.theme })));
  const flex = Math.max(0, body - min * rows.length);
  const total = rows.reduce((s, r) => s + r.share, 0) || 1;
  let used = 0;
  return rows.map((r, i) => {
    const h = i === rows.length - 1 ? body - used : Math.round(min + flex * (r.share / total));
    used += h;
    return { theme: r.theme, hue: r.other ? null : hues[i], h };
  });
}

export function vaultTowerHTML(items, valueOf, holdings) {
  const layers = towerLayers(items, valueOf, { holdings, otherLabel: t('room.otherTheme') });
  if (!layers.length) return '';
  const height = layers.reduce((s, l) => s + l.h, 0) + STUD_H;
  const fill = l => l.hue == null ? 'var(--bv-line-strong, #9aa0a6)' : `hsl(${l.hue} 52% 56%)`;
  // Bricks sit slightly staggered, like a hand-built stack.
  const BW = W - 4;
  let y = height;
  const xs = [];
  const bricks = layers.map((l, i) => {
    y -= l.h;
    const x = i % 2 ? 4 : 0;
    xs.push(x);
    return `<g><rect class="vault-tower__layer" x="${x}" y="${y}" width="${BW}" height="${l.h}" rx="2" fill="${fill(l)}"/>`
      + `<rect x="${x}" y="${y}" width="${BW}" height="1.5" rx="1" fill="#fff" opacity=".3"/>`
      + `<rect x="${x}" y="${y + l.h - 1.5}" width="${BW}" height="1.5" rx="1" fill="#000" opacity=".18"/></g>`;
  }).join('');
  const top = layers[layers.length - 1];
  const topX = xs[xs.length - 1];
  const studs = [topX + 7, topX + BW - 15].map(x => `<rect x="${x}" y="${y - STUD_H}" width="8" height="${STUD_H + 1}" rx="1.5" fill="${fill(top)}"/>`).join('');
  const label = t('fun.towerLabel', { themes: layers.map(l => l.theme).filter(Boolean).join(', ') });
  return `<svg class="vault-tower" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" aria-hidden="true" focusable="false"><title>${escapeHtml(label)}</title>${studs}${bricks}</svg>`;
}
