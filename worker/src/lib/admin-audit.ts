import type { Context, Next } from 'hono';
import type { Env, Variables } from '../types';

type C = Context<{ Bindings: Env; Variables: Variables }>;

const SECRET_KEY = /authorization|token|secret|password|api.?key|cookie|webhook/i;
const MAX_AUDIT_BODY_BYTES = 64_000;

async function boundedJsonSnapshot(request: { body: ReadableStream<Uint8Array> | null; headers: Headers }): Promise<unknown> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_AUDIT_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return {
          content_type: request.headers.get('content-type') || '',
          content_length: bytesRead,
          truncated: true,
        };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

async function adminRequestFingerprint(c: C, action: string): Promise<string> {
  const body = await c.req.raw.clone().arrayBuffer();
  const prefix = new TextEncoder().encode(`${action}\n${c.req.path}\n`);
  const input = new Uint8Array(prefix.byteLength + body.byteLength);
  input.set(prefix);
  input.set(new Uint8Array(body), prefix.byteLength);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

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
  if (contentType.includes('application/json') && declaredLength <= MAX_AUDIT_BODY_BYTES) {
    requestSnapshot = await boundedJsonSnapshot(c.req.raw.clone());
  } else if (declaredLength > 0) {
    requestSnapshot = {
      content_type: contentType,
      content_length: declaredLength,
      truncated: declaredLength > MAX_AUDIT_BODY_BYTES,
    };
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
  const actor = c.get('userId') || 'unknown';
  const fingerprint = await adminRequestFingerprint(c, action);
  const result = await c.env.DB.prepare(`
    INSERT OR IGNORE INTO admin_operation_claims
      (operation_key, action, actor_user_id, request_fingerprint)
    VALUES (?, ?, ?, ?)
  `).bind(key, action, actor, fingerprint).run();
  if ((result.meta.changes ?? 0) === 0) {
    const prior = await c.env.DB.prepare(`
      SELECT request_fingerprint, status, result_json
      FROM admin_operation_claims
      WHERE operation_key=? AND action=? AND actor_user_id=?
    `).bind(key, action, actor).first<{
      request_fingerprint: string;
      status: string;
      result_json: string | null;
    }>();
    if (!prior || prior.request_fingerprint !== fingerprint) {
      return c.json({ error: 'Idempotency-Key was already used for a different operation.', operation_key: key }, 409);
    }
    if (prior.status === 'running') {
      const reclaimed = await c.env.DB.prepare(`
        UPDATE admin_operation_claims
        SET updated_at=CURRENT_TIMESTAMP
        WHERE operation_key=? AND action=? AND actor_user_id=?
          AND request_fingerprint=? AND status='running'
          AND updated_at < datetime('now', '-5 minutes')
      `).bind(key, action, actor, fingerprint).run();
      if ((reclaimed.meta.changes ?? 0) === 1) return null;
    }
    if (prior.status === 'completed' && prior.result_json) {
      try {
        return c.json(JSON.parse(prior.result_json) as Record<string, unknown>);
      } catch { /* malformed terminal records fail closed below */ }
    }
    if (prior.status === 'failed') {
      await c.env.DB.prepare(`
        DELETE FROM admin_operation_claims
        WHERE operation_key=? AND action=? AND actor_user_id=? AND status='failed'
      `).bind(key, action, actor).run();
      return claimAdminOperation(c, action);
    }
    return c.json({ error: 'This operation is already running.', operation_key: key }, 409);
  }
  return null;
}

/** Mark an expensive admin operation terminal so retries can replay or retry. */
export async function settleAdminOperation(
  c: C,
  action: string,
  status: 'completed' | 'failed',
  result?: Record<string, unknown>,
): Promise<void> {
  const key = (c.req.header('Idempotency-Key') || '').trim();
  if (!key) return;
  await c.env.DB.prepare(`
    UPDATE admin_operation_claims
    SET status=?, result_json=?, updated_at=CURRENT_TIMESTAMP
    WHERE operation_key=? AND action=? AND actor_user_id=? AND status='running'
  `).bind(
    status,
    result ? JSON.stringify(result) : null,
    key,
    action,
    c.get('userId') || 'unknown',
  ).run();
}
