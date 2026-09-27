// Native App Lock privacy curtain. Runs synchronously in <head>, before styles
// and the module boot graph, so persisted portfolio content cannot paint while
// biometric capability is still being checked. A separate file (not inline)
// because the page CSP is script-src 'self' — the inline version never ran.
// Mirrors applyBootPrivacyLock() in js/lib/app-lock-boot.js.
(function () {
  try {
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()
      && localStorage.getItem('bv_app_lock') === '1') {
      document.documentElement.classList.add('app-lock-pending');
    }
  } catch (e) { /* storage blocked: the lock screen still runs after boot */ }
})();
