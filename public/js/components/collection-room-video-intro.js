const VIDEO_SRC = '/video/vault-door-intro.mp4';
const POSTER_SRC = '/video/vault-door-intro-poster.webp';
const START_TIMEOUT_MS = 3500;
const STALL_TIMEOUT_MS = 2200;
const HARD_TIMEOUT_MS = 8500;
const FADE_MS = 360;

function connectionIsConstrained(connection = navigator.connection || navigator.webkitConnection) {
  if (!connection) return false;
  return connection.saveData === true || /(^|-)2g$/.test(String(connection.effectiveType || ''));
}

export function shouldUseRoomVideoIntro({ initialPose, connection, reducedMotion } = {}) {
  const reduce = reducedMotion ?? window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  const connectionIsConstrained = Boolean(
    connection?.saveData === true ||
    (typeof connection?.effectiveType === 'string' && /(?:slow-2g|2g)/i.test(connection.effectiveType))
  );
  return !reduce && !connectionIsConstrained;
}

export function startRoomVideoIntro(stage, options = {}) {
  const isCurrent = typeof options.isCurrent === 'function' ? options.isCurrent : () => true;
  const onComplete = typeof options.onComplete === 'function' ? options.onComplete : () => {};
  const onFallback = typeof options.onFallback === 'function' ? options.onFallback : () => {};
  if (!stage?.isConnected || !isCurrent()) return null;

  const overlay = document.createElement('div');
  overlay.className = 'showroom-video-intro';
  overlay.dataset.videoIntroState = 'loading';
  overlay.innerHTML = `<video class="showroom-video-intro-media" muted playsinline preload="metadata" poster="${POSTER_SRC}" aria-hidden="true"></video><button type="button" class="showroom-video-intro-skip">${options.skipLabel || 'Skip'}</button>`;
  const video = overlay.querySelector('video');
  const skip = overlay.querySelector('button');
  stage.append(overlay);

  let settled = false;
  let destroyed = false;
  let started = false;
  let startTimer = 0;
  let stallTimer = 0;
  let hardTimer = 0;
  let fadeTimer = 0;
  let hardDeadline = 0;

  const clearTimers = () => {
    for (const timer of [startTimer, stallTimer, hardTimer, fadeTimer]) if (timer) clearTimeout(timer);
    startTimer = stallTimer = hardTimer = fadeTimer = 0;
  };
  const detach = () => {
    video.removeEventListener('playing', handlePlaying);
    video.removeEventListener('timeupdate', handleTimeUpdate);
    video.removeEventListener('waiting', handleWaiting);
    video.removeEventListener('stalled', handleWaiting);
    video.removeEventListener('ended', handleEnded);
    video.removeEventListener('error', handleError);
    skip.removeEventListener('click', handleSkip);
    document.removeEventListener('visibilitychange', handleVisibility);
  };
  const removeMedia = () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
    overlay.remove();
  };
  const finish = (kind) => {
    if (settled || destroyed || !isCurrent()) return;
    settled = true;
    clearTimers();
    detach();
    overlay.dataset.videoIntroState = kind;
    onComplete(kind);
    overlay.classList.add('is-leaving');
    fadeTimer = window.setTimeout(() => {
      fadeTimer = 0;
      if (!destroyed) removeMedia();
    }, FADE_MS);
  };
  const fallback = (reason) => {
    if (settled || destroyed) return;
    settled = true;
    clearTimers();
    detach();
    removeMedia();
    if (isCurrent()) onFallback(reason);
  };
  const armHardTimeout = (delay = HARD_TIMEOUT_MS) => {
    if (hardTimer) clearTimeout(hardTimer);
    hardDeadline = performance.now() + delay;
    hardTimer = window.setTimeout(() => fallback('hard-timeout'), delay);
  };
  function handlePlaying() {
    started = true;
    overlay.dataset.videoIntroState = 'playing';
    if (startTimer) clearTimeout(startTimer);
    startTimer = 0;
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = 0;
  }
  function handleTimeUpdate() {
    if (video.currentTime > 0.05) handlePlaying();
  }
  function handleWaiting() {
    if (!started || settled) return;
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = window.setTimeout(() => fallback('stall'), STALL_TIMEOUT_MS);
  }
  function handleEnded() { finish('ended'); }
  function handleError() { fallback('error'); }
  function handleSkip() { finish('skipped'); }
  function handleVisibility() {
    if (document.hidden) {
      if (startTimer) clearTimeout(startTimer);
      if (stallTimer) clearTimeout(stallTimer);
      if (hardTimer) clearTimeout(hardTimer);
      startTimer = stallTimer = hardTimer = 0;
      video.pause();
      return;
    }
    if (settled || destroyed || !isCurrent()) return;
    if (!started) startTimer = window.setTimeout(() => fallback('start-timeout'), START_TIMEOUT_MS);
    const remaining = Math.max(250, hardDeadline - performance.now());
    armHardTimeout(remaining);
    Promise.resolve(video.play()).catch(() => fallback('play-rejected'));
  }

  video.addEventListener('playing', handlePlaying);
  video.addEventListener('timeupdate', handleTimeUpdate);
  video.addEventListener('waiting', handleWaiting);
  video.addEventListener('stalled', handleWaiting);
  video.addEventListener('ended', handleEnded);
  video.addEventListener('error', handleError);
  skip.addEventListener('click', handleSkip);
  document.addEventListener('visibilitychange', handleVisibility);
  video.src = VIDEO_SRC;
  startTimer = window.setTimeout(() => fallback('start-timeout'), START_TIMEOUT_MS);
  armHardTimeout();
  Promise.resolve(video.play()).catch(() => fallback('play-rejected'));

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimers();
      detach();
      removeMedia();
    },
  };
}

export const ROOM_VIDEO_INTRO_ASSETS = { poster: POSTER_SRC, video: VIDEO_SRC };
