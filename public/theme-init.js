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
    var ua = navigator.userAgent || '';
    var isAndroidWebView = /Android/i.test(ua) && /\bwv\b/i.test(ua);
    var isNative = isAndroidWebView || !!(window.Capacitor && (
      typeof window.Capacitor.isNativePlatform === 'function'
        ? window.Capacitor.isNativePlatform()
        : window.Capacitor.platform
    ));
    if (isNative) {
      document.documentElement.dataset.nativeShell = isAndroidWebView ? 'android' : 'native';
    }
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

    // Web fonts, self-hosted under /fonts (no request to Google, so no visitor
    // IP goes to a third party; legal review 2026-11-08). Loaded NON-render-
    // blocking (media="print" → "all" once loaded); the @font-face rules use
    // font-display: swap, so text paints at once in a fallback face. The
    // programmatic listener (no inline handler) keeps it CSP-compliant.
    var f = document.createElement('link');
    f.rel = 'stylesheet';
    f.href = '/fonts/fonts-v1.css';
    f.media = 'print';
    f.addEventListener('load', function () { this.media = 'all'; });
    document.head.appendChild(f);

    // Pre-paint shell setup, so nothing jumps once app.js boots:
    //  - the 2026 shell class (collector-ui) is on <body> from its first
    //    paint, so the desktop sidebar and phone tab bar never restyle under a
    //    painted page (Kids Mode keeps its own shell);
    //  - a first-ever visit to the Vault goes straight to the welcome screen
    //    (#/welcome, full screen, no nav) instead of painting the Vault and
    //    then swapping it out, which was the slowest part of a first load.
    //    bv_setup_v1 is the flag views/welcome.js sets when it finishes. A query
    //    string means an OAuth return (?code=) or a share target: app.js
    //    handles those;
    //  - the first view's module is preloaded so it downloads alongside
    //    app.js instead of after it.
    var kids = mode === 'kids';
    var bodyClasses = kids ? [] : ['collector-ui'];
    var hash = location.hash;
    var onVault = hash === '' || hash === '#' || hash === '#/';
    if (onVault && !kids && !location.search && !localStorage.getItem('bv_setup_v1')) {
      history.replaceState(history.state, '', '#/welcome');
      hash = '#/welcome';
      onVault = false;
    }
    var welcome = hash.indexOf('#/welcome') === 0;
    // The welcome screen is full screen with no nav (route-meta.js); set that
    // now so the nav never paints and then disappears under it.
    if (welcome && !kids) bodyClasses.push('bv-nav-off', 'bv-fullscreen');
    var view = welcome ? 'welcome' : onVault && !kids ? 'portfolio' : '';
    if (view) {
      var mp = document.createElement('link');
      mp.rel = 'modulepreload';
      mp.href = '/js/views/' + view + '.js';
      document.head.appendChild(mp);
    }
    // <body> does not exist yet (this runs in <head>). A MutationObserver
    // callback is a microtask, so it runs before the browser can paint the
    // body it just parsed.
    if (bodyClasses.length) {
      var addBody = function () {
        if (!document.body) return false;
        for (var c = 0; c < bodyClasses.length; c++) document.body.classList.add(bodyClasses[c]);
        return true;
      };
      if (!addBody()) {
        var mo = new MutationObserver(function () { if (addBody()) mo.disconnect(); });
        mo.observe(document.documentElement, { childList: true });
      }
    }
  } catch (e) {}
})();
