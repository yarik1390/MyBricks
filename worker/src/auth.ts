import type { Context, Next } from 'hono';
import type { Env, Variables } from './types';

type C = Context<{ Bindings: Env; Variables: Variables }>;

// JWKS (public signing keys) cache. Supabase mints ES256 tokens here, so EVERY
// authenticated request takes the asymmetric path below and needs these keys.
//
// The module-level cache alone is per-ISOLATE: on a low-traffic Worker isolates
// recycle constantly, so a large share of requests were paying a live fetch to
// Supabase on the critical path — latency the user sees on every page. KV is the
// shared L2 (one copy per colo, refreshed hourly) so a cold isolate costs a KV
// read instead of a round trip to another provider.
let _jwksCache: any[] | null = null;
let _jwksFetchedAt = 0;
const JWKS_TTL_MS = 3_600_000;
const JWKS_KV_KEY = 'auth:jwks:v1';

// Imported CryptoKeys, keyed by `${kid}:${alg}`. importKey is pure CPU but runs
// on every authenticated request otherwise, and the key material never changes
// for a given kid. Per-isolate, bounded by the number of signing keys Supabase
// publishes (a handful).
const _cryptoKeys = new Map<string, CryptoKey>();

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}

function b64urlJson(s: string): any {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(s)));
}

async function getJWKS(env: Env): Promise<any[]> {
  const now = Date.now();
  if (_jwksCache && now - _jwksFetchedAt < JWKS_TTL_MS) return _jwksCache;

  // L2: KV, shared by every isolate in the colo. Failing open here just means
  // falling through to the origin fetch below — never a failed login.
  if (env.CACHE_KV) {
    const cached = await env.CACHE_KV.get<{ keys?: any[] }>(JWKS_KV_KEY, 'json').catch(() => null);
    if (cached?.keys?.length) {
      _jwksCache = cached.keys;
      _jwksFetchedAt = now;
      return _jwksCache;
    }
  }

  const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
  if (!resp.ok) throw new Error(`jwks fetch failed: ${resp.status}`);
  const data = await resp.json<{ keys?: any[] }>();
  _jwksCache = data.keys || [];
  _jwksFetchedAt = now;
  if (env.CACHE_KV && _jwksCache.length) {
    // TTL slightly over the in-memory window so the two layers do not expire in
    // lockstep and stampede Supabase together.
    await env.CACHE_KV.put(JWKS_KV_KEY, JSON.stringify({ keys: _jwksCache }), { expirationTtl: 4200 })
      .catch(() => {});
  }
  return _jwksCache;
}

/** Import (and memoise) the verification key for a JWKS entry. */
async function getCryptoKey(jwk: any, alg: string, importAlgo: any): Promise<CryptoKey> {
  const cacheKey = `${jwk.kid}:${alg}`;
  const hit = _cryptoKeys.get(cacheKey);
  if (hit) return hit;
  const key = await crypto.subtle.importKey('jwk', jwk, importAlgo, false, ['verify']);
  _cryptoKeys.set(cacheKey, key);
  return key;
}

