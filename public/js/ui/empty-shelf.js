import { escapeHtml } from '../utils.js';
import { t } from '../lib/i18n.js';

// Empty Vault shelf: a little scene in the flat brick style of the Vault tower.
// A red and yellow brick stack drops onto the plank, an empty "+" slot waits for
// the first set, and a minifig waves. Bricks hop when tapped. Purely decorative
// apart from the slot, which opens the add flow like the primary action.

const RED = 'hsl(4 62% 54%)';
const YELLOW = 'hsl(46 92% 58%)';
const BLUE = 'hsl(212 60% 52%)';
const SKIN = '#f6c42b';
const DARK = '#3a3d35';
// LEGO dark bluish grey: reads on both the light and the dark card.
const LEGS = '#6c6e68';

// One flat brick: body, light top edge, dark bottom edge, studs on top.
function brick(x, y, w, h, studs, fill) {
  const pitch = w / studs;
  const studW = Math.min(10, pitch - 6);
  const tops = Array.from({ length: studs }, (_, i) =>
    `<rect x="${(x + pitch * i + (pitch - studW) / 2).toFixed(1)}" y="${y - 5}" width="${studW.toFixed(1)}" height="6" rx="1.5" fill="${fill}"/>`).join('');
  return `${tops}<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${fill}"/>`
    + `<rect x="${x}" y="${y}" width="${w}" height="2" rx="1" fill="#fff" opacity=".3"/>`
    + `<rect x="${x}" y="${y + h - 2}" width="${w}" height="2" rx="1" fill="#000" opacity=".18"/>`;
}

function stackSVG() {
  return `<svg class="vault-empty__stack" viewBox="0 0 76 70" width="76" height="70" aria-hidden="true" focusable="false">`
    + `<g class="vault-empty__brick vault-empty__brick--1">${brick(2, 42, 72, 28, 4, RED)}</g>`
    + `<g class="vault-empty__brick vault-empty__brick--2"><g transform="rotate(-5 38 41)">${brick(18, 13, 40, 28, 2, YELLOW)}</g></g>`
    + `</svg>`;
}

function minifigSVG() {
  return `<svg class="vault-empty__fig" viewBox="0 0 52 82" width="52" height="82" aria-hidden="true" focusable="false">`
    + `<g class="vault-empty__wave"><rect x="38" y="10" width="7" height="20" rx="3.5" fill="${BLUE}"/><circle cx="41.5" cy="8" r="4" fill="${SKIN}"/></g>`
    + `<rect x="7" y="27" width="7" height="19" rx="3.5" fill="${BLUE}" transform="rotate(12 10.5 28)"/><circle cx="7" cy="47" r="4" fill="${SKIN}"/>`
    + `<rect x="21" y="1" width="10" height="5" rx="1.5" fill="${SKIN}"/>`
    + `<rect x="15" y="4" width="22" height="19" rx="6" fill="${SKIN}"/>`
    + `<circle cx="22" cy="12" r="1.8" fill="${DARK}"/><circle cx="30" cy="12" r="1.8" fill="${DARK}"/>`
    + `<path d="M21 16.5 Q26 20.5 31 16.5" stroke="${DARK}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`
    + `<rect x="21" y="22" width="10" height="4" fill="${SKIN}"/>`
    + `<path d="M15 26 H37 L40 51 H12 Z" fill="${BLUE}"/>`
    + `<rect x="12" y="51" width="28" height="5" rx="1" fill="${LEGS}"/>`
    + `<rect x="12" y="56" width="13" height="26" rx="2" fill="${LEGS}"/><rect x="27" y="56" width="13" height="26" rx="2" fill="${LEGS}"/>`
    + `</svg>`;
}

export function emptyShelfHTML() {
  const label = t('bvVault.emptySlot');
  return `<div class="vault-empty__scene">`
    + `<div class="vault-empty__row">${stackSVG()}`
    + `<button type="button" class="vault-empty__slot" data-empty-slot aria-label="${escapeHtml(label)}"><span class="vault-empty__plus" aria-hidden="true">+</span><span class="vault-empty__slot-label" aria-hidden="true">${escapeHtml(label)}</span></button>`
    + `${minifigSVG()}</div>`
    + `<div class="vault-empty__plank" aria-hidden="true"></div></div>`;
}

/** Tap a brick (or the minifig) and it hops; restarts if tapped again mid-hop. */
export function wireEmptyShelf(root) {
  const scene = root?.querySelector('.vault-empty__scene');
  if (!scene || scene.dataset.wired) return;
  scene.dataset.wired = 'true';
  scene.addEventListener('pointerdown', (e) => {
    const target = e.target instanceof Element ? e.target.closest('.vault-empty__brick, .vault-empty__fig') : null;
    if (!target) return;
    target.classList.remove('is-hop');
    // Force a reflow so the animation restarts on rapid taps.
    void target.getBoundingClientRect();
    target.classList.add('is-hop');
  });
  scene.addEventListener('animationend', (e) => {
    if (e.animationName === 'vault-empty-hop') e.target.classList?.remove('is-hop');
  });
}
