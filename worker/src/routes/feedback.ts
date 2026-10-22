import { Hono } from 'hono';
import { requireAdmin, requireMember } from '../auth';
import type { Env, Variables } from '../types';

// In-app feedback (mounted at /api/feedback).
//
// POST  /api/feedback          { message, screen?, app_version?, platform?, locale? }
//                              a signed-in user sends a note; 10 per day each
// GET   /api/feedback/admin    newest 100 notes for the owner's Admin page
// PATCH /api/feedback/admin/:id { status: 'open' | 'done' }
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

export const FEEDBACK_MAX_CHARS = 4000;
export const FEEDBACK_DAILY_LIMIT = 10;

const clip = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

app.post('/', requireMember, async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const message = clip(body.message, FEEDBACK_MAX_CHARS);
  if (!message || message.length < 3) return c.json({ error: 'Write a few words first' }, 400);
  const today = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM app_feedback WHERE user_id = ? AND created_at >= datetime('now', '-1 day')",
  ).bind(userId).first<{ n: number }>();
  if ((today?.n ?? 0) >= FEEDBACK_DAILY_LIMIT) return c.json({ error: 'Daily feedback limit reached' }, 429);
  const row = await c.env.DB.prepare(
    `INSERT INTO app_feedback (user_id, email, message, screen, app_version, platform, user_agent, locale)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(
    userId,
    c.get('userEmail') ?? null,
    message,
    clip(body.screen, 200),
    clip(body.app_version, 40),
    clip(body.platform, 20),
    clip(c.req.header('User-Agent'), 300),
    clip(body.locale, 10),
  ).first<{ id: number }>();
  return c.json({ ok: true, id: row?.id ?? null });
});

app.get('/admin', requireAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, email, message, screen, app_version, platform, user_agent, locale, status, created_at
     FROM app_feedback ORDER BY id DESC LIMIT 100`,
  ).all();
  const open = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM app_feedback WHERE status = 'open'").first<{ n: number }>();
  return c.json({ items: results ?? [], open: open?.n ?? 0 });
});

app.patch('/admin/:id', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  const { status } = await c.req.json().catch(() => ({})) as { status?: string };
  if (!Number.isInteger(id) || (status !== 'open' && status !== 'done')) return c.json({ error: 'Bad request' }, 400);
  await c.env.DB.prepare('UPDATE app_feedback SET status = ? WHERE id = ?').bind(status, id).run();
  return c.json({ ok: true });
});

export { app as feedbackRoute };
