import { createClient } from '@supabase/supabase-js';
import type { Context, Next } from 'hono';
import type { Env, Variables } from './types';

type C = Context<{ Bindings: Env; Variables: Variables }>;

export async function requireMember(c: C, next: Next) {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return c.json({ error: 'Unauthorized' }, 401);
  c.set('userId', user.id);
  await next();
}

export async function requireAdmin(c: C, next: Next) {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return c.json({ error: 'Unauthorized' }, 401);
  if (user.id !== c.env.ADMIN_USER_ID) return c.json({ error: 'Forbidden' }, 403);
  c.set('userId', user.id);
  await next();
}
