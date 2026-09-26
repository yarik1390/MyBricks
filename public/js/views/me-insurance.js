// Insurance report (#/me/insurance) — 2026 redesign. A preview of the
// valuation, three switches (set photos, prices paid, minifigures) and a PDF
// built on the device (lib/insurance-report.js → lib/pdf-writer.js): Save PDF
// downloads it (Documents on Android), Share hands it to the system sheet.
import { $, $$, escapeHtml, haptic, toast, fmtMoney, thumbImg, setHue } from '../utils.js';
import { state } from '../state.js';
import { api } from '../api.js';
import { t, tPlural, getLocale } from '../lib/i18n.js';
import { displayValueOf } from '../lib/pure.js';
import { topbar, toggle, btn, skeletonRows } from '../ui/kit.js';
import { buildInsuranceReport } from '../lib/insurance-report.js';
import { getCapacitorPlugin, isNativeCapacitor } from '../lib/native-auth.js';
import { loadMe } from './me-shared.js';

const PHOTO_LIMIT = 300;
const opts = { photos: true, paid: false, figs: true };
let data = null;
let busy = false;
const onScreen = () => location.hash.split('?')[0] === '#/me/insurance';

const COND = { sealed: 'bvSet.condSealed', new: 'bvSet.condOpened', used_good: 'bvSet.condBuilt', used_acceptable: 'bvSet.condParts' };

// Any failed request rejects: a report with holdings silently missing is
// worse than no report, so the caller shows a retry instead of the export.
async function loadData() {
  const [coll, figs] = await Promise.all([
    state.portfolio?.items ? Promise.resolve(state.portfolio) : api('/api/collection'),
    loadOwnedFigs(),
  ]);
  if (!Array.isArray(coll?.items)) throw new Error('collection unavailable');
  const items = coll.items
    .map((s) => {
      const qty = Number(s.quantity) || 1;
      const unit = Number(displayValueOf(s)) || 0;
      return { set: s, qty, unit, total: unit * qty, paid: Number(s.purchase_price) > 0 ? Number(s.purchase_price) * qty : null };
    })
    .sort((a, b) => b.total - a.total);
  return { items, figs };
}

async function loadOwnedFigs() {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const r = await api(`/api/minifigs?owned=yes&limit=100&offset=${offset}&sort=value_desc`);
    const rows = r?.minifigs;
    if (!Array.isArray(rows)) throw new Error('minifigures unavailable');
    out.push(...rows);
    if (!r.hasMore) break;
    if (!rows.length) throw new Error('minifigures stopped short');
  }
  return out.map((f) => {
    const qty = Number(f.owned_qty ?? f.quantity) || 1;
    const unit = Number(f.current_value) || 0;
    return { fig: f, qty, unit, total: unit * qty, paid: Number(f.purchase_price) > 0 ? Number(f.purchase_price) * qty : null };
  });
}

function totals() {
  const sets = data.items.reduce((a, r) => a + r.qty, 0);
  const figs = data.figs.reduce((a, r) => a + r.qty, 0);
  const value = data.items.reduce((a, r) => a + r.total, 0) + (opts.figs ? data.figs.reduce((a, r) => a + r.total, 0) : 0);
  const paid = data.items.reduce((a, r) => a + (r.paid || 0), 0) + (opts.figs ? data.figs.reduce((a, r) => a + (r.paid || 0), 0) : 0);
  return { sets, figs, value, paid };
}

