import type { Env } from '../types';

// ---------------------------------------------------------------------------
// At-rest encryption for long-lived third-party credentials (the Google Sheets
// refresh token can write to every spreadsheet the user owns). A D1 export or
// backup alone no longer hands those out.
//
// AES-GCM with a key derived (HKDF-SHA256) from TOKEN_ENCRYPTION_KEY, falling
// back to GOOGLE_CLIENT_SECRET so no new secret is needed to turn it on. Values
// written before this existed are plain text; `openSecret` returns them as-is,
// and they are sealed the next time the user reconnects.
// ---------------------------------------------------------------------------

const PREFIX = 'enc1:';

function keyMaterial(env: Env): string | null {
  return (env.TOKEN_ENCRYPTION_KEY || env.GOOGLE_CLIENT_SECRET || '').trim() || null;
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('bricksvault-token-v1'), info: new Uint8Array() },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), ch => ch.charCodeAt(0));
}

/** Encrypt a credential for storage. Without key material it is stored as-is. */
export async function sealSecret(env: Env, plain: string): Promise<string> {
  const secret = keyMaterial(env);
  if (!secret) return plain;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveKey(secret), new TextEncoder().encode(plain)));
  return `${PREFIX}${toB64(iv)}:${toB64(ct)}`;
}

/** Decrypt a stored credential; legacy plain-text values pass through. Throws if it cannot be opened. */
export async function openSecret(env: Env, stored: string): Promise<string> {
  if (!stored.startsWith(PREFIX)) return stored;
  const secret = keyMaterial(env);
  if (!secret) throw new Error('Stored credential is encrypted but no key is configured');
  const [ivB64, ctB64] = stored.slice(PREFIX.length).split(':');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(ivB64 || '') }, await deriveKey(secret), fromB64(ctB64 || ''));
  return new TextDecoder().decode(pt);
}
