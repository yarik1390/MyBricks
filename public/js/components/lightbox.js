// Minimal in-app image lightbox — fullscreen viewer with swipe / arrow / key
// navigation. Used by the set-detail Photos gallery so extra images open
// inside the app instead of kicking the user out to the browser.
//
// History contract: opening pushes one same-URL history entry and closing
// consumes it, so the Android hardware back button (and browser Back) closes
// the viewer instead of leaving the page. The router only listens to
// `hashchange`, and the URL never changes, so no re-render is triggered.

let lb = null; // { el, images, index, onPop }

export function openLightbox(images, startIndex = 0) {
  if (!Array.isArray(images) || !images.length || lb) return;

  const el = document.createElement("div");
  el.className = "lightbox";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Image viewer");
  el.innerHTML = `
    <button class="lb-close" aria-label="Close image viewer">&#x2715;</button>
    <div class="lb-count" aria-live="polite"></div>
    <div class="lb-stage"><img class="lb-img" alt="Set photo"></div>
    ${images.length > 1 ? `
      <button class="lb-nav lb-prev" aria-label="Previous image">&#x2039;</button>
      <button class="lb-nav lb-next" aria-label="Next image">&#x203A;</button>` : ""}
  `;
  document.body.appendChild(el);
  document.body.classList.add("lightbox-open");

  const onPop = () => close(false);
  lb = { el, images, index: 0, onPop };
  history.pushState({ lightbox: true }, "", location.href);
  window.addEventListener("popstate", onPop);
  window.addEventListener("keydown", onKey);

  el.querySelector(".lb-close").addEventListener("click", () => close(true));
  // Backdrop tap closes; taps on the image / buttons don't.
  el.addEventListener("click", (e) => {
    if (e.target === el || e.target.classList.contains("lb-stage")) close(true);
  });
  el.querySelector(".lb-prev")?.addEventListener("click", () => show(lb.index - 1));
  el.querySelector(".lb-next")?.addEventListener("click", () => show(lb.index + 1));

  // Horizontal swipe between images (ignore mostly-vertical gestures).
  let sx = 0, sy = 0;
  el.addEventListener("touchstart", (e) => {
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) show(lb.index + (dx < 0 ? 1 : -1));
  }, { passive: true });

  show(startIndex);
  el.querySelector(".lb-close").focus();
}

function show(i) {
  if (!lb) return;
  const n = lb.images.length;
  lb.index = ((i % n) + n) % n; // wrap around
  const img = lb.el.querySelector(".lb-img");
  img.src = lb.images[lb.index];
  const count = lb.el.querySelector(".lb-count");
  count.textContent = n > 1 ? `${lb.index + 1} / ${n}` : "";
  // Warm the neighbours so swiping feels instant.
  if (n > 1) [lb.index + 1, lb.index - 1].forEach((j) => {
    new Image().src = lb.images[((j % n) + n) % n];
  });
}

function onKey(e) {
  if (!lb) return;
  if (e.key === "Escape") { e.preventDefault(); close(true); }
  else if (e.key === "ArrowLeft") show(lb.index - 1);
  else if (e.key === "ArrowRight") show(lb.index + 1);
}

// popHistory=true → user closed in-app, so consume the entry we pushed;
// popHistory=false → back button already popped it (we're inside popstate).
function close(popHistory) {
  if (!lb) return;
  const { el, onPop } = lb;
  lb = null;
  window.removeEventListener("popstate", onPop);
  window.removeEventListener("keydown", onKey);
  document.body.classList.remove("lightbox-open");
  el.remove();
  if (popHistory) history.back();
}