function dateLabel() {
  return new Date().toLocaleDateString(getLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

// Page count for the preview — the same layout, without photo bytes.
function pageCount() {
  try { return buildInsuranceReport(reportInput(new Map())).pages; } catch { return 1; }
}

function previewHTML(me) {
  const tot = totals();
  const top = data.items.slice(0, 3);
  const more = Math.max(0, data.items.length - top.length);
  const counts = opts.figs && tot.figs
    ? t('bvAccount.insCounts', { sets: tPlural('bvAccount.setsCount', tot.sets, { count: tot.sets }), figs: tPlural('bvAccount.figsCount', tot.figs, { count: tot.figs }) })
    : tPlural('bvAccount.setsCount', tot.sets, { count: tot.sets });
  return `<div class="bv-insprev" aria-label="${escapeHtml(t('bvAccount.insPreview'))}">
      <p class="bv-insprev__kicker">${escapeHtml(t('bvAccount.insKicker'))}</p>
      <p class="bv-insprev__title">${escapeHtml(`${me.display_name || t('bvAccount.collector')} · ${dateLabel()}`)}</p>
      <p class="bv-insprev__meta">${escapeHtml(counts)}</p>
      <div class="bv-insprev__total"><span>${escapeHtml(t('bvAccount.insTotal'))}</span><span class="bv-num">${escapeHtml(fmtMoney(tot.value, { cents: 0 }))}</span></div>
      ${opts.paid && tot.paid ? `<div class="bv-insprev__paid"><span>${escapeHtml(t('bvAccount.insPaid'))}</span><span class="bv-num">${escapeHtml(fmtMoney(tot.paid, { cents: 0 }))}</span></div>` : ''}
      ${top.map((r) => `<div class="bv-insprev__row">
          <span class="bv-insprev__sw" style="background:hsl(${setHue(r.set)} 55% 58%)">${opts.photos && r.set.image_url && !String(r.set.image_url).startsWith('data:') ? `<img class="set-photo" src="${escapeHtml(thumbImg(r.set.image_url, 120))}" alt="" loading="lazy">` : ''}</span>
          <span class="bv-insprev__name"><span>${escapeHtml(r.set.name || r.set.set_num)}</span><span class="bv-insprev__num">${escapeHtml(r.set.set_num)}</span></span>
          <span class="bv-insprev__val bv-num">${escapeHtml(fmtMoney(r.total, { cents: 0 }))}</span>
        </div>`).join('')}
      <p class="bv-insprev__more">${escapeHtml(more ? t('bvAccount.insMore', { more: tPlural('bvAccount.moreSets', more, { count: more }), pages: pageCount() }) : t('bvAccount.insPages', { pages: pageCount() }))}</p>
    </div>`;
}

function switchRow(key, label) {
  return `<div class="bv-alertsw"><span class="bv-alertsw__label" id="ins-${key}-l">${escapeHtml(t(label))}</span>${toggle({ id: `ins-${key}`, on: opts[key], label: t(label), attrs: { 'data-ins': key } })}</div>`;
}

function paint(me) {
  const root = $('#root');
  if (!root || !onScreen()) return;
  const empty = !data.items.length && !data.figs.length;
  root.innerHTML = `<main class="bv-page no-nav has-bar bv-insurance" id="insurancePage">
      ${topbar({ title: t('bvAccount.insurance'), sub: t('bvAccount.insSub'), back: '#/me' })}
      <section class="bv-insurance__stage">${empty ? `<p class="bv-insurance__empty">${escapeHtml(t('bvAccount.insEmpty'))}</p>` : previewHTML(me)}</section>
      <div class="bv-alertsws bv-insurance__opts">
        ${switchRow('photos', 'bvAccount.insPhotos')}
        ${switchRow('paid', 'bvAccount.insIncludePaid')}
        ${switchRow('figs', 'bvAccount.insFigs')}
      </div>
      <p class="bv-foot">${escapeHtml(t('bvAccount.insNote'))}</p>
      <div class="bv-insurance__bar">
        ${me.is_supporter
          ? `${btn(t('bvAccount.insSave'), { kind: 'outline', icon: 'download', id: 'insSave', disabled: empty })}${btn(t('bvAccount.insShare'), { icon: 'share', id: 'insShare', disabled: empty })}`
          // The valuation report has always been a Pro feature; the preview stays open to everyone.
          : btn(t('bvAccount.insUnlock'), { icon: 'star', href: '#/pro', id: 'insUnlock', full: true })}
      </div>
    </main>`;
  $$('#insurancePage [data-ins]').forEach((tg) => tg.addEventListener('click', () => {
    const key = tg.dataset.ins;
    opts[key] = !opts[key];
    haptic('light');
    paint(me);
  }));
  $('#insSave')?.addEventListener('click', () => deliver('save'));
  $('#insShare')?.addEventListener('click', () => deliver('share'));
}

export async function renderMeInsurance() {
  const root = $('#root');
  if (!root) return;
  root.innerHTML = `<main class="bv-page no-nav bv-insurance" aria-busy="true">${topbar({ title: t('bvAccount.insurance'), sub: t('bvAccount.insSub'), back: '#/me' })}<div class="bv-group__box bv-gap">${skeletonRows(3)}</div></main>`;
  const me = await loadMe();
  try {
    data = await loadData();
  } catch {
    data = null;
    paintFailed();
    return;
  }
  paint(me);
}

function paintFailed() {
  const root = $('#root');
  if (!root || !onScreen()) return;
  root.innerHTML = `<main class="bv-page no-nav bv-insurance" id="insurancePage">
      ${topbar({ title: t('bvAccount.insurance'), sub: t('bvAccount.insSub'), back: '#/me' })}
      <section class="bv-insurance__stage"><p class="bv-insurance__empty" role="alert">${escapeHtml(t('bvAccount.insLoadFailed'))}</p></section>
      <div class="bv-insurance__bar">${btn(t('common.retry'), { icon: 'refresh', id: 'insRetry', full: true })}</div>
    </main>`;
  $('#insRetry')?.addEventListener('click', () => { haptic('light'); renderMeInsurance(); });
}

// ------------------------------------------------------------------ PDF
function reportLabels() {
  // Every label the PDF draws, placeholders left for insurance-report.js to
  // fill. Only Latin-script translations can be drawn with the PDF's
  // built-in fonts; it falls back to all-English otherwise.
  return {
    kicker: t('bvAccount.insKicker'),
    title: '{owner} · {date}',
    counts: t('bvAccount.insPdfCounts'),
    countsNoFigs: t('bvAccount.insPdfCountsNoFigs'),
    totalValue: t('bvAccount.insTotal'),
    totalPaid: t('bvAccount.insPaid'),
    colSet: t('bvAccount.insColSet'),
    colNumber: t('bvAccount.insColNumber'),
    colQty: t('bvAccount.insColQty'),
    colPaid: t('bvAccount.insColPaid'),
    colValue: t('bvAccount.insColValue'),
    minifigures: t('bvAccount.insColFigs'),
    noteTitle: t('bvAccount.insNoteTitle'),
    note: t('bvAccount.insPdfNote'),
    page: t('bvAccount.insPdfPage'),
    generated: t('bvAccount.insPdfGenerated'),
  };
}

function reportInput(photos) {
  const me = state.me || {};
  const tot = totals();
  const money = (v) => fmtMoney(v, { cents: 0 });
  return {
    owner: me.display_name || t('bvAccount.collector'),
    date: dateLabel(),
    currency: me.currency || 'USD',
    totals: { value: money(tot.value), paid: tot.paid ? money(tot.paid) : '', sets: tot.sets, figs: opts.figs ? tot.figs : 0 },
    items: data.items.map((r) => ({
      name: r.set.name || r.set.set_num,
      number: r.set.set_num,
      meta: [r.set.theme, r.set.year, t(COND[r.set.condition] || COND.sealed)].filter(Boolean).join(' · '),
      qty: r.qty,
      value: money(r.total),
      paid: r.paid != null ? money(r.paid) : '—',
      photo: photos.get(r.set.set_num) || null,
    })),
    figs: data.figs.map((r) => ({
      name: r.fig.name || r.fig.fig_num,
      number: r.fig.fig_num,
      qty: r.qty,
      value: money(r.total),
      paid: r.paid != null ? money(r.paid) : '—',
      photo: photos.get(`fig:${r.fig.fig_num}`) || null,
    })),
    options: { ...opts },
    labels: reportLabels(),
  };
}

// Set photos → small JPEGs via canvas (the image proxy sends CORS headers).
function photoJpeg(url) {
  return new Promise((resolve) => {
    if (!url || String(url).startsWith('data:')) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), 8000);
    img.onload = () => {
      clearTimeout(timer);
      try {
        const size = 120;
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        const x = c.getContext('2d');
        x.fillStyle = '#ffffff'; x.fillRect(0, 0, size, size);
        const s = Math.min(size / img.naturalWidth, size / img.naturalHeight);
        const w = img.naturalWidth * s;
        const h = img.naturalHeight * s;
        x.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        c.toBlob(async (blob) => resolve(blob ? new Uint8Array(await blob.arrayBuffer()) : null), 'image/jpeg', 0.82);
      } catch { resolve(null); }
    };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = thumbImg(url, 200);
  });
}

