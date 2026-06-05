import { state, invalidatePortfolio } from './state.js';
import { bvIDB, toast } from './utils.js';
import { jwtSub } from './lib/pure.js';

export let _authSession = null;
export let _sbUrl = "";
export let _sbAnonKey = "";
export let _swipeAc = null;

export function setSupabaseConfig(url, anonKey) {
  _sbUrl = url;
  _sbAnonKey = anonKey;
}

export function getSessionUserId() {
  return jwtSub(_authSession?.access_token);
}

/* ---------- Offline outbox (queue mutations for replay when back online) ---------- */
export const OUTBOX_KEY = 'bv_outbox';

export function outboxEnqueue(item) {
  try {
    const q = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
    q.push({ id: Date.now(), ...item });
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(q));
  } catch {}
}

export function outboxDequeue(id) {
  try {
    const q = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(q.filter(x => x.id !== id)));
  } catch {}
}

export async function drainOutbox() {
  try {
    const q = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
    if (!q.length) return;
    let synced = 0;
    for (const item of q) {
      await api(item.path, { method: item.method, ...(item.body ? { body: item.body } : {}) });
      outboxDequeue(item.id);
      synced++;
    }
    invalidatePortfolio();
    if (synced) toast(`${synced} offline action${synced > 1 ? 's' : ''} synced`, 'success');
  } catch {}
}

export function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem("bv_session") || "null");
    _authSession = s;
    return s;
  } catch {
    return null;
  }
}

export function saveSession(s) {
  const oldUid = getSessionUserId();
  try {
    if (s) localStorage.setItem("bv_session", JSON.stringify(s));
    else localStorage.removeItem("bv_session");
  } catch {}
  _authSession = s;
  const newUid = getSessionUserId();

  if (newUid !== oldUid) {
    state.portfolio = null;
    state.me = null;
    state.catalog.items = [];
    state.blind.items = [];
    state.wishlist = [];
    state.portfolioHistory = null;
    state.ownedFigs = new Set();
    state.detail.cache = {};
    
    // Clear user specific local DB
    bvIDB.del('portfolio').catch(() => {});
    bvIDB.del('catalog').catch(() => {});
    bvIDB.del('blind').catch(() => {});
    
    // Clear user specific localStorage
    localStorage.removeItem("bv_figs");
    localStorage.removeItem("bv_chat");
    localStorage.removeItem(OUTBOX_KEY);
  }
}

export async function sbSignIn(email, password) {
  const r = await fetch(`${_sbUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: _sbAnonKey },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json();
  if (!r.ok) {
    const msg = d.msg || d.error_description || (typeof d.error === 'string' ? d.error : (d.error && d.error.message)) || d.message || "Sign in failed";
    throw new Error(msg);
  }
  return d;
}

export async function sbSignUp(email, password) {
  const r = await fetch(`${_sbUrl}/auth/v1/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: _sbAnonKey },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json();
  if (!r.ok || d.error) {
    const msg = d.msg || d.error_description || (typeof d.error === 'string' ? d.error : (d.error && d.error.message)) || d.message || "Sign up failed";
    throw new Error(msg);
  }
  return d;
}

export async function sbRefresh(refreshToken) {
  const r = await fetch(`${_sbUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: _sbAnonKey },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const d = await r.json();
  if (!r.ok) {
    const msg = d.msg || d.error_description || (typeof d.error === 'string' ? d.error : (d.error && d.error.message)) || d.message || "Session expired";
    throw new Error(msg);
  }
  return d;
}

export async function sbSignOut() {
  if (!_authSession?.access_token) return;
  await fetch(`${_sbUrl}/auth/v1/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${_authSession.access_token}`, apikey: _sbAnonKey },
  }).catch(() => {});
  saveSession(null);
}

/* ---------- API ---------- */
export async function api(path, opts = {}) {
  const token = _authSession?.access_token;
  const streamMode = opts.stream === true;
  const geminiKey = localStorage.getItem('bv_gemini_key');
  const init = {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(geminiKey ? { "X-Gemini-Key": geminiKey } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  };
  delete init.stream;
  const _url = (window.WORKER_BASE || '') + path;
  let r;
  try {
    r = await fetch(_url, init);
  } catch (e) {
    if (!navigator.onLine && (init.method === "POST" || init.method === "PATCH" || init.method === "DELETE")) {
      outboxEnqueue({ path, method: init.method, body: opts.body });
      toast("Saved offline — will sync when connected", "info");
      return init.method === "DELETE" ? null : { item: opts.body || {} };
    }
    await new Promise(res => setTimeout(res, 600));
    try {
      r = await fetch(_url, init);
    } catch (e2) {
      if (init.method === "POST" || init.method === "PATCH" || init.method === "DELETE") {
        outboxEnqueue({ path, method: init.method, body: opts.body });
        toast("Saved offline — will sync when connected", "info");
        return init.method === "DELETE" ? null : { item: opts.body || {} };
      }
      throw e2;
    }
  }

  if (r.status === 401) {
    if (_authSession?.refresh_token) {
      try {
        const fresh = await sbRefresh(_authSession.refresh_token);
        saveSession(fresh);
        init.headers["Authorization"] = `Bearer ${fresh.access_token}`;
        r = await fetch(_url, init);
      } catch {
        saveSession(null);
        location.hash = "#/login";
        throw new Error("Session expired — please sign in again");
      }
    } else {
      saveSession(null);
      location.hash = "#/login";
      throw new Error("Please sign in");
    }
  }
  if (!r.ok) {
    let msg = r.statusText;
    try { const b = await r.json(); msg = b.error || msg; if (b.reason) msg += ': ' + b.reason; } catch {}
    throw new Error(msg);
  }
  if (r.status === 204) return null;
  if (streamMode) return r;
  return r.json();
}
