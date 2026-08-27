const EDGE_TOLERANCE_PX = 1;

export function horizontalRailState({ scrollLeft = 0, scrollWidth = 0, clientWidth = 0 } = {}) {
  const maxScroll = Math.max(0, Number(scrollWidth) - Number(clientWidth));
  const left = Math.max(0, Number(scrollLeft));
  return {
    canScrollLeft: left > EDGE_TOLERANCE_PX,
    canScrollRight: maxScroll - left > EDGE_TOLERANCE_PX,
  };
}

export function wireHorizontalRail(rail) {
  if (!rail) return () => {};
  const sync = () => {
    const state = horizontalRailState(rail);
    rail.classList.toggle('can-scroll-left', state.canScrollLeft);
    rail.classList.toggle('can-scroll-right', state.canScrollRight);
    rail.dataset.scrollable = state.canScrollLeft || state.canScrollRight ? 'true' : 'false';
  };
  rail.addEventListener('scroll', sync, { passive: true });
  const ResizeObserverImpl = rail.ownerDocument?.defaultView?.ResizeObserver ?? globalThis.ResizeObserver;
  const observer = typeof ResizeObserverImpl === 'function' ? new ResizeObserverImpl(sync) : null;
  observer?.observe(rail);
  const schedule = rail.ownerDocument?.defaultView?.requestAnimationFrame ?? globalThis.requestAnimationFrame;
  if (typeof schedule === 'function') schedule(sync);
  else sync();
  return () => {
    rail.removeEventListener('scroll', sync);
    observer?.disconnect();
  };
}
