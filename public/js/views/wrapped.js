// Brick Wrapped (#/wrapped) — 2026 redesign. The collector's year as a
// full-screen story: tap (or use the arrow keys) to step through the vault's
// value, its size, the best performer, what was sold and the theme of the
// year. "Share story" draws a 1080×1920 PNG on a canvas — no libraries — and
// hands it to the share sheet (download where sharing files isn't possible).
// Everything comes from the collection already on the device plus the
// /api/me/wrapped summary for sales; slides without real data are skipped
// rather than filled with zeros.
import { $, haptic, toast, escapeHtml, prefersReducedMotion, publicOrigin } from '../utils.js';
import { state } from '../state.js';
import { api, isGuestMode } from '../api.js';
import { t, tPlural, intlLocale } from '../lib/i18n.js';
import { icon, brickSvg } from '../ui/kit.js';
import { money0, moneySigned } from '../ui/set-ui.js';
import { displayValueOf } from '../lib/pure.js';
import { getCapacitorPlugin, isNativeCapacitor } from '../lib/native-auth.js';

const onScreen = () => location.hash.split('?')[0] === '#/wrapped';
const num = (n) => Number(n || 0).toLocaleString(intlLocale());

let story = null;
let index = 0;
let keyHandler = null;

/** Build the story from collection rows (pure: exported for tests). */
export function buildStory(items, summary, year = new Date().getFullYear()) {
  const rows = (items || []).filter((s) => !s.sold_at);
  const qty = (s) => Number(s.quantity) || 1;
  const sets = rows.reduce((n, s) => n + qty(s), 0);
  const value = rows.reduce((v, s) => v + (Number(displayValueOf(s)) || 0) * qty(s), 0);
  const pieces = rows.reduce((p, s) => p + (Number(s.pieces) || 0) * qty(s), 0);
  const themes = new Set(rows.map((s) => s.theme).filter(Boolean));

  let best = null;
  for (const s of rows) {
    const paid = Number(s.purchase_price);
    const unit = Number(displayValueOf(s));
    if (!(paid > 0) || !(unit > 0)) continue;
    const pct = ((unit - paid) / paid) * 100;
    if (!best || pct > best.pct) best = { pct, name: s.name || s.set_num };
  }

  // Theme of the year = most sets added this year; without additions this
  // year, the theme holding the most value is "your top theme".
  const byTheme = (pick) => {
    const m = new Map();
    for (const s of rows) if (s.theme && pick(s)) m.set(s.theme, (m.get(s.theme) || 0) + (pick(s) === true ? qty(s) : pick(s)));
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  };
  const addedThisYear = (s) => String(s.added_at || '').startsWith(String(year));
  const yearTheme = byTheme((s) => addedThisYear(s));
  const topTheme = yearTheme || byTheme((s) => (Number(displayValueOf(s)) || 0) * qty(s) || false);

  const stats = [];
  if (sets > 0) {
    stats.push({ big: tPlural('bvCommunity.wrSets', sets, { count: num(sets) }), small: pieces > 0 ? tPlural('bvCommunity.wrPiecesThemes', themes.size, { pieces: num(pieces), count: themes.size }) : tPlural('bvCommunity.wrThemes', themes.size, { count: themes.size }) });
  }
  if (best) {
    const pct = Math.round(best.pct);
    stats.push({ big: `${pct < 0 ? '−' : '+'}${Math.abs(pct)}%`, small: t('bvCommunity.wrBest', { name: best.name }) });
  }
  const sold = Number(summary?.sets_sold) || 0;
  if (sold > 0) stats.push({ big: moneySigned(Number(summary.realized_gain) || 0), small: tPlural('bvCommunity.wrRealized', sold, { count: sold }) });
  if (topTheme) stats.push({ big: topTheme, small: t(yearTheme ? 'bvCommunity.wrThemeYear' : 'bvCommunity.wrTopTheme'), theme: true });

  return { year, empty: sets === 0, headline: t('bvCommunity.wrBuilt', { value: money0(value) }), stats };
}

async function loadStory() {
  const [coll, summary] = await Promise.all([
    state.portfolio?.items ? Promise.resolve(state.portfolio) : api('/api/collection').catch(() => null),
    isGuestMode() || state.me?.is_guest ? Promise.resolve(null) : api('/api/me/wrapped').catch(() => null),
  ]);
  return buildStory(coll?.items || [], summary);
}

const slideCount = () => (story?.empty ? 1 : 1 + story.stats.length);