// Returns the user id (sub) and email if the token is valid, else { error }.
async function verifyJWT(token: string, env: Env): Promise<{ sub?: string; email?: string; error?: string }> {
  const parts = token.split('.');
  if (parts.length !== 3) return { error: 'malformed token' };

  let header: any, payload: any;
  try {
    header = b64urlJson(parts[0]);
    payload = b64urlJson(parts[1]);
  } catch {
    return { error: 'undecodable token' };
  }

  const nowSeconds = Date.now() / 1000;
  if (payload.exp && payload.exp < nowSeconds) return { error: 'expired token' };
  // RFC 7519 nbf: reject only a PRESENT, finite nbf in the future beyond 60s of
  // clock skew. Absent nbf (common for Supabase sessions) always passes.
  if (payload.nbf && typeof payload.nbf === 'number' && Number.isFinite(payload.nbf) && payload.nbf > nowSeconds + 60) return { error: 'token not active yet' };
  if (payload.role !== 'authenticated') return { error: 'not an authenticated role' };
  // Defence-in-depth beyond the signature: reject a token minted for a different
  // audience. Lenient — only reject a PRESENT, wrong `aud` so tokens lacking the
  // claim still pass (no lockout risk). Supabase user access tokens use
  // aud='authenticated'.
  const aud = payload.aud;
  if (aud != null && (Array.isArray(aud) ? !aud.includes('authenticated') : aud !== 'authenticated')) {
    return { error: 'wrong audience' };
  }
  // Issuer (`iss`) check — ENFORCED. Supabase mints iss=`${SUPABASE_URL}/auth/v1`.
  // This ran log-only long enough to confirm the live issuer matches; the
  // signature check is the real gate, so this is defence-in-depth against a
  // token minted for a different Supabase project with a shared/leaked secret.
  if (payload.iss && env.SUPABASE_URL) {
    const expectedIss = `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;
    if (payload.iss !== expectedIss) {
      console.warn(`[auth] JWT iss mismatch: token iss=${payload.iss} expected=${expectedIss}`);
      return { error: 'wrong issuer' };
    }
  }

  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const sig = b64urlDecode(parts[2]);

  try {
    if (header.alg === 'HS256') {
      if (!env.SUPABASE_JWT_SECRET) return { error: 'HS256 token but no JWT secret configured' };
      const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(env.SUPABASE_JWT_SECRET),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
      );
      const ok = await crypto.subtle.verify('HMAC', key, sig, signed);
      return ok ? { sub: payload.sub, email: payload.email } : { error: 'HS256 signature mismatch' };
    }

    // Asymmetric (ES256 / RS256) — verify against the project's public JWKS.
    const keys = await getJWKS(env);
    const jwk = keys.find(k => k.kid === header.kid);
    if (!jwk) return { error: `no JWKS key for kid ${header.kid}` };

    let importAlgo: any, verifyAlgo: any;
    if (header.alg === 'ES256') {
      importAlgo = { name: 'ECDSA', namedCurve: 'P-256' };
      verifyAlgo = { name: 'ECDSA', hash: 'SHA-256' };
    } else if (header.alg === 'RS256') {
      importAlgo = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
      verifyAlgo = { name: 'RSASSA-PKCS1-v1_5' };
    } else {
      return { error: `unsupported alg ${header.alg}` };
    }

    const cryptoKey = await getCryptoKey(jwk, header.alg, importAlgo);
    const ok = await crypto.subtle.verify(verifyAlgo, cryptoKey, sig, signed);
    return ok ? { sub: payload.sub, email: payload.email } : { error: `${header.alg} signature mismatch` };
  } catch (e) {
    return { error: `verify error: ${(e as Error).message}` };
  }
}

export async function requireMember(c: C, next: Next) {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'Unauthorized', reason: 'no token' }, 401);
  const { sub, email, error } = await verifyJWT(token, c.env);
  if (!sub) return c.json({ error: 'Unauthorized', reason: error }, 401);
  c.set('userId', sub);
  if (email) c.set('userEmail', email);
  await next();
}

export async function optionalMember(c: C, next: Next) {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    await next();
    return;
  }
  const { sub, email, error } = await verifyJWT(token, c.env);
  if (!sub) return c.json({ error: 'Unauthorized', reason: error }, 401);
  c.set('userId', sub);
  if (email) c.set('userEmail', email);
  await next();
}

export async function requireAdmin(c: C, next: Next) {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'Unauthorized', reason: 'no token' }, 401);
  const { sub, error } = await verifyJWT(token, c.env);
  if (!sub) return c.json({ error: 'Unauthorized', reason: error }, 401);
  if (sub !== c.env.ADMIN_USER_ID) return c.json({ error: 'Forbidden' }, 403);
  c.set('userId', sub);
  await next();
}
