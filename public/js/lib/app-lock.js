// Optional biometric app-lock. When enabled, the installed app requires a
// fingerprint (or the device PIN/pattern fallback) to open, and re-locks after
// being in the background for a while. Protects the vault/portfolio on a shared
// or lost device. Web build: no-op.
import { getCapacitorPlugin, isNativeCapacitor } from './native-auth.js';
import { biometricAvailable, verifyBiometric } from './native-biometric.js';
import { APP_LOCK_ENABLED_KEY } from './app-lock-boot.js';
import { t } from './i18n.js';

const ENABLED_KEY = APP_LOCK_ENABLED_KEY;
const RELOCK_AFTER_MS = 15_000; // re-lock only after a real backgrounding, not a quick app-switch

const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let _wired = false;
let _verifying = false;   // guards the appStateChange loop while the OS prompt is up
let _bgAt = 0;

export function appLockEnabled() {
  try { return localStorage.getItem(ENABLED_KEY) === '1'; } catch { return false; }
}
export function setAppLockEnabled(on) {
  try { localStorage.setItem(ENABLED_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
  try {
    getCapacitorPlugin('SystemBars')?.setPrivacyProtection?.({ enabled: !!on }).catch(() => {});
  } catch { /* native privacy persistence is best-effort on web */ }
}

function overlay() {
  let el = document.getElementById('appLock');
  if (!el) {
    el = document.createElement('div');
    el.id = 'appLock';
    el.className = 'app-lock';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'appLockTitle');
    // Canvas: AppLock. Brand, what is hidden and why, one big sensor button.
    // The system prompt itself offers the device PIN/pattern, so "Use PIN
    // instead" opens the same prompt.
    el.innerHTML = `
      <div class="app-lock-inner">
        <div class="app-lock-mark" aria-hidden="true"><svg viewBox="0 0 40 32" width="44" height="36"><rect x="7" y="0" width="9" height="7" rx="2" fill="#c8431f"/><rect x="24" y="0" width="9" height="7" rx="2" fill="#c8431f"/><rect x="0" y="5" width="40" height="27" rx="4" fill="#c8431f"/></svg></div>
        <h1 class="app-lock-title" id="appLockTitle">${esc(t('bvFirst.lockTitle'))}</h1>
        <p class="app-lock-sub">${esc(t('bvFirst.lockSub'))}</p>
        <div class="app-lock-actions">
          <button type="button" class="app-lock-btn" id="appLockUnlock" aria-describedby="appLockHint"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 11v5M8 9a4 4 0 0 1 8 0v4M5 10a7 7 0 0 1 14 0v2M9 13v3a3 3 0 0 0 6 0v-1"/></svg><span class="app-lock-sr">${esc(t('bvFirst.lockUnlock'))}</span></button>
          <p class="app-lock-hint" id="appLockHint">${esc(t('bvFirst.lockHint'))}</p>
          <button type="button" class="app-lock-pin" id="appLockPin">${esc(t('bvFirst.lockPin'))}</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('#appLockUnlock').addEventListener('click', promptUnlock);
    el.querySelector('#appLockPin')?.addEventListener('click', promptUnlock);
  }
  return el;
}

function showLock() {
  const el = overlay();
  el.classList.add('show');
  document.body.classList.add('app-locked');
}
function hideLock() {
  document.getElementById('appLock')?.classList.remove('show');
  document.body.classList.remove('app-locked');
  document.documentElement.classList.remove('app-lock-pending');
}

function releaseBootPrivacyLock() {
  document.documentElement.classList.remove('app-lock-pending');
}

async function promptUnlock() {
  if (_verifying) return;
  _verifying = true;
  try {
    const ok = await verifyBiometric('Unlock BricksVault');
    if (ok) hideLock();
  } finally {
    // Small delay so the resume event fired when the OS prompt closes doesn't
    // immediately re-trigger a lock/unlock loop.
    setTimeout(() => { _verifying = false; }, 800);
  }
}

// Lock now and prompt. Returns nothing; overlay stays until a successful unlock.
export function lockAndPrompt() {
  showLock();
  promptUnlock();
}

// Called from app boot. If enabled + available, lock immediately and wire the
// background/resume re-lock. Safe to call on web / when disabled (no-op).
export async function initAppLock(win) {
  const appLockOn = (() => {
    try {
      return win?.localStorage?.getItem?.(ENABLED_KEY) === '1';
    } catch {
      return appLockEnabled();
    }
  })();
  try {
    await getCapacitorPlugin('SystemBars', win)?.setPrivacyProtection?.({ enabled: appLockOn });
  } catch { /* native privacy persistence must not strand boot */ }
  if (_wired || !isNativeCapacitor(win) || !appLockOn) {
    releaseBootPrivacyLock();
    return;
  }
  if (!(await biometricAvailable(win))) {
    // Sensor removed/disabled — don't strand the user behind the pre-render
    // privacy curtain. The native shell still protects Recents while enabled.
    releaseBootPrivacyLock();
    return;
  }
  _wired = true;

  lockAndPrompt();

  const App = getCapacitorPlugin('App', win);
  App?.addListener?.('appStateChange', ({ isActive } = {}) => {
    if (_verifying) return;
    if (!isActive) { _bgAt = Date.now(); return; }
    // Foregrounded: re-lock only after a meaningful time in the background.
    if (_bgAt && Date.now() - _bgAt > RELOCK_AFTER_MS && !document.getElementById('appLock')?.classList.contains('show')) {
      lockAndPrompt();
    }
    _bgAt = 0;
  });
}

export function resetAppLockForTests() {
  _wired = false;
  _verifying = false;
  _bgAt = 0;
}
