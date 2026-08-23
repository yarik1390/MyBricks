/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { auditAdminMutation, claimAdminOperation, settleAdminOperation } from './lib/admin-audit';
import { applyTestTables } from './test-schema';
import type { Env, Variables } from './types';

const db = (env as any).DB as D1Database;

beforeEach(async () => {
  await applyTestTables(db, ['admin_audit_log', 'admin_operation_claims']);
});

function claimApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => { c.set('userId', 'actor'); await next(); });
  app.post('/claim', async (c) => {
    const duplicate = await claimAdminOperation(c, 'test.claim');
    if (duplicate) return duplicate;
    const body = await c.req.json<Record<string, unknown>>();
    await settleAdminOperation(c, 'test.claim', 'completed', { ok: true, body });
    return c.json({ ok: true, body });
  });
  return app;
}

describe('admin operation claims', () => {
  it('binds an idempotency key to one request fingerprint and replays terminal results', async () => {
    const app = claimApp();
    const key = 'test-operation-key-123';
    const first = await app.fetch(new Request('https://example.test/claim', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: '{"v":1}',
    }), env as any);
    expect(first.status).toBe(200);

    const replay = await app.fetch(new Request('https://example.test/claim', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: '{"v":1}',
    }), env as any);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ ok: true, body: { v: 1 } });

    const conflict = await app.fetch(new Request('https://example.test/claim', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: '{"v":2}',
    }), env as any);
    expect(conflict.status).toBe(409);
  });

  it('reclaims an abandoned running operation lease', async () => {
    const app = claimApp();
    const key = 'stale-operation-key-123';
    const first = await app.fetch(new Request('https://example.test/claim', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: '{"v":1}',
    }), env as any);
    expect(first.status).toBe(200);
    await db.prepare(`UPDATE admin_operation_claims
      SET status='running', result_json=NULL, updated_at=datetime('now', '-10 minutes')
      WHERE operation_key=?`).bind(key).run();

    const response = await app.fetch(new Request('https://example.test/claim', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: '{"v":1}',
    }), env as any);
    expect(response.status).toBe(200);
  });
});

describe('admin audit capture', () => {
  it('bounds an oversized body without persisting its contents', async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use('*', async (c, next) => { c.set('userId', 'actor'); await next(); });
    app.use('*', auditAdminMutation);
    app.post('/admin/test', (c) => c.json({ ok: true }));
    const large = JSON.stringify({ payload: 'x'.repeat(70_000) });
    const response = await app.fetch(new Request('https://example.test/admin/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(large.length), 'x-request-id': 'audit-large' },
      body: large,
    }), env as any);
    expect(response.status).toBe(200);

    const row = await db.prepare(`SELECT before_json FROM admin_audit_log WHERE request_id='audit-large'`).first<{ before_json: string }>();
    expect(JSON.parse(row!.before_json)).toMatchObject({
      request: { content_length: large.length, truncated: true },
    });
    expect(row!.before_json).not.toContain('xxxxx');
  });
});
