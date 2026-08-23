const PERSIST_PREFIX = 'bv_';
const SESSION_PREFIX = 'bv_session_';

export function getProviderCredential(name) {
  const persistentKey = `${PERSIST_PREFIX}${name}_key`;
  const sessionKey = `${SESSION_PREFIX}${name}_key`;
  try { return sessionStorage.getItem(sessionKey) || localStorage.getItem(persistentKey) || ''; }
  catch { return ''; }
}

export function setProviderCredential(name, value, remember = false) {
  const persistentKey = `${PERSIST_PREFIX}${name}_key`;
  const sessionKey = `${SESSION_PREFIX}${name}_key`;
  try {
    localStorage.removeItem(persistentKey);
    sessionStorage.removeItem(sessionKey);
    if (!value) return;
    (remember ? localStorage : sessionStorage).setItem(remember ? persistentKey : sessionKey, value);
  } catch {}
}

export function hasPersistentProviderCredential(name) {
  try { return !!localStorage.getItem(`${PERSIST_PREFIX}${name}_key`); }
  catch { return false; }
}
