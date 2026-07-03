// Runs synchronously in <head> (after app.css) so the saved theme + active skin
// are applied pre-paint (no flash of the wrong theme), and loads Google Fonts
// non-render-blocking. A separate file (not inline) because the page CSP is
// script-src 'self'. Kept tiny and dependency-free.
(function () {
  try {
    var SKINS = ['modular', 'vivid', 'premium', 'gold', 'kids'];
    var pref = localStorage.getItem('bv_theme') || 'auto';
    var dark = pref === 'dark' ||
      (pref !== 'light' && window.matchMedia &&
       window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    var skin = localStorage.getItem('bv_skin');
    var activeSkin = null;
    if (SKINS.indexOf(skin) !== -1) {
      document.documentElement.dataset.skin = skin;
      activeSkin = skin;
    }
    var mode = localStorage.getItem('bv_mode');
    if (mode === 'simple') {
      document.documentElement.dataset.mode = 'simple';
    } else if (mode === 'kids') {
      document.documentElement.dataset.mode = 'kids';
      document.documentElement.dataset.skin = 'kids';
      activeSkin = 'kids';
    }

    // Load ONLY the active skin (render-blocking, correct cascade) instead of all
    // five. Default theme (no skin) fetches nothing. #bvSkin sits after app.css.
    if (activeSkin) {
      var sk = document.getElementById('bvSkin');
      if (sk) sk.href = '/skin-' + activeSkin + '.css';
    }

    // Google Fonts, loaded NON-render-blocking (media="print" → "all" once loaded).
    // The font CSS already uses display=swap, so text paints immediately in a
    // fallback and swaps in when the web fonts arrive — no FCP/LCP hit from the
    // cross-origin font chain. Programmatic listener (no inline handler) keeps it
    // CSP-compliant.
    var f = document.createElement('link');
    f.rel = 'stylesheet';
    f.href = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,500&family=Geist:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Spectral:wght@400;500;600&family=Baloo+2:wght@500;600;700;800&display=swap';
    f.media = 'print';
    f.addEventListener('load', function () { this.media = 'all'; });
    document.head.appendChild(f);
  } catch (e) {}
})();
