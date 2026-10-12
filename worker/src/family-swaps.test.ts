/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { familyRoute } from './routes/family';
import { swapsRoute, rankMatches } from './routes/swaps';
import { applyTestTables } from './test-schema';

const secret = 'family-swaps-test-secret-at-least-32-chars';
const db = (env as { DB: D1Database }).DB;
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

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

function caller(route: { fetch: typeof familyRoute.fetch }) {
  return async (user: string, method: string, path: string, body?: unknown) => {
    const res = await route.fetch(new Request(`http://local${path}`, {
      method, headers: { Authorization: `Bearer ${await jwt(user)}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }), env as any, ctx);
    return { status: res.status, body: await res.json() as any };
  };
}
const family = caller(familyRoute);
const swaps = caller(swapsRoute);

beforeEach(async () => {
  (env as any).SUPABASE_JWT_SECRET = secret;
  (env as any).SUPABASE_URL = 'https://supabase.mock.io';
  await applyTestTables(db, ['lego_sets', 'set_valuation_state', 'user_collection', 'user_wishlist', 'user_prefs', 'households', 'household_members', 'swap_requests', 'push_subscriptions', 'native_push_tokens']);
  await db.batch([
    db.prepare(`INSERT INTO lego_sets (set_num, name, year, current_value, blended_value, used_value) VALUES
      ('75313-1', 'AT-AT', 2021, 900, 900, 700), ('10497-1', 'Galaxy Explorer', 2022, 100, 100, 80),
      ('21318-1', 'Tree House', 2019, 250, 250, 180), ('6086-1', 'Black Knight Castle', 1992, 600, 600, 300)`),
    db.prepare(`INSERT INTO user_prefs (user_id, handle, display_name) VALUES ('mum', 'mum', 'Mum'), ('kid', 'kid', 'Alex'), ('ann', 'ann', 'Ann'), ('bob', 'bob', 'Bob'), ('cat', 'cat', 'Cat')`),
    db.prepare(`INSERT INTO user_collection (user_id, set_num, quantity, condition) VALUES
      ('mum', '75313-1', 1, 'sealed'), ('mum', '10497-1', 1, 'sealed'), ('kid', '10497-1', 2, 'sealed'), ('kid', '21318-1', 1, 'used_good')`),
  ]);
});

describe('family vault', () => {
  it('creates, joins with the code and shows one combined vault', async () => {
    const created = await family('mum', 'POST', '/', { name: 'The Smiths' });
    expect(created.status).toBe(201);
    const code = created.body.household.invite_code;
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    expect((await family('kid', 'POST', '/join', { code: 'WRONG123' })).status).toBe(404);
    const joined = await family('kid', 'POST', '/join', { code: code.toLowerCase() });
    expect(joined.status).toBe(200);
    const view = (await family('mum', 'GET', '/')).body;
    expect(view.members.map((m: any) => [m.name, m.role, m.sets])).toEqual([['You', 'owner', 2], ['Alex', 'member', 3]]);
    expect(view.vault.total_sets).toBe(5);
    expect(view.vault.shared).toBe(1);
    const explorer = view.vault.sets.find((s: any) => s.set_num === '10497-1');
    expect(explorer.owners).toEqual([{ name: 'You', quantity: 1 }, { name: 'Alex', quantity: 2 }]);
    // Same per-holding values as each member's own Vault total.
    expect(view.vault.total_value).toBe(900 + 100 + 200 + 250);
  });

  it('keeps one household per member and lets only the owner manage it', async () => {
    const code = (await family('mum', 'POST', '/', {})).body.household.invite_code;
    await family('kid', 'POST', '/join', { code });
    expect((await family('kid', 'POST', '/', { name: 'Mine' })).status).toBe(409);
    expect((await family('kid', 'POST', '/code')).status).toBe(403);
    const fresh = (await family('mum', 'POST', '/code')).body.household.invite_code;
    expect(fresh).not.toBe(code);
    const kidId = (await family('mum', 'GET', '/')).body.members.find((m: any) => !m.is_me).member_id;
    expect((await family('mum', 'DELETE', `/members/${kidId}`)).body.members).toHaveLength(1);
    expect((await family('kid', 'GET', '/')).body.household).toBeNull();
  });

  it('hands the household to the next member when the owner leaves', async () => {
    const code = (await family('mum', 'POST', '/', {})).body.household.invite_code;
    await family('kid', 'POST', '/join', { code });
    await family('mum', 'POST', '/leave');
    const view = (await family('kid', 'GET', '/')).body;
    expect(view.household.role).toBe('owner');
    await family('kid', 'POST', '/leave');
    expect(await db.prepare('SELECT COUNT(*) AS n FROM households').first()).toEqual({ n: 0 });
  });
});

describe('swap matching', () => {
  beforeEach(async () => {
    await db.batch([
      db.prepare(`INSERT INTO user_collection (user_id, set_num, for_trade) VALUES ('ann', '6086-1', 1), ('bob', '21318-1', 0), ('cat', '75313-1', 1)`),
      db.prepare(`INSERT INTO user_wishlist (user_id, set_num) VALUES ('ann', '10497-1'), ('mum', '6086-1'), ('mum', '75313-1'), ('bob', '10497-1')`),
      db.prepare(`UPDATE user_prefs SET open_to_swaps = 1 WHERE user_id IN ('ann', 'bob')`),
    ]);
  });

  it('ranks collectors who match both ways first', () => {
    const r = rankMatches([{ user_id: 'x', set_num: 'a' }, { user_id: 'y', set_num: 'b' }, { user_id: 'y', set_num: 'c' }], [{ user_id: 'x', set_num: 'd' }]);
    expect(r.map((m) => m.user_id)).toEqual(['x', 'y']);
  });

  it('matches only opted-in collectors and offered sets', async () => {
    expect((await swaps('mum', 'GET', '/')).body.matches).toEqual([]);
    await db.prepare("UPDATE user_prefs SET handle = NULL WHERE user_id = 'kid'").run();
    expect((await swaps('kid', 'POST', '/prefs', { open: true })).body.code).toBe('needs_handle');
    expect((await swaps('mum', 'POST', '/prefs', { open: true })).status).toBe(200);
    expect((await swaps('mum', 'POST', '/trade', { set_num: '10497-1', for_trade: true })).status).toBe(200);
    expect((await swaps('mum', 'POST', '/trade', { set_num: '6086-1', for_trade: true })).status).toBe(404);
    const view = (await swaps('mum', 'GET', '/')).body;
    // Ann has the castle Mum wants and wants Mum's Galaxy Explorer; Bob only wants it; Cat is not open to swaps.
    expect(view.matches.map((m: any) => [m.handle, m.they_have.map((s: any) => s.set_num), m.they_want.map((s: any) => s.set_num)]))
      .toEqual([['ann', ['6086-1'], ['10497-1']], ['bob', [], ['10497-1']]]);
    expect(view.for_trade.map((s: any) => s.name)).toEqual(['Galaxy Explorer']);
  });

  it('sends, answers and shows a swap request from each side', async () => {
    await swaps('mum', 'POST', '/prefs', { open: true });
    await swaps('mum', 'POST', '/trade', { set_num: '10497-1', for_trade: true });
    expect((await swaps('mum', 'POST', '/requests', { to: 'ann', give: ['10497-1'], get: ['6086-1'] })).status).toBe(400);
    expect((await swaps('mum', 'POST', '/requests', { to: 'ann', give: ['75313-1'], get: ['6086-1'], message: 'hi' })).status).toBe(400);
    expect((await swaps('mum', 'POST', '/requests', { to: 'cat', give: ['10497-1'], get: ['75313-1'], message: 'hi' })).status).toBe(404);
    const sent = await swaps('mum', 'POST', '/requests', { to: 'ann', give: ['10497-1'], get: ['6086-1'], message: 'Discord: mum#1' });
    expect(sent.status).toBe(201);
    expect((await swaps('mum', 'POST', '/requests', { to: 'ann', give: ['10497-1'], get: [], message: 'again' })).status).toBe(409);
    const inbox = (await swaps('ann', 'GET', '/')).body.requests[0];
    expect(inbox).toMatchObject({ direction: 'incoming', status: 'pending', with_handle: 'mum', message: 'Discord: mum#1' });
    expect(inbox.i_give.map((s: any) => s.set_num)).toEqual(['6086-1']);
    expect((await swaps('ann', 'POST', `/requests/${sent.body.id}/respond`, { accept: true })).status).toBe(400);
    expect((await swaps('ann', 'POST', `/requests/${sent.body.id}/respond`, { accept: true, reply: 'ann@example.com' })).status).toBe(200);
    const out = (await swaps('mum', 'GET', '/')).body.requests[0];
    expect(out).toMatchObject({ direction: 'outgoing', status: 'accepted', reply: 'ann@example.com' });
    expect((await swaps('mum', 'POST', `/requests/${sent.body.id}/cancel`)).status).toBe(404);
  });
});
