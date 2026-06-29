// Runs synchronously in <head> before the stylesheet so the saved theme is
// applied pre-paint (no flash of the wrong theme). Kept tiny and dependency-free.
// A separate file (not inline) because the page CSP is script-src 'self'.
(function () {
  try {
    var SKINS = ['modular', 'vivid', 'premium', 'gold', 'kids'];
    var pref = localStorage.getItem('bv_theme') || 'auto';
    var dark = pref === 'dark' ||
      (pref !== 'light' && window.matchMedia &&
       window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    var skin = localStorage.getItem('bv_skin');
    if (SKINS.indexOf(skin) !== -1) {
      document.documentElement.dataset.skin = skin;
    }
    var mode = localStorage.getItem('bv_mode');
    if (mode === 'simple') {
      document.documentElement.dataset.mode = 'simple';
    } else if (mode === 'kids') {
      document.documentElement.dataset.mode = 'kids';
      document.documentElement.dataset.skin = 'kids';
    }
  } catch (e) {}
})();
