// Play Integrity attestation for the Android app's scans (server side:
// worker/src/lib/play-integrity.ts). Before a scan, the native app makes sure
// it holds a fresh attestation and sends it as X-Brickvault-Attestation.
// Best-effort everywhere: any failure just means no header, which only matters
// once the server enforces it. While the server has it switched off we ask
// again at most every 12 hours.

const KEY = 'bv_play_attest_v1';
const REFRESH_BEFORE_S = 2 * 3600;
const DISABLED_RECHECK_S = 12 * 3600;
const FAILED_RETRY_S = 15 * 60;

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function write(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage blocked */ }
}

/** The stored attestation token for this user, if still valid. */
export function currentAttestation(userId, now = Date.now() / 1000) {
  const s = read();
  return s && s.user === userId && s.token && s.exp > now ? s.token : '';
}

let inflight = null;

/**
 * Make sure a fresh attestation is stored. `call(path, opts)` is api(),
 * `plugin` the native PlayIntegrity plugin (null on web).
 */
export function ensureAttestation(userId, call, plugin, now = Date.now() / 1000) {
  if (!userId || !plugin?.requestToken) return Promise.resolve('');
  const s = read();
  if (s && s.user === userId) {
    if (s.token && s.exp - now > REFRESH_BEFORE_S) return Promise.resolve(s.token);
    if (!s.token && s.retryAt > now) return Promise.resolve(currentAttestation(userId, now));
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const n = await call('/api/attest/nonce', { method: 'POST', body: {} });
      if (!n?.enabled || !n.nonce) {
        write({ user: userId, retryAt: now + DISABLED_RECHECK_S });
        return '';
      }
      const { token } = await plugin.requestToken({ nonce: n.nonce });
      const a = await call('/api/attest/android', { method: 'POST', body: { token } });
      if (a?.token && a.expires_at) {
        write({ user: userId, token: a.token, exp: a.expires_at });
        return a.token;
      }
    } catch { /* fall through */ }
    write({ ...(read() || {}), user: userId, retryAt: now + FAILED_RETRY_S });
    return currentAttestation(userId, now);
  })().finally(() => { inflight = null; });
  return inflight;
}
