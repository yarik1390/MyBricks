// Photo-scan "seek" choreography over the captured still. While the photo is
// being identified a camera pointer roams the picture, pausing to focus here
// and there. When the answer comes back it travels to each set that was found,
// snaps its brackets around it (the caller names it), and leaves a numbered marker, and
// only then does the result sheet rise. Purely visual: it never decides what
// was found, and every step is skipped when motion is reduced.
import { seekWaypoint } from '../lib/scan-geometry.js';

const ROAM_MS = 820;       // one hop of the roaming pointer (move + focus pause)
const TRAVEL_MS = 460;     // pointer travel onto a found set
const HOLD_ONE_MS = 620;   // single set: hold the lock a beat longer
const HOLD_MANY_MS = 320;  // shelf: keep a several-set reveal brisk
export const SEEK_MAX_TARGETS = 5;

let _seek = null;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function viewSize(wrap) {
  return { w: wrap.clientWidth || innerWidth, h: wrap.clientHeight || innerHeight };
}

function place(el, rect) {
  el.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`;
  el.style.width = `${Math.round(rect.width)}px`;
  el.style.height = `${Math.round(rect.height)}px`;
}

export function seekActive() {
  return !!(_seek && _seek.layer.isConnected);
}

/** Start roaming over the still inside `.bv-scan`; `from` is the aimed frame. */
export function startSeek(wrap, from) {
  stopSeek();
  if (!wrap) return null;
  const layer = document.createElement('div');
  layer.className = 'bv-seek';
  layer.setAttribute('aria-hidden', 'true');
  const corner = (c) => `<span class="bv-seek__corner" data-c="${c}"></span>`;
  layer.innerHTML = `
    <div class="bv-seek__scan"></div>
    <div class="bv-seek__marks"></div>
    <div class="bv-seek__ret">${['tl', 'tr', 'bl', 'br'].map(corner).join('')}<span class="bv-seek__cross"></span></div>`;
  wrap.appendChild(layer);
  wrap.classList.add('is-seeking');
  const ret = layer.querySelector('.bv-seek__ret');
  const seek = { wrap, layer, ret, timer: null, step: 0, focusing: false };
  _seek = seek;
  // Begin exactly where the user aimed, then tighten into the roaming pointer.
  const { w, h } = viewSize(wrap);
  ret.classList.add('is-instant');
  place(ret, from || { left: w * 0.15, top: h * 0.2, width: w * 0.7, height: h * 0.4 });
  void ret.offsetWidth;
  ret.classList.remove('is-instant');
  const roam = () => {
    if (_seek !== seek || seek.focusing || !layer.isConnected) return;
    const v = viewSize(wrap);
    ret.classList.remove('is-pause');
    place(ret, seekWaypoint(seek.step++, v.w, v.h));
    // Settle, then "focus" for a moment before the next hop.
    seek.pause = setTimeout(() => { if (_seek === seek && !seek.focusing) ret.classList.add('is-pause'); }, ROAM_MS * 0.55);
    seek.timer = setTimeout(roam, ROAM_MS);
  };
  seek.timer = setTimeout(roam, 120);
  return seek;
}

/**
 * Visit each found set ({rect, label} in view px): travel, lock, report it to
 * `onLock(index, label)` and leave a marker. Resolves when done, or early
 * once `isStale()` turns true.
 */
export async function focusFound(targets, { onLock, isStale = () => false } = {}) {
  const seek = _seek;
  if (!seek || !seek.layer.isConnected || !targets?.length) return;
  seek.focusing = true;
  clearTimeout(seek.timer);
  clearTimeout(seek.pause);
  const { ret, layer } = seek;
  const marks = layer.querySelector('.bv-seek__marks');
  const list = targets.slice(0, SEEK_MAX_TARGETS);
  const many = list.length > 1;
  for (let i = 0; i < list.length; i++) {
    const { rect, label: text } = list[i];
    ret.classList.remove('is-lock', 'is-pause');
    place(ret, rect);
    await wait(TRAVEL_MS);
    if (isStale() || _seek !== seek) return;
    ret.classList.add('is-lock');
    onLock?.(i, text || '');
    if (many) {
      const m = document.createElement('span');
      m.className = 'bv-seek__mark';
      const n = document.createElement('b');
      n.textContent = String(i + 1);
      m.appendChild(n);
      place(m, rect);
      marks.appendChild(m);
    }
    await wait(many ? HOLD_MANY_MS : HOLD_ONE_MS);
    if (isStale() || _seek !== seek) return;
  }
}

/** Remove the pointer; `keepMarks` leaves what was found marked on the photo. */
export function stopSeek({ keepMarks = false } = {}) {
  const seek = _seek;
  _seek = null;
  if (!seek) return;
  clearTimeout(seek.timer);
  clearTimeout(seek.pause);
  seek.wrap.classList.remove('is-seeking');
  const marked = !!seek.layer.querySelector('.bv-seek__mark');
  if (keepMarks && (marked || seek.ret.classList.contains('is-lock'))) {
    // Numbered markers stay for a shelf; a single set keeps its brackets.
    seek.layer.classList.add('is-settled');
    seek.layer.classList.toggle('has-marks', marked);
    return;
  }
  seek.layer.remove();
}

/** Drop any leftover markers (new photo, retry, mode switch). */
export function clearSeekMarks(wrap) {
  stopSeek();
  wrap?.querySelectorAll('.bv-seek').forEach((n) => n.remove());
}
