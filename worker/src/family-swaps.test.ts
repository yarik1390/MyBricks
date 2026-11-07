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
  await applyTestTables(db, ['lego_sets', 'set_valuation_state', 'user_collection', 'user_wishlist', 'user_prefs', 'households', 'household_members', 'swap_requests', 'swap_messages', 'swap_blocks', 'rate_limits', 'app_feedback', 'push_subscriptions', 'native_push_tokens']);
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
      db.prepare(`UPDATE user_prefs SET open_to_swaps = 1, swaps_adult_at = datetime('now') WHERE user_id IN ('ann', 'bob')`),
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
    // Swaps are 18+: joining needs a one-time age confirmation, remembered after that.
    expect((await swaps('mum', 'POST', '/prefs', { open: true })).body.code).toBe('needs_adult');
    expect((await swaps('mum', 'POST', '/prefs', { open: true, adult: true })).status).toBe(200);
    await swaps('mum', 'POST', '/prefs', { open: false });
    expect((await swaps('mum', 'GET', '/')).body.adult_confirmed).toBe(true);
    expect((await swaps('mum', 'POST', '/prefs', { open: true })).status).toBe(200);
    expect((await swaps('mum', 'POST', '/trade', { set_num: '10497-1', for_trade: true })).status).toBe(200);
    expect((await swaps('mum', 'POST', '/trade', { set_num: '6086-1', for_trade: true })).status).toBe(404);
    // Cat switched swaps on before the 18+ check existed: hidden from matches and can't send requests until confirming.
    await db.prepare("UPDATE user_prefs SET open_to_swaps = 1 WHERE user_id = 'cat'").run();
    expect((await swaps('cat', 'POST', '/requests', { to: 'mum', give: ['75313-1'], get: [] })).body.code).toBe('needs_adult');
    expect((await swaps('cat', 'GET', '/')).body.open).toBe(false);
    const view = (await swaps('mum', 'GET', '/')).body;
    // Ann has the castle Mum wants and wants Mum's Galaxy Explorer; Bob only wants it; Cat is not open to swaps.
    expect(view.matches.map((m: any) => [m.handle, m.they_have.map((s: any) => s.set_num), m.they_want.map((s: any) => s.set_num)]))
      .toEqual([['ann', ['6086-1'], ['10497-1']], ['bob', [], ['10497-1']]]);
    expect(view.for_trade.map((s: any) => s.name)).toEqual(['Galaxy Explorer']);
  });

  it('sends, answers and shows a swap request from each side', async () => {
    await swaps('mum', 'POST', '/prefs', { open: true, adult: true });
    await swaps('mum', 'POST', '/trade', { set_num: '10497-1', for_trade: true });
    expect((await swaps('mum', 'POST', '/requests', { to: 'ann', give: [], get: [] })).status).toBe(400);
    expect((await swaps('mum', 'POST', '/requests', { to: 'ann', give: ['75313-1'], get: ['6086-1'], message: 'hi' })).status).toBe(400);
    expect((await swaps('mum', 'POST', '/requests', { to: 'cat', give: ['10497-1'], get: ['75313-1'], message: 'hi' })).status).toBe(404);
    // Contact details stay out of a request until it is accepted.
    const leak = await swaps('mum', 'POST', '/requests', { to: 'ann', give: ['10497-1'], get: ['6086-1'], message: 'mail me: mum@example.com' });
    expect(leak).toMatchObject({ status: 400, body: { code: 'contact_blocked', kinds: ['email'] } });
    const sent = await swaps('mum', 'POST', '/requests', { to: 'ann', give: ['10497-1'], get: ['6086-1'] });
    expect(sent.status).toBe(201);
    expect((await swaps('mum', 'POST', '/requests', { to: 'ann', give: ['10497-1'], get: [], message: 'again' })).status).toBe(409);
    const inbox = (await swaps('ann', 'GET', '/')).body.requests[0];
    expect(inbox).toMatchObject({ direction: 'incoming', status: 'pending', with_handle: 'mum', message: null, can_chat: true, unread: 0 });
    expect(inbox.i_give.map((s: any) => s.set_num)).toEqual(['6086-1']);
    expect((await swaps('ann', 'POST', `/requests/${sent.body.id}/respond`, { accept: true, reply: 'ann@example.com' })).body.code).toBe('contact_confirm');
    expect((await swaps('ann', 'POST', `/requests/${sent.body.id}/respond`, { accept: true, reply: 'ann@example.com', confirm_contact: true })).status).toBe(200);
    const out = (await swaps('mum', 'GET', '/')).body.requests[0];
    expect(out).toMatchObject({ direction: 'outgoing', status: 'accepted', reply: 'ann@example.com' });
    // Pending-only withdraw is gone once accepted, but either side can call it off.
    expect((await swaps('ann', 'POST', `/requests/${sent.body.id}/cancel`)).status).toBe(200);
    expect((await swaps('mum', 'GET', '/')).body.requests[0].status).toBe('cancelled');
  });

  async function acceptedSwap() {
    await swaps('mum', 'POST', '/prefs', { open: true, adult: true });
    await swaps('mum', 'POST', '/trade', { set_num: '10497-1', for_trade: true });
    const { id } = (await swaps('mum', 'POST', '/requests', { to: 'ann', give: ['10497-1'], get: ['6086-1'], message: 'Hi Ann!' })).body;
    return id as number;
  }

  it('chats on a request, counts unread and guards contact details', async () => {
    const id = await acceptedSwap();
    expect((await swaps('bob', 'POST', `/requests/${id}/messages`, { body: 'hi' })).status).toBe(404);
    expect((await swaps('mum', 'POST', `/requests/${id}/messages`, { body: 'call +44 7700 900123' })).body.code).toBe('contact_blocked');
    expect((await swaps('mum', 'POST', `/requests/${id}/messages`, { body: 'Is 75313-1 and 10497-1 still boxed?' })).status).toBe(201);
    expect((await swaps('ann', 'GET', '/')).body.requests[0].unread).toBe(1);
    const chat = (await swaps('ann', 'GET', `/requests/${id}/messages`)).body;
    expect(chat).toMatchObject({ can_send: true, with_handle: 'mum' });
    expect(chat.messages.map((m: any) => [m.mine, m.body])).toEqual([[false, 'Is 75313-1 and 10497-1 still boxed?']]);
    expect((await swaps('ann', 'GET', '/')).body.requests[0].unread).toBe(0);
    await swaps('ann', 'POST', `/requests/${id}/respond`, { accept: true });
    expect((await swaps('ann', 'POST', `/requests/${id}/messages`, { body: 'my telegram is @ann' })).body.code).toBe('contact_confirm');
    expect((await swaps('ann', 'POST', `/requests/${id}/messages`, { body: 'my telegram is @ann', confirm_contact: true })).status).toBe(201);
    expect((await swaps('mum', 'GET', `/requests/${id}/messages`)).body.messages).toHaveLength(2);
  });

  it('marks a swap complete only when both sides say done', async () => {
    const id = await acceptedSwap();
    expect((await swaps('mum', 'POST', `/requests/${id}/done`)).status).toBe(404);
    await swaps('ann', 'POST', `/requests/${id}/respond`, { accept: true });
    expect((await swaps('mum', 'POST', `/requests/${id}/done`)).body.completed).toBe(false);
    expect((await swaps('ann', 'GET', '/')).body.requests[0]).toMatchObject({ status: 'accepted', they_marked_done: true, i_marked_done: false });
    expect((await swaps('ann', 'POST', `/requests/${id}/done`)).body.completed).toBe(true);
    const view = (await swaps('mum', 'GET', '/')).body;
    expect(view.requests[0]).toMatchObject({ status: 'completed', with_swaps_done: 1 });
    expect(view.matches.find((m: any) => m.handle === 'ann').swaps_done).toBe(1);
    // A completed swap cannot be called off.
    expect((await swaps('mum', 'POST', `/requests/${id}/cancel`)).status).toBe(404);
  });

  it('deletes a request from one list, and for good once both sides do', async () => {
    const id = await acceptedSwap();
    await swaps('mum', 'POST', `/requests/${id}/messages`, { body: 'hello' });
    await swaps('ann', 'POST', `/requests/${id}/respond`, { accept: true });
    expect((await swaps('mum', 'DELETE', `/requests/${id}`)).status).toBe(200);
    expect((await swaps('mum', 'GET', '/')).body.requests).toEqual([]);
    // Deleting an accepted swap calls it off for the other side.
    expect((await swaps('ann', 'GET', '/')).body.requests[0]).toMatchObject({ status: 'cancelled', can_chat: false });
    expect((await swaps('ann', 'POST', `/requests/${id}/messages`, { body: 'wait' })).status).toBe(409);
    expect((await swaps('bob', 'DELETE', `/requests/${id}`)).status).toBe(404);
    await swaps('ann', 'DELETE', `/requests/${id}`);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM swap_requests').first()).toEqual({ n: 0 });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM swap_messages').first()).toEqual({ n: 0 });
  });

  it('hides, blocks and reports collectors', async () => {
    await swaps('mum', 'POST', '/prefs', { open: true, adult: true });
    await swaps('mum', 'POST', '/trade', { set_num: '10497-1', for_trade: true });
    expect((await swaps('mum', 'POST', '/people/bob/hide')).status).toBe(200);
    let view = (await swaps('mum', 'GET', '/')).body;
    expect(view.matches.map((m: any) => m.handle)).toEqual(['ann']);
    expect(view.hidden).toEqual([{ handle: 'bob', name: 'Bob', kind: 'hide' }]);
    await swaps('mum', 'DELETE', '/people/bob');
    expect((await swaps('mum', 'GET', '/')).body.matches.map((m: any) => m.handle)).toEqual(['ann', 'bob']);

    const id = (await swaps('mum', 'POST', '/requests', { to: 'ann', give: ['10497-1'], get: ['6086-1'] })).body.id;
    const report = await swaps('ann', 'POST', '/people/mum/report', { reason: 'scam', details: 'asked for money first', request_id: id });
    expect(report.status).toBe(200);
    const fb = await db.prepare("SELECT user_id, message FROM app_feedback WHERE screen = 'swap-report'").first<any>();
    expect(fb.user_id).toBe('ann');
    expect(fb.message).toContain('@mum');
    expect(fb.message).toContain('asked for money first');
    // Reporting blocks both ways: the open request ends and nobody can reach the other.
    expect((await swaps('mum', 'GET', '/')).body.requests[0]).toMatchObject({ status: 'cancelled', can_chat: false });
    expect((await swaps('mum', 'GET', '/')).body.matches.map((m: any) => m.handle)).toEqual(['bob']);
    expect((await swaps('mum', 'POST', '/requests', { to: 'ann', give: ['10497-1'], get: ['6086-1'] })).status).toBe(404);
    expect((await swaps('ann', 'POST', '/people/mum/hide')).status).toBe(200);
    expect((await swaps('ann', 'GET', '/')).body.hidden[0].kind).toBe('block');
  });
});
