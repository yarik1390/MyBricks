// Show/hide eye button on every text password field (sign-in, sign-up, reset,
// Rebrickable/Brickset logins). Installed once at boot; a MutationObserver
// picks up fields that views and sheets render later. Numeric PIN fields
// (Kids mode) are left alone: they are four dots by design.
import { t } from './i18n.js';

const EYE = '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';
const EYE_OFF = '<path d="M3 3l18 18"/><path d="M10.6 5.1A9.9 9.9 0 0112 5c6 0 10 7 10 7a17 17 0 01-3.2 3.9M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7c1.6 0 3-.4 4.3-1"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/>';
const svg = (paths) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

function label(shown) {
  return t(shown ? 'bvAccount.hidePassword' : 'bvAccount.showPassword');
}

export function isTogglablePassword(input) {
  if (!input || input.tagName !== 'INPUT' || input.dataset.bvPwToggle) return false;
  if (input.type !== 'password') return false;
  // Kids-mode PINs: numeric, 4 digits, styled as dots on purpose.
  if (input.getAttribute('inputmode') === 'numeric') return false;
  return true;
}

export function attachPasswordToggle(input, doc = document) {
  if (!isTogglablePassword(input)) return null;
  input.dataset.bvPwToggle = '1';
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'bv-pw-toggle';
  btn.setAttribute('aria-pressed', 'false');
  btn.setAttribute('aria-label', label(false));
  if (input.id) btn.setAttribute('aria-controls', input.id);
  btn.innerHTML = svg(EYE);
  btn.addEventListener('click', () => {
    const shown = input.type === 'password';
    input.type = shown ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(shown));
    btn.setAttribute('aria-label', label(shown));
    btn.innerHTML = svg(shown ? EYE_OFF : EYE);
    btn.classList.remove('bv-pw-toggle--flip');
    void btn.offsetWidth; // restart the small flip animation
    btn.classList.add('bv-pw-toggle--flip');
    // Keep typing where the user was: the caret survives the type swap.
    const end = input.value.length;
    input.focus({ preventScroll: true });
    try { input.setSelectionRange(end, end); } catch {}
  });
  // Field boxes (.bv-field__box) are flex rows, so the eye sits after the
  // input. A bare input (legacy .field-input) gets a positioned wrapper.
  const box = input.parentElement;
  if (box?.classList.contains('bv-field__box')) {
    box.appendChild(btn);
  } else if (box) {
    const wrap = doc.createElement('span');
    wrap.className = 'bv-pw-wrap';
    box.insertBefore(wrap, input);
    wrap.appendChild(input);
    wrap.appendChild(btn);
  }
  return btn;
}

export function enhancePasswordFields(root = document) {
  root.querySelectorAll?.('input[type="password"]').forEach((el) => attachPasswordToggle(el));
}

let observer = null;
export function installPasswordToggles() {
  if (observer || typeof MutationObserver === 'undefined') return;
  try {
    enhancePasswordFields(document);
    observer = new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.tagName === 'INPUT') attachPasswordToggle(n);
          else if (n.querySelector?.('input[type="password"]')) enhancePasswordFields(n);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  } catch {}
}
