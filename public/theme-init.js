// Runs synchronously in <head> before the stylesheet so the saved theme is
// applied pre-paint (no flash of the wrong theme). Kept tiny and dependency-free.
// A separate file (not inline) because the page CSP is script-src 'self'.
(function () {
  try {
    var pref = localStorage.getItem('bv_theme') || 'auto';
    var dark = pref === 'dark' ||
      (pref !== 'light' && window.matchMedia &&
       window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    var skin = localStorage.getItem('bv_skin');
    if (skin === 'premium' || skin === 'gold') {
      document.documentElement.dataset.skin = skin;
    }
  } catch (e) {}
})();
