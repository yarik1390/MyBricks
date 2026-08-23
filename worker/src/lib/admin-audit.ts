import type { Context, Next } from 'hono';
import type { Env, Variables } from '../types';

type C = Context<{ Bindings: Env; Variables: Variables }>;

const SECRET_KEY = /authorization|token|secret|password|api.?key|cookie|webhook/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SECRET_KEY.test(key) ? '[REDACTED]' : redact(item, depth + 1),
    ]));
  }
  if (typeof value === 'string') return value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value;
  return value;
}

async function ipHash(c: C): Promise<string | null> {
  const ip = c.req.header('cf-connecting-ip');
  if (!ip) return null;
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(bytes)).slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Audit every authenticated admin mutation, including failures. */
export async function auditAdminMutation(c: C, next: Next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) return next();
  const requestId = c.req.header('X-Request-Id') || crypto.randomUUID();
  c.header('X-Request-Id', requestId);
  const actor = c.get('userId') || 'unknown';
  const action = `${c.req.method} ${c.req.path}`;
  const targetId = c.req.param('id') || c.req.param('key') || null;
  const targetType = c.req.path.split('/').filter(Boolean).at(-1) || 'admin';
  // Audit structured intent, never raw upload bodies. JSON mutations are
  // bounded before parsing so a privileged bulk import cannot duplicate an
  // arbitrarily large body in memory or in the audit table.
  let requestSnapshot: unknown = null;
  const contentType = c.req.header('content-type') || '';
  const declaredLength = Number(c.req.header('content-length') || 0);
  if (contentType.includes('application/json') && declaredLength <= 64_000) {
    requestSnapshot = await c.req.raw.clone().json().catch(() => null);
  } else if (declaredLength > 0) {
    requestSnapshot = { content_type: contentType, content_length: declaredLength };
  }

  // Persist the intent before the mutation runs. If the audit store is not
  // available, fail closed so a privileged write cannot become unaudited.
  const started = await c.env.DB.prepare(`
    INSERT INTO admin_audit_log
      (request_id, actor_user_id, action, target_type, target_id, before_json, outcome, source_ip_hash)
    VALUES (?, ?, ?, ?, ?, ?, 'started', ?)
  `).bind(
    requestId,
    actor,
    action,
    targetType,
    targetId,
    JSON.stringify(redact({ request: requestSnapshot })),
    await ipHash(c),
  ).run();
  const auditId = started.meta.last_row_id;
  if (!auditId) return c.json({ error: 'Admin audit trail is unavailable.' }, 503);

  let outcome = 'success';
  let errorCode: string | null = null;
  try {
    await next();
    if (c.res.status >= 400) {
      outcome = c.res.status === 401 || c.res.status === 403 ? 'denied' : 'failure';
      errorCode = `HTTP_${c.res.status}`;
    }
  } catch (error) {
    outcome = 'failure';
    errorCode = error instanceof Error ? error.name : 'UNKNOWN';
    throw error;
  } finally {
    const responseSnapshot = { status: c.res?.status ?? 500 };
    // A failed completion update still leaves the durable `started` row, which
    // is preferable to suppressing or rolling back the mutation's evidence.
    await c.env.DB.prepare(`
      UPDATE admin_audit_log
      SET after_json=?, outcome=?, error_code=?
      WHERE id=?
    `).bind(
      JSON.stringify(redact(responseSnapshot)),
      outcome,
      errorCode,
      auditId,
    ).run().catch((error) => console.error('[admin-audit] completion update failed:', (error as Error).message));
  }
}

/** Require and atomically claim an idempotency key for costly admin jobs. */
export async function claimAdminOperation(c: C, action: string): Promise<Response | null> {
  const key = (c.req.header('Idempotency-Key') || '').trim();
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(key)) {
    return c.json({ error: 'A valid Idempotency-Key is required for this operation.' }, 400);
  }
  const result = await c.env.DB.prepare(`
    INSERT OR IGNORE INTO admin_operation_claims (operation_key, action, actor_user_id)
    VALUES (?, ?, ?)
  `).bind(key, action, c.get('userId') || 'unknown').run();
  if ((result.meta.changes ?? 0) === 0) {
    return c.json({ error: 'This operation was already submitted.', operation_key: key }, 409);
  }
  return null;
}
