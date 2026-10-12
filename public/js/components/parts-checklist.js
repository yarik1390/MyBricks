// Parts checklist for an owned set (set page → Manage → Parts completeness).
// Lists the official parts with a stepper to mark how many of each are missing
// (saved per part through PATCH /api/sets/:num/parts/:part:color), and exports
// the marked parts as a wanted list — BrickLink XML or Rebrickable CSV — via
// /api/wanted-list. The same export helper serves Vault → Build's shortfall.
import { escapeHtml, toast } from '../utils.js';
import { api, isGuestMode } from '../api.js';
import { exportBlob } from '../lib/native-file-export.js';
import { t, tPlural } from '../lib/i18n.js';

const PAGE = 60;

/** Fetch a wanted-list file from the API and save/share it. */
export async function exportWantedList(path, format) {
  const sep = path.includes('?') ? '&' : '?';
  const data = await api(`${path}${sep}format=${encodeURIComponent(format)}`);
  if (!data?.file || !data.count) {
    toast('No parts to export yet.');
    return null;
  }
  const blob = new Blob([data.file.content], { type: data.file.mime });
  await exportBlob(blob, data.file.name, { title: 'Wanted list' });
  if (data.skipped > 0) toast('Some parts were left out: BrickLink has no matching color.');
  return data;
}

/** The two export buttons, wired to `path` (e.g. /api/wanted-list?set=10305-1). */
export function wantedListButtonsHTML(idPrefix) {
  return `<div class="bv-btn-row" style="margin-top:10px;">
    <button type="button" class="bv-btn bv-btn--outline" id="${idPrefix}Bl">BrickLink wanted list</button>
    <button type="button" class="bv-btn bv-btn--outline" id="${idPrefix}Rb">Rebrickable list</button>
  </div>`;
}

export function wireWantedListButtons(root, idPrefix, path) {
  for (const [suffix, format] of [['Bl', 'bricklink'], ['Rb', 'rebrickable']]) {
    const btn = root.querySelector(`#${idPrefix}${suffix}`);
    btn?.addEventListener('click', async () => {
      btn.disabled = true;
      try { await exportWantedList(path, format); }
      catch { toast('Could not build the wanted list. Try again.'); }
      finally { btn.disabled = false; }
    });
  }
}

function summaryHTML(parts) {
  const real = parts.filter((p) => !p.is_spare);
  const total = real.reduce((s, p) => s + Number(p.quantity || 0), 0);
  const missing = real.reduce((s, p) => s + Math.min(Number(p.missing_qty || 0), Number(p.quantity || 0)), 0);
  const pct = total > 0 ? Math.round((total - missing) / total * 100) : null;
  const color = pct === null ? 'var(--ink-mute)' : pct >= 95 ? 'var(--up)' : pct >= 80 ? 'var(--bv-yellow)' : 'var(--down)';
  return `<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px;">
      <span style="font-size:22px;font-weight:700;color:${color};">${pct === null ? '—' : `${pct}%`}</span>
      <span style="color:var(--ink-mute);font-size:12px;">${escapeHtml(t('detail.partsComplete'))} · ${escapeHtml(missing > 0 ? tPlural('detail.partsMissing', missing, { count: missing }) : t('detail.allPartsPresent'))}</span>
    </div>`;
}

function rowHTML(p, editable) {
  const key = `${p.part_num}:${p.color_id}`;
  const miss = Number(p.missing_qty || 0);
  return `<li class="parts-row" data-key="${escapeHtml(key)}" style="display:flex;align-items:center;gap:8px;font-size:12px;padding:4px 0;border-bottom:1px solid var(--line, rgba(0,0,0,.06));">
    ${p.part_img_url ? `<img src="${escapeHtml(p.part_img_url)}" alt="" loading="lazy" style="width:32px;height:32px;object-fit:contain;flex:none;">` : `<span style="width:32px;height:32px;background:var(--surface-2);border-radius:4px;flex:none;"></span>`}
    <span style="flex:1;min-width:0;">
      <span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(p.part_name || p.part_num)}</span>
      <span style="color:var(--ink-mute);font-size:11px;">${escapeHtml([p.color_name, p.part_num].filter(Boolean).join(' · '))} · ×${Number(p.quantity) || 0}</span>
    </span>
    ${editable ? `<span style="display:flex;align-items:center;gap:2px;flex:none;" aria-label="Missing pieces">
      <button type="button" class="icon-btn parts-dec" aria-label="One fewer missing" ${miss <= 0 ? 'disabled' : ''} style="min-width:44px;min-height:44px;">−</button>
      <span class="bv-num parts-miss" aria-live="polite" style="min-width:22px;text-align:center;font-family:var(--mono);color:${miss > 0 ? 'var(--down)' : 'var(--ink-mute)'};">${miss}</span>
      <button type="button" class="icon-btn parts-inc" aria-label="One more missing" ${miss >= Number(p.quantity) ? 'disabled' : ''} style="min-width:44px;min-height:44px;">+</button>
    </span>` : (miss > 0 ? `<span style="font-family:var(--mono);color:var(--down);">−${miss}</span>` : '')}
  </li>`;
}

