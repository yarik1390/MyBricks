// Optional biometric app-lock. When enabled, the installed app requires a
// fingerprint (or the device PIN/pattern fallback) to open, and re-locks after
// being in the background for a while. Protects the vault/portfolio on a shared
// or lost device. Web build: no-op.
import { getCapacitorPlugin, isNativeCapacitor } from './native-auth.js';
import { biometricAvailable, verifyBiometric } from './native-biometric.js';
import { APP_LOCK_ENABLED_KEY } from './app-lock-boot.js';

const ENABLED_KEY = APP_LOCK_ENABLED_KEY;
const RELOCK_AFTER_MS = 15_000; // re-lock only after a real backgrounding, not a quick app-switch

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
    el.setAttribute('aria-label', 'App locked');
    el.innerHTML = `
      <div class="app-lock-inner">
        <div class="app-lock-mark">🔒</div>
        <div class="app-lock-title">BricksVault is locked</div>
        <button type="button" class="btn-primary app-lock-btn" id="appLockUnlock">Unlock</button>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('#appLockUnlock').addEventListener('click', promptUnlock);
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
