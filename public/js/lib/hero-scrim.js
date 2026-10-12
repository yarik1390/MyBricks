// The set page hero runs under the status bar. The solid status-bar scrim
// (index.html #statusBarScrim) would paint a cream strip over the hero's tint,
// so while the hero still reaches the bar the scrim steps aside; once the hero
// has scrolled under it the scrim comes back to keep content off the icons.
// The hero fades into the page background at its bottom edge, so the hand-off
// is seamless. One passive listener for the app's lifetime.
let installed = false;
let ticking = false;

export function syncHeroScrim() {
  const hero = document.querySelector(".bv-sethero");
  const scrim = document.getElementById("statusBarScrim");
  const barH = scrim ? scrim.getBoundingClientRect().height : 0;
  document.body.classList.toggle("hero-under-bar", !!hero && hero.getBoundingClientRect().bottom > barH + 1);
}

export function installHeroScrim() {
  syncHeroScrim();
  if (installed) return;
  installed = true;
  document.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; syncHeroScrim(); });
  }, { passive: true });
}
