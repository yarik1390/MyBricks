import { $, escapeHtml, fmtMoney, haptic, toast, publicOrigin } from '../utils.js';
import { t, tPlural } from '../lib/i18n.js';
import { icon } from './kit.js';
import { shareImage, canvasBlob, cssVar, wrapLines } from '../lib/share-image.js';

// Set anniversaries on the set page: on the day an owned copy turns N years
// old (by its purchase date) the page shows a banner with a "Share" card — a
// 1080×1350 PNG in the Brick Wrapped style. The daily push
// (worker/src/jobs/set-anniversaries.ts) links here.

/** Whole years since `purchasedAt` when today is its anniversary (UTC), else 0. */
export function anniversaryYears(purchasedAt, today = new Date()) {
  const d = new Date(String(purchasedAt || '').slice(0, 10) + 'T00:00:00Z');
  if (!purchasedAt || Number.isNaN(d.getTime())) return 0;
  if (d.getUTCMonth() !== today.getUTCMonth() || d.getUTCDate() !== today.getUTCDate()) return 0;
  const years = today.getUTCFullYear() - d.getUTCFullYear();
  return years >= 1 ? years : 0;
}

function lines(set, entry, value) {
  const years = anniversaryYears(entry?.purchased_at);
  const paid = Number(entry?.purchase_price) || 0;
  const title = tPlural('portfolio.anniversaryCelebration', years, { set: set.name || set.set_num });
  const gain = paid > 0 && value > 0 ? value - paid : null;
  const sub = gain == null ? t('portfolio.anniversaryQuip')
    : gain >= 0 ? t('portfolio.anniversaryGain', { paid: fmtMoney(paid, { cents: 0 }), gain: fmtMoney(gain, { cents: 0 }) })
      : t('portfolio.anniversaryNoGain', { paid: fmtMoney(paid, { cents: 0 }) });
  return { years, title, sub };
}

export function anniversaryBannerHTML(set, entry, value) {
  if (!entry) return '';
  const { years, title, sub } = lines(set, entry, value);
  if (!years) return '';
  const heading = title.replace(/\s*🎂\s*$/u, '');
  return `<section class="bv-anniv" id="annivBanner" aria-label="${escapeHtml(title)}">
    <span class="bv-anniv__cake" aria-hidden="true">🎂</span>
    <span class="bv-anniv__text"><strong>${escapeHtml(heading)}</strong><span>${escapeHtml(sub)}</span></span>
    <button type="button" class="bv-btn bv-btn--tonal bv-btn--sm" id="annivShare">${icon('share', { size: 18 })}<span>${escapeHtml(t('fun.annivShare'))}</span></button>
  </section>`;
}

/** Draw the share card (1080×1350, Brick Wrapped yellow). */
export function drawAnniversaryCard(canvas, { title, sub, value, setNum }) {
  const W = 1080, H = 1350, X = 96;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const sans = cssVar('--bv-sans', 'system-ui, sans-serif');
  const mono = cssVar('--bv-mono', 'ui-monospace, monospace');
  const g = ctx.createLinearGradient(0, 0, W * 0.35, H);
  g.addColorStop(0, '#ffda47'); g.addColorStop(0.45, '#ffcf1a'); g.addColorStop(1, '#f2a81d');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = 0.16; ctx.fillStyle = '#252820';
  const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); ctx.fill(); };
  const bx = W - 440, by = H - 400;
  rr(bx + 80, by, 110, 80, 22); rr(bx + 290, by, 110, 80, 22); rr(bx, by + 60, 520, 340, 44);
  ctx.restore();
  ctx.fillStyle = '#252820';
  let y = 200;
  ctx.font = `700 40px ${sans}`;
  ctx.fillText(t('fun.annivEyebrow').toUpperCase(), X, y);
  y += 130;
  ctx.font = `700 96px ${sans}`;
  for (const line of wrapLines(ctx, title, W - X * 2).slice(0, 4)) { ctx.fillText(line, X, y); y += 116; }
  y += 30;
  if (value > 0) {
    ctx.font = `600 92px ${mono}`;
    ctx.fillText(fmtMoney(value, { cents: 0 }), X, y + 60); y += 120;
  }
  ctx.font = `400 44px ${sans}`;
  ctx.fillStyle = 'rgba(37,40,32,.85)';
  for (const line of wrapLines(ctx, sub, W - X * 2).slice(0, 3)) { y += 60; ctx.fillText(line, X, y); }
  ctx.fillStyle = '#252820';
  ctx.font = `600 38px ${sans}`;
  const link = publicOrigin().replace(/^https?:\/\//, '') + '/s/' + setNum;
  ctx.fillText(link, X, H - 100);
  return canvas;
}

export function wireAnniversary(set, entry, value) {
  $('#annivShare')?.addEventListener('click', async () => {
    haptic('medium');
    const { years, title, sub } = lines(set, entry, value);
    let blob = null;
    try { blob = await canvasBlob(drawAnniversaryCard(document.createElement('canvas'), { title, sub, value, setNum: encodeURIComponent(set.set_num) })); } catch {}
    if (!blob) { toast(t('bvCommunity.wrShareFailed'), 'error'); return; }
    const name = `bricksvault-${set.set_num}-${years}y.png`;
    await shareImage(blob, { name, title, savedText: t('bvCommunity.wrSaved', { name }) });
  });
}