function statHTML(s, i) {
  return `<div class="bv-wr__stat${s.theme ? ' bv-wr__stat--word' : ''}" data-step="${i + 1}"${i + 1 > index ? ' hidden' : ''}><span class="bv-wr__big">${escapeHtml(s.big)}</span><span class="bv-wr__small">${escapeHtml(s.small)}</span></div>`;
}

function pageHTML() {
  const total = slideCount();
  const seg = Array.from({ length: total }, (_, i) => `<span class="${i <= index ? 'is-on' : ''}"></span>`).join('');
  const body = story.empty
    ? `<span class="bv-wr__eyebrow">${escapeHtml(t('bvCommunity.wrEyebrow', { year: story.year }))}</span>
       <h1 class="bv-wr__head">${escapeHtml(t('bvCommunity.wrEmptyTitle'))}</h1>
       <p class="bv-wr__small">${escapeHtml(t('bvCommunity.wrEmptyBody'))}</p>`
    : `<span class="bv-wr__eyebrow">${escapeHtml(t('bvCommunity.wrEyebrow', { year: story.year }))}</span>
       <h1 class="bv-wr__head">${escapeHtml(story.headline)}</h1>
       ${story.stats.map(statHTML).join('')}`;
  const action = story.empty
    ? `<a class="bv-wr__cta" href="#/add">${icon('plus', { size: 20 })}<span>${escapeHtml(t('bvCommunity.wrEmptyAction'))}</span></a>`
    : `<button type="button" class="bv-wr__cta" id="wrShareStory">${icon('share', { size: 20 })}<span>${escapeHtml(t('bvCommunity.wrShare'))}</span></button>`;
  return `<main class="bv-wr" id="wrappedStory" aria-roledescription="${escapeHtml(t('bvCommunity.wrStory'))}">
    <div class="bv-wr__brick" aria-hidden="true">${brickSvg('#252820')}</div>
    <header class="bv-wr__top">
      <a class="bv-wr__icon" href="#/me" id="wrClose" aria-label="${escapeHtml(t('bvCommunity.wrClose'))}">${icon('x')}</a>
      <div class="bv-wr__prog" aria-hidden="true">${seg}</div>
      ${story.empty ? '<span class="bv-wr__icon"></span>' : `<button type="button" class="bv-wr__icon" id="wrShareIcon" aria-label="${escapeHtml(t('bvCommunity.wrShare'))}">${icon('share')}</button>`}
    </header>
    <section class="bv-wr__stage" id="wrStage" aria-live="polite">
      ${body}
      <span class="bv-sr" id="wrPos">${escapeHtml(t('bvCommunity.wrSlide', { n: index + 1, total }))}</span>
    </section>
    ${total > 1 ? `<div class="bv-wr__nav"><button type="button" class="bv-wr__tap bv-wr__tap--prev" id="wrPrev" aria-label="${escapeHtml(t('bvCommunity.wrPrev'))}"></button><button type="button" class="bv-wr__tap bv-wr__tap--next" id="wrNext" aria-label="${escapeHtml(t('bvCommunity.wrNext'))}"></button></div>` : ''}
    <footer class="bv-wr__foot">${action}</footer>
  </main>`;
}

function step(delta) {
  const total = slideCount();
  const next = Math.max(0, Math.min(total - 1, index + delta));
  if (next === index) return;
  index = next;
  haptic('light');
  // Reveal in place so focus and the live region stay put.
  document.querySelectorAll('#wrappedStory .bv-wr__stat').forEach((el) => { el.hidden = Number(el.dataset.step) > index; });
  document.querySelectorAll('#wrappedStory .bv-wr__prog span').forEach((el, i) => el.classList.toggle('is-on', i <= index));
  const pos = $('#wrPos');
  if (pos) pos.textContent = t('bvCommunity.wrSlide', { n: index + 1, total });
  const shown = document.querySelector(`#wrappedStory .bv-wr__stat[data-step="${index}"]`);
  if (shown && !prefersReducedMotion()) { shown.classList.remove('is-new'); void shown.offsetWidth; shown.classList.add('is-new'); }
}

function close() {
  if (history.length > 1) history.back();
  else location.hash = '#/me';
}

