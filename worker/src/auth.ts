import type { Context, Next } from 'hono';
import type { Env, Variables } from './types';

type C = Context<{ Bindings: Env; Variables: Variables }>;

// Cache the JWKS (public signing keys) to avoid fetching on every request.
let _jwksCache: any[] | null = null;
let _jwksFetchedAt = 0;

function b64urlDecode(s: string): Uint8Array {
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}

function b64urlJson(s: string): any {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(s)));
}

async function getJWKS(supabaseUrl: string): Promise<any[]> {
  const now = Date.now();
  if (_jwksCache && now - _jwksFetchedAt < 3_600_000) return _jwksCache;
  const resp = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`);
  if (!resp.ok) throw new Error(`jwks fetch failed: ${resp.status}`);
  const data = await resp.json<{ keys?: any[] }>();
  _jwksCache = data.keys || [];
  _jwksFetchedAt = now;
  return _jwksCache;
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

  if (payload.exp && payload.exp < Date.now() / 1000) return { error: 'expired token' };
  if (payload.role !== 'authenticated') return { error: 'not an authenticated role' };
  // Defence-in-depth beyond the signature: reject a token minted for a different
  // audience. Lenient — only reject a PRESENT, wrong `aud` so tokens lacking the
  // claim still pass (no lockout risk). Supabase user access tokens use
  // aud='authenticated'. (Strict `iss` enforcement is intentionally NOT added here
  // without first verifying a live token's issuer — a wrong match locks everyone out.)
  const aud = payload.aud;
  if (aud != null && (Array.isArray(aud) ? !aud.includes('authenticated') : aud !== 'authenticated')) {
    return { error: 'wrong audience' };
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
    const keys = await getJWKS(env.SUPABASE_URL);
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

    const cryptoKey = await crypto.subtle.importKey('jwk', jwk, importAlgo, false, ['verify']);
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
