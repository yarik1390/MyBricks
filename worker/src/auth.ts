import type { Context, Next } from 'hono';
import type { Env, Variables } from './types';

type C = Context<{ Bindings: Env; Variables: Variables }>;

async function verifyJWT(token: string, secret: string): Promise<string | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    const sig = Uint8Array.from(
      atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')),
      c => c.charCodeAt(0),
    );
    const valid = await crypto.subtle.verify(
      'HMAC', key, sig,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) return null;

    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    if (payload.role !== 'authenticated') return null;

    return payload.sub as string;
  } catch {
    return null;
  }
}

export async function requireMember(c: C, next: Next) {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'Unauthorized', reason: 'no token' }, 401);
  if (!c.env.SUPABASE_JWT_SECRET) return c.json({ error: 'Unauthorized', reason: 'SUPABASE_JWT_SECRET not configured' }, 401);
  const userId = await verifyJWT(token, c.env.SUPABASE_JWT_SECRET);
  if (!userId) return c.json({ error: 'Unauthorized', reason: 'invalid or expired token' }, 401);
  c.set('userId', userId);
  await next();
}

export async function requireAdmin(c: C, next: Next) {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'Unauthorized', reason: 'no token' }, 401);
  if (!c.env.SUPABASE_JWT_SECRET) return c.json({ error: 'Unauthorized', reason: 'SUPABASE_JWT_SECRET not configured' }, 401);
  const userId = await verifyJWT(token, c.env.SUPABASE_JWT_SECRET);
  if (!userId) return c.json({ error: 'Unauthorized', reason: 'invalid or expired token' }, 401);
  if (userId !== c.env.ADMIN_USER_ID) return c.json({ error: 'Forbidden' }, 403);
  c.set('userId', userId);
  await next();
}