export async function renderWrapped() {
  const root = $('#root');
  if (!root) return;
  index = 0;
  story = null;
  root.innerHTML = `<main class="bv-wr is-loading" aria-busy="true"><header class="bv-wr__top"><a class="bv-wr__icon" href="#/me" aria-label="${escapeHtml(t('bvCommunity.wrClose'))}">${icon('x')}</a></header></main>`;
  story = await loadStory();
  if (!onScreen()) return;
  root.innerHTML = pageHTML();
  $('#wrClose')?.addEventListener('click', (e) => { e.preventDefault(); close(); });
  $('#wrPrev')?.addEventListener('click', () => step(-1));
  $('#wrNext')?.addEventListener('click', () => step(1));
  $('#wrShareStory')?.addEventListener('click', shareStory);
  $('#wrShareIcon')?.addEventListener('click', shareStory);
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = (e) => {
    if (!onScreen()) { document.removeEventListener('keydown', keyHandler); keyHandler = null; return; }
    if (e.target?.closest?.('input, textarea, select')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', keyHandler);
}

/* ---------------------------------------------------------------- share */

function cssVar(name, fallback) {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch { return fallback; }
}

function wrapLines(ctx, text, maxWidth) {
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

/** Draw the whole story (every stat) on a 1080×1920 canvas. */
export function drawStory(canvas, s) {
  const W = 1080, H = 1920, X = 96;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const sans = cssVar('--bv-sans', 'system-ui, sans-serif');
  const mono = cssVar('--bv-mono', 'ui-monospace, monospace');
  const g = ctx.createLinearGradient(0, 0, W * 0.35, H);
  g.addColorStop(0, '#ffda47'); g.addColorStop(0.45, '#ffcf1a'); g.addColorStop(1, '#f2a81d');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Big faint brick bottom-right, like the screen.
  ctx.save();
  ctx.globalAlpha = 0.16; ctx.fillStyle = '#252820';
  const bx = W - 460, by = H - 640;
  const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); ctx.fill(); };
  rr(bx + 80, by, 110, 80, 22); rr(bx + 290, by, 110, 80, 22); rr(bx, by + 60, 520, 340, 44);
  ctx.restore();

  ctx.fillStyle = '#252820';
  ctx.textBaseline = 'alphabetic';
  let y = 220;
  ctx.font = `700 40px ${sans}`;
  ctx.fillText(t('bvCommunity.wrEyebrow', { year: s.year }).toUpperCase(), X, y);
  y += 120;
  ctx.font = `700 104px ${sans}`;
  for (const line of wrapLines(ctx, s.headline, W - X * 2)) { ctx.fillText(line, X, y); y += 124; }
  y += 40;
  for (const st of s.stats) {
    ctx.fillStyle = '#252820';
    ctx.font = `600 ${st.theme ? 84 : 92}px ${st.theme ? sans : mono}`;
    const big = wrapLines(ctx, st.big, W - X * 2).slice(0, 2);
    for (const line of big) { y += 96; ctx.fillText(line, X, y); }
    ctx.font = `400 40px ${sans}`;
    ctx.fillStyle = 'rgba(37,40,32,.85)';
    for (const line of wrapLines(ctx, st.small, W - X * 2).slice(0, 2)) { y += 56; ctx.fillText(line, X, y); }
    y += 56;
    if (y > H - 260) break;
  }
  ctx.fillStyle = '#252820';
  ctx.font = `600 38px ${sans}`;
  ctx.fillText(publicOrigin().replace(/^https?:\/\//, ''), X, H - 110);
  return canvas;
}

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function shareStory() {
  if (!story || story.empty) return;
  haptic('medium');
  const name = `brick-wrapped-${story.year}.png`;
  const title = t('bvCommunity.wrShareTitle', { year: story.year });
  let blob;
  try {
    const canvas = drawStory(document.createElement('canvas'), story);
    blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('no-blob');
  } catch {
    toast(t('bvCommunity.wrShareFailed'), 'error');
    return;
  }
  try {
    if (isNativeCapacitor()) {
      const Filesystem = getCapacitorPlugin('Filesystem');
      const Share = getCapacitorPlugin('Share');
      if (Filesystem?.writeFile && Share?.share) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const res = await Filesystem.writeFile({ path: name, data: toBase64(bytes), directory: 'CACHE', recursive: true });
        await Share.share({ title, files: [res.uri] });
        return;
      }
    }
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return;
    }
  } catch (e) {
    if (e?.name === 'AbortError' || /cancel/i.test(String(e?.message || ''))) return;
  }
  // Download fallback.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(t('bvCommunity.wrSaved', { name }), 'success');
}
