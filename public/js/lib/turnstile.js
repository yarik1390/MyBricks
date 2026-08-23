const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise;

export class TurnstileChallengeError extends Error {
  constructor(code) {
    super(code);
    this.name = 'TurnstileChallengeError';
    this.code = code;
  }
}

function loadTurnstile(windowRef, documentRef) {
  if (windowRef.turnstile) return Promise.resolve(windowRef.turnstile);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = documentRef.querySelector?.('script[data-mybricks-turnstile]');
    const script = existing || documentRef.createElement('script');
    const onLoad = () => windowRef.turnstile
      ? resolve(windowRef.turnstile)
      : reject(new TurnstileChallengeError('challenge_unavailable'));
    const onError = () => reject(new TurnstileChallengeError('challenge_unavailable'));

    script.addEventListener?.('load', onLoad, { once: true });
    script.addEventListener?.('error', onError, { once: true });
    // Support the small DOM harness used by the unit tests as well as browsers.
    script.onload = onLoad;
    script.onerror = onError;

    if (!existing) {
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.dataset.mybricksTurnstile = 'true';
      documentRef.head.appendChild(script);
    }
  }).catch(error => {
    scriptPromise = undefined;
    throw error;
  });

  return scriptPromise;
}

export async function getTurnstileToken(siteKey, {
  windowRef = globalThis.window,
  documentRef = globalThis.document,
  timeoutMs = 20_000,
} = {}) {
  if (!siteKey) return null;
  if (!windowRef || !documentRef?.head || !documentRef?.body) {
    throw new TurnstileChallengeError('challenge_unavailable');
  }

  const turnstile = await loadTurnstile(windowRef, documentRef);
  const container = documentRef.createElement('div');
  container.className = 'turnstile-challenge';
  container.setAttribute('aria-hidden', 'true');
  documentRef.body.appendChild(container);

  let widgetId;
  let timer;
  const cleanup = () => {
    clearTimeout(timer);
    if (widgetId !== undefined) {
      try { turnstile.remove(widgetId); } catch { /* Widget may already be gone. */ }
    }
    if (container.parentNode) container.parentNode.removeChild(container);
    else container.remove?.();
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, token) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(token);
    };

    timer = setTimeout(
      () => finish(new TurnstileChallengeError('challenge_unavailable')),
      timeoutMs,
    );

    try {
      widgetId = turnstile.render(container, {
        sitekey: siteKey,
        size: 'invisible',
        callback: token => finish(null, token),
        'error-callback': () => finish(new TurnstileChallengeError('challenge_failed')),
        'expired-callback': () => finish(new TurnstileChallengeError('challenge_failed')),
        'timeout-callback': () => finish(new TurnstileChallengeError('challenge_unavailable')),
      });
    } catch {
      finish(new TurnstileChallengeError('challenge_unavailable'));
    }
  });
}