async function collectPhotos() {
  const photos = new Map();
  if (!opts.photos) return photos;
  const jobs = [
    ...data.items.slice(0, PHOTO_LIMIT).map((r) => [r.set.set_num, r.set.image_url]),
    ...(opts.figs ? data.figs.slice(0, PHOTO_LIMIT).map((r) => [`fig:${r.fig.fig_num}`, r.fig.image_url]) : []),
  ];
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const [key, url] = jobs[i++];
      const bytes = await photoJpeg(url);
      if (bytes) photos.set(key, bytes);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return photos;
}

function fileName() {
  return `bricksvault-insurance-${new Date().toISOString().slice(0, 10)}.pdf`;
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function deliver(mode) {
  if (busy) return;
  busy = true;
  const button = $(mode === 'save' ? '#insSave' : '#insShare');
  const label = button?.querySelector('span');
  const before = label?.textContent;
  if (button) button.disabled = true;
  if (label) label.textContent = t('bvAccount.insBuilding');
  try {
    const photos = await collectPhotos();
    const { bytes } = buildInsuranceReport(reportInput(photos));
    const name = fileName();
    haptic('medium');
    if (isNativeCapacitor()) {
      const Filesystem = getCapacitorPlugin('Filesystem');
      const Share = getCapacitorPlugin('Share');
      if (!Filesystem?.writeFile) throw new Error(t('bvAccount.insNativeMissing'));
      if (mode === 'save') {
        try {
          await Filesystem.writeFile({ path: name, data: toBase64(bytes), directory: 'DOCUMENTS', recursive: true });
          toast(t('bvAccount.insSavedDocs', { name }), 'success');
          return;
        } catch { /* scoped storage refused → share sheet instead */ }
      }
      const res = await Filesystem.writeFile({ path: name, data: toBase64(bytes), directory: 'CACHE', recursive: true });
      await Share?.share?.({ title: t('bvAccount.insurance'), files: [res.uri] });
      return;
    }
    const file = new File([bytes], name, { type: 'application/pdf' });
    if (mode === 'share' && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: t('bvAccount.insurance') }); return; }
      catch (e) { if (e?.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(file);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast(t(mode === 'share' ? 'bvAccount.insDownloadedShare' : 'bvAccount.insDownloaded', { name }), 'success');
  } catch (err) {
    toast(t('common.errorWithDetails', { error: err.message || err }), 'error');
  } finally {
    busy = false;
    if (button) button.disabled = false;
    if (label && before) label.textContent = before;
  }
}
