/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emailRoute } from './routes/email';
import { meRoute } from './routes/me';
import { swapsRoute } from './routes/swaps';
import { unsubscribeLinks, unsubscribeToken, verifyUnsubscribeToken } from './lib/email-unsubscribe';
import { sendAlertEmail } from './lib/resend';
import { alertEmailHTML, UNSUBSCRIBE_MARKER } from './lib/alert-email';
import { runWeeklyDigest } from './jobs/weekly-digest';
import { applyTestTables } from './test-schema';

const secret = 'email-unsubscribe-test-secret-at-least-32-chars';
const db = (env as { DB: D1Database }).DB;
const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException: () => {} } as unknown as ExecutionContext;

async function jwt(subject: string): Promise<string> {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: subject, role: 'authenticated', aud: 'authenticated',
    iss: 'https://supabase.mock.io/auth/v1', exp: Math.floor(Date.now() / 1000) + 3600,
  })}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}`;
}

const emailOff = async (user: string) =>
  (await db.prepare('SELECT email_off_at FROM user_prefs WHERE user_id = ?').bind(user).first<{ email_off_at: string | null }>())?.email_off_at ?? null;

const post = (path: string, init: RequestInit = {}) =>
  emailRoute.fetch(new Request(`http://local${path}`, { method: 'POST', ...init }), env as any, ctx);

beforeEach(async () => {
  (env as any).SUPABASE_JWT_SECRET = secret;
  (env as any).SUPABASE_URL = 'https://supabase.mock.io';
  await applyTestTables(db, ['user_prefs', 'user_collection', 'lego_sets', 'portfolio_snapshots', 'set_value_history', 'wishlist_alerts', 'push_subscriptions', 'native_push_tokens', 'app_feedback', 'swap_requests', 'swap_messages', 'swap_blocks', 'rate_limits', 'set_valuation_state', 'ai_trials', 'holding_copies']);
  await db.batch([
    db.prepare('DROP TABLE IF EXISTS kids_badges'),
    db.prepare('CREATE TABLE kids_badges (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, badge_slug TEXT NOT NULL, earned_at TEXT)'),
  ]);
  await db.prepare(`INSERT INTO user_prefs (user_id, email, handle, notify_weekly_digest) VALUES ('u1', 'u1@example.com', 'uone', 1), ('u2', 'u2@example.com', 'utwo', 1)`).run();
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('unsubscribe tokens', () => {
  it('verify only for the user they were made for', async () => {
    const t = (await unsubscribeToken(env as any, 'u1'))!;
    expect(t).toHaveLength(32);
    expect(await verifyUnsubscribeToken(env as any, 'u1', t)).toBe(true);
    expect(await verifyUnsubscribeToken(env as any, 'u2', t)).toBe(false);
    expect(await verifyUnsubscribeToken(env as any, 'u1', `${t.slice(0, 31)}x`)).toBe(false);
    expect(await verifyUnsubscribeToken(env as any, 'u1', '')).toBe(false);
  });
});

describe('POST /api/email/unsubscribe', () => {
  it('turns emails off with the one-click POST from a mail app, and back on', async () => {
    const t = await unsubscribeToken(env as any, 'u1');
    const res = await post(`/unsubscribe?u=u1&t=${t}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click',
    });
    expect(res.status).toBe(200);
    expect(await emailOff('u1')).toBeTruthy();
    expect(await emailOff('u2')).toBeNull();
    const back = await post('/resubscribe', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ u: 'u1', t }) });
    expect(back.status).toBe(200);
    expect(await emailOff('u1')).toBeNull();
  });

  it('refuses a bad token and never acts on GET', async () => {
    expect((await post('/unsubscribe?u=u1&t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).status).toBe(400);
    const t = await unsubscribeToken(env as any, 'u1');
    const get = await emailRoute.fetch(new Request(`http://local/unsubscribe?u=u1&t=${t}`), env as any, ctx);
    expect(get.status).toBe(404);
    expect(await emailOff('u1')).toBeNull();
  });
});

describe('email_alerts preference', () => {
  const me = async (method: string, body?: unknown) => {
    const res = await meRoute.fetch(new Request('http://local/', {
      method, headers: { Authorization: `Bearer ${await jwt('u1')}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }), env as any, ctx);
    return res.json() as Promise<any>;
  };

  it('shows on GET /api/me and switches with PATCH', async () => {
    expect((await me('GET')).email_alerts).toBe(true);
    await me('PATCH', { email_alerts: false });
    expect(await emailOff('u1')).toBeTruthy();
    expect((await me('GET')).email_alerts).toBe(false);
    await me('PATCH', { email_alerts: true });
    expect(await emailOff('u1')).toBeNull();
  });

  it('stops the weekly digest email for an unsubscribed user', async () => {
    const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)).to[0]);
      return new Response('{}', { status: 200 });
    }));
    await db.batch([
      db.prepare(`UPDATE user_prefs SET email_off_at = datetime('now') WHERE user_id = 'u2'`),
      db.prepare(`INSERT INTO portfolio_snapshots (user_id, snapshot_date, total_value, set_count) VALUES ('u1', date('now'), 500, 4), ('u2', date('now'), 300, 2)`),
    ]);
    await runWeeklyDigest({ ...env, RESEND_API_KEY: 're_test', VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '' } as any);
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual(['u1@example.com']);
  });
});

describe('sendAlertEmail', () => {
  it('adds List-Unsubscribe headers and the signed footer link', async () => {
    let payload: any = null;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      payload = JSON.parse(String(init.body));
      return new Response('{}', { status: 200 });
    }));
    const html = alertEmailHTML('drop', { setNum: '75192-1', name: 'Falcon', value: 700 } as any, { targetPrice: 750 }, 'https://bricksvault.app');
    expect(html).toContain(UNSUBSCRIBE_MARKER);
    const ok = await sendAlertEmail('u1@example.com', 'Hit', html, { ...env, RESEND_API_KEY: 're_test' } as any, 'u1');
    expect(ok).toBe(true);
    const links = (await unsubscribeLinks(env as any, 'u1'))!;
    expect(payload.headers['List-Unsubscribe']).toBe(`<${links.oneClick}>`);
    expect(payload.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(payload.html).not.toContain(UNSUBSCRIBE_MARKER);
    expect(payload.html).toContain(links.page.replace(/&/g, '&amp;'));
  });
});

describe('swap reports', () => {
  it('email the owner', async () => {
    (env as any).ADMIN_USER_ID = 'owner';
    (env as any).RESEND_API_KEY = 're_test';
    await db.prepare(`INSERT INTO user_prefs (user_id, email, handle) VALUES ('owner', 'owner@example.com', 'owner')`).run();
    const mails: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      mails.push(JSON.parse(String(init.body)));
      return new Response('{}', { status: 200 });
    }));
    try {
      const res = await swapsRoute.fetch(new Request('http://local/people/utwo/report', {
        method: 'POST', headers: { Authorization: `Bearer ${await jwt('u1')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'scam', details: 'asked for <money> first' }),
      }), env as any, ctx);
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 10));
      expect(mails).toHaveLength(1);
      expect(mails[0].to).toEqual(['owner@example.com']);
      expect(mails[0].subject).toBe('Swap report: @utwo (scam)');
      expect(mails[0].html).toContain('asked for &lt;money&gt; first');
      expect(mails[0].headers).toBeUndefined();
    } finally {
      (env as any).RESEND_API_KEY = '';
    }
  });
});