/**
 * Render the checklist into `container` from a /api/sets/:num/parts payload.
 * Returns nothing; all state lives on the rendered rows and `data.parts`.
 */
export function renderPartsChecklist(container, set, data) {
  const parts = (data.parts || []).filter((p) => !p.is_spare);
  const editable = !isGuestMode();
  const byKey = new Map(parts.map((p) => [`${p.part_num}:${p.color_id}`, p]));
  let filter = '';
  let onlyMissing = false;
  let shown = PAGE;
  const saveTimers = new Map();

  const visible = () => parts.filter((p) => {
    if (onlyMissing && !(Number(p.missing_qty) > 0)) return false;
    if (!filter) return true;
    return `${p.part_name || ''} ${p.part_num} ${p.color_name || ''}`.toLowerCase().includes(filter);
  });

  container.innerHTML = `
    <div class="parts-summary">${summaryHTML(parts)}</div>
    <p style="color:var(--ink-mute);font-size:12px;line-height:1.45;margin:0 0 8px;">Mark pieces you're missing with − and +. Then export them as a wanted list to buy them on BrickLink or Rebrickable.</p>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
      <input type="search" class="parts-filter" placeholder="Find a part" aria-label="Find a part" style="flex:1;min-width:0;min-height:40px;">
      <label style="display:flex;align-items:center;gap:4px;font-size:12px;white-space:nowrap;"><input type="checkbox" class="parts-only-missing"> Missing only</label>
    </div>
    <ul class="parts-list" style="list-style:none;margin:0;padding:0;"></ul>
    <button type="button" class="bv-btn bv-btn--text bv-btn--full parts-more" hidden>Show more parts</button>
    ${editable ? wantedListButtonsHTML('partsWanted') : ''}`;

  const list = container.querySelector('.parts-list');
  const more = container.querySelector('.parts-more');
  const draw = () => {
    const rows = visible();
    list.innerHTML = rows.slice(0, shown).map((p) => rowHTML(p, editable)).join('')
      || `<li style="color:var(--ink-mute);font-size:12px;padding:6px 0;">${onlyMissing ? 'Nothing marked missing.' : 'No parts match.'}</li>`;
    more.hidden = rows.length <= shown;
  };
  draw();

  container.querySelector('.parts-filter').addEventListener('input', (e) => { filter = e.target.value.trim().toLowerCase(); shown = PAGE; draw(); });
  container.querySelector('.parts-only-missing').addEventListener('change', (e) => { onlyMissing = e.target.checked; shown = PAGE; draw(); });
  more.addEventListener('click', () => { shown += PAGE; draw(); });
  if (editable) wireWantedListButtons(container, 'partsWanted', `/api/wanted-list?set=${encodeURIComponent(set.set_num)}`);

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.parts-inc, .parts-dec');
    if (!btn || !editable) return;
    const row = btn.closest('.parts-row');
    const key = row?.dataset.key;
    const part = byKey.get(key);
    if (!part) return;
    const max = Number(part.quantity) || 0;
    const next = Math.max(0, Math.min(max, Number(part.missing_qty || 0) + (btn.classList.contains('parts-inc') ? 1 : -1)));
    part.missing_qty = next;
    row.outerHTML = rowHTML(part, true);
    container.querySelector('.parts-summary').innerHTML = summaryHTML(parts);
    // Debounced per part, so tapping + five times saves once.
    clearTimeout(saveTimers.get(key));
    saveTimers.set(key, setTimeout(async () => {
      saveTimers.delete(key);
      try {
        await api(`/api/sets/${encodeURIComponent(set.set_num)}/parts/${encodeURIComponent(key)}`, {
          method: 'PATCH', body: { missing_qty: part.missing_qty },
        });
      } catch { toast('Could not save that change. Check your connection.'); }
    }, 500));
  });
}
