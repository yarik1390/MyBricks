// Google Play Integrity for the Android app's scan path.
//
// The Turnstile bot check can't run inside the bundled WebView, so signed-in
// Android scans skip it. The "android" platform header alone is spoofable, so
// the app can prove it is the genuine Play build on a real device:
//   1. POST /api/attest/nonce   → short-lived, HMAC-signed nonce bound to the user
//   2. the app asks Play Integrity for a token carrying that nonce
//   3. POST /api/attest/android → we decode it with Google and, if the app is
//      Play-recognized on a device that meets basic integrity, return a 24 h
//      attestation (HMAC over user + expiry) the app sends as
//      X-Brickvault-Attestation.
// Enforcement is a separate switch (PLAY_INTEGRITY_ENFORCED=1) so the app
// update can roll out first. Everything fails closed to "not attested", which
// only matters once enforcement is on.

import type { Env } from '../types';

export const PACKAGE_NAME = 'app.bricksvault';
const NONCE_TTL_S = 10 * 60;
export const ATTESTATION_TTL_S = 24 * 60 * 60;

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function secretOf(env: Env): string {
  return env.ATTESTATION_SECRET || env.SUPABASE_JWT_SECRET || '';
}

async function hmac(env: Env, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(`attest:${secretOf(env)}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message))));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface ServiceAccount { client_email: string; private_key: string; project_id?: string }

function parseServiceAccount(raw?: string): ServiceAccount | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<ServiceAccount>;
    return p.client_email && p.private_key ? (p as ServiceAccount) : null;
  } catch {
    return null;
  }
}

export function playIntegrityConfigured(env: Env): boolean {
  return !!secretOf(env) && parseServiceAccount(env.PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON) !== null;
}

export function playIntegrityEnforced(env: Env): boolean {
  return env.PLAY_INTEGRITY_ENFORCED === '1' && playIntegrityConfigured(env);
}

// ── nonce ────────────────────────────────────────────────────────────────────
// Format (URL-safe, 16-500 chars as Play requires): <ts>.<rand>.<sig>, where
// sig = HMAC(user|ts|rand). Stateless: no D1 write per attestation.

export async function issueNonce(env: Env, userId: string, now = Date.now()): Promise<string> {
  const ts = Math.floor(now / 1000);
  const rand = base64Url(crypto.getRandomValues(new Uint8Array(12)));
  return `${ts}.${rand}.${await hmac(env, `nonce|${userId}|${ts}|${rand}`)}`;
}

export async function nonceValid(env: Env, userId: string, nonce: unknown, now = Date.now()): Promise<boolean> {
  if (typeof nonce !== 'string' || nonce.length > 200) return false;
  const [ts, rand, sig] = nonce.split('.');
  if (!ts || !rand || !sig || !/^\d+$/.test(ts)) return false;
  const age = Math.floor(now / 1000) - Number(ts);
  if (age < -60 || age > NONCE_TTL_S) return false;
  return safeEqual(sig, await hmac(env, `nonce|${userId}|${ts}|${rand}`));
}

// ── attestation token ────────────────────────────────────────────────────────

export async function issueAttestation(env: Env, userId: string, now = Date.now()): Promise<{ token: string; expires_at: number }> {
  const exp = Math.floor(now / 1000) + ATTESTATION_TTL_S;
  return { token: `${exp}.${await hmac(env, `att|${userId}|${exp}`)}`, expires_at: exp };
}

export async function attestationValid(env: Env, userId: string | undefined, token: string | undefined, now = Date.now()): Promise<boolean> {
  if (!userId || !token || token.length > 200 || !secretOf(env)) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Math.floor(now / 1000)) return false;
  return safeEqual(sig, await hmac(env, `att|${userId}|${exp}`));
}

// ── Google decode ────────────────────────────────────────────────────────────

let cachedAccess: { token: string; expiresAt: number; email: string } | null = null;

function privateKeyBytes(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s/g, '');
  return Uint8Array.from(atob(body), (ch) => ch.charCodeAt(0));
}

async function accessToken(account: ServiceAccount): Promise<string> {
  if (cachedAccess && cachedAccess.email === account.client_email && cachedAccess.expiresAt > Date.now() + 60_000) return cachedAccess.token;
  const now = Math.floor(Date.now() / 1000);
  const enc = (v: unknown) => base64Url(encoder.encode(JSON.stringify(v)));
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/playintegrity',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const key = await crypto.subtle.importKey('pkcs8', privateKeyBytes(account.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned)));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${base64Url(sig)}` }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Play Integrity OAuth failed (${res.status})`);
  const out = await res.json<{ access_token?: string; expires_in?: number }>();
  if (!out.access_token) throw new Error('Play Integrity OAuth returned no token');
  cachedAccess = { token: out.access_token, expiresAt: Date.now() + Math.max(60, out.expires_in || 3600) * 1000, email: account.client_email };
  return out.access_token;
}

export interface IntegrityPayload {
  requestDetails?: { requestPackageName?: string; nonce?: string; timestampMillis?: string };
  appIntegrity?: { appRecognitionVerdict?: string; packageName?: string };
  deviceIntegrity?: { deviceRecognitionVerdict?: string[] };
}

/** Pure verdict check (unit-tested): why a decoded payload fails, or null. */
export function integrityProblem(payload: IntegrityPayload | null | undefined): string | null {
  if (!payload) return 'no payload';
  if (payload.requestDetails?.requestPackageName !== PACKAGE_NAME) return 'wrong package';
  if (payload.appIntegrity?.appRecognitionVerdict !== 'PLAY_RECOGNIZED') return `app ${payload.appIntegrity?.appRecognitionVerdict || 'unknown'}`;
  const device = payload.deviceIntegrity?.deviceRecognitionVerdict || [];
  if (!device.includes('MEETS_DEVICE_INTEGRITY') && !device.includes('MEETS_STRONG_INTEGRITY')) return 'device integrity';
  return null;
}

/** Ask Google to decrypt + verify a token. Null on any failure. */
export async function decodeIntegrityToken(env: Env, integrityToken: string): Promise<IntegrityPayload | null> {
  const account = parseServiceAccount(env.PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON);
  if (!account) return null;
  try {
    const res = await fetch(`https://playintegrity.googleapis.com/v1/${PACKAGE_NAME}:decodeIntegrityToken`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken(account)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ integrity_token: integrityToken }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn(`[attest] decode failed: ${res.status}`);
      return null;
    }
    const out = await res.json<{ tokenPayloadExternal?: IntegrityPayload }>();
    return out.tokenPayloadExternal || null;
  } catch (e) {
    console.warn(`[attest] decode error: ${(e as Error).message}`);
    return null;
  }
}
