import { createClient } from '@supabase/supabase-js';
import type { Context, Next } from 'hono';
import type { Env, Variables } from './types';

type C = Context<{ Bindings: Env; Variables: Variables }>;

async function verifyToken(c: C): Promise<{ user: { id: string } | null; reason?: string }> {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return { user: null, reason: 'no token' };
  if (!c.env.SUPABASE_URL) return { user: null, reason: 'SUPABASE_URL not configured' };
  if (!c.env.SUPABASE_SERVICE_ROLE_KEY) return { user: null, reason: 'SUPABASE_SERVICE_ROLE_KEY not configured' };
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error) return { user: null, reason: error.message };
  if (!user) return { user: null, reason: 'user not found' };
  return { user };
}

export async function requireMember(c: C, next: Next) {
  const { user, reason } = await verifyToken(c);
  if (!user) return c.json({ error: 'Unauthorized', reason }, 401);
  c.set('userId', user.id);
  await next();
}

export async function requireAdmin(c: C, next: Next) {
  const { user, reason } = await verifyToken(c);
  if (!user) return c.json({ error: 'Unauthorized', reason }, 401);
  if (user.id !== c.env.ADMIN_USER_ID) return c.json({ error: 'Forbidden' }, 403);
  c.set('userId', user.id);
  await next();
}
