/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lotRoute, setNumberCandidates, lotVerdict } from './routes/lot';
import { gradeRoute, BOX_GRADE_DAILY_LIMIT } from './routes/grade';
import { parseBoxGrade } from './lib/box-grade';
import { applyTestTables } from './test-schema';

const secret = 'lot-grade-test-secret-at-least-32-characters';
const user = 'lot-owner';
const db = (env as { DB: D1Database }).DB;
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const PHOTO = 'data:image/jpeg;base64,/9j/AAAA';

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

async function call(route: { fetch: typeof lotRoute.fetch }, path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await route.fetch(new Request(`http://local${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await jwt(user)}`, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }), env as any, ctx);
  return { status: res.status, body: await res.json() as any };
}

beforeEach(async () => {
  (env as any).SUPABASE_JWT_SECRET = secret;
  (env as any).SUPABASE_URL = 'https://supabase.mock.io';
  await applyTestTables(db, ['lego_sets', 'set_valuation_state', 'user_prefs', 'rate_limits', 'integration_health']);
  await db.batch([
    db.prepare(`INSERT INTO lego_sets (set_num, name, year, current_value, blended_value, used_value) VALUES
      ('75313-1', 'AT-AT', 2021, 900, 900, 700), ('10497-1', 'Galaxy Explorer', 2022, 110, 100, 80),
      ('6086-1', 'Black Knight Castle', 1992, 600, 600, 300), ('21318-1', 'Tree House', 2019, 250, 250, 180)`),
  ]);
});
afterEach(() => vi.unstubAllGlobals());

describe('lot checker', () => {
  it('finds set numbers in listing text and skips years and prices', () => {
    expect(setNumberCandidates('LEGO lot: 75313, 10497-1 and Castle #6086 from 1992. 1500 pcs, $450')).toEqual(['75313-1', '10497-1', '6086-1']);
  });

  it('matches pasted text to the catalog', async () => {
    const r = await call(lotRoute, '/parse', { text: 'Selling 6086 and 75313 plus 12345 (unknown)' });
    expect(r.body.sets.map((s: any) => s.set_num)).toEqual(['6086-1', '75313-1']);
  });

  it('values a lot by condition and gives a verdict', async () => {
    const r = await call(lotRoute, '/value', {
      items: [{ set_num: '10497-1', condition: 'sealed', qty: 2 }, { set_num: '6086-1', condition: 'used' }, { set_num: '21318-1', condition: 'incomplete' }],
      asking_usd: 300,
    });
    expect(r.status).toBe(200);
    expect(r.body.items.map((i: any) => i.value)).toEqual([200, 300, 108]);
    expect(r.body.total).toBe(608);
    expect(r.body.resale_keep).toBeCloseTo(528.96, 2);
    expect(r.body.verdict).toBe('great');
  });

  it('keeps lots over three sets for Pro', async () => {
    const items = ['75313-1', '10497-1', '6086-1', '21318-1'].map((set_num) => ({ set_num }));
    expect((await call(lotRoute, '/value', { items })).status).toBe(402);
    await db.prepare('INSERT INTO user_prefs (user_id, is_supporter) VALUES (?, 1)').bind(user).run();
    expect((await call(lotRoute, '/value', { items })).status).toBe(200);
  });

  it('grades verdict bands', () => {
    expect(lotVerdict(100, 90).verdict).toBe('fair');
    expect(lotVerdict(100, 150).verdict).toBe('overpriced');
    expect(lotVerdict(100, null).verdict).toBeNull();
  });
});

describe('box grading', () => {
  const reply = { is_box: true, grade: 'good', seal_intact: true, issues: ['small dent on top'], summary: 'Light shelf wear.' };
  beforeEach(() => {
    vi.stubGlobal('fetch', async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }));
  });

  it('parses and validates model replies', () => {
    expect(parseBoxGrade('```json\n{"is_box":true,"grade":"mint","issues":[]}\n```')?.grade).toBe('mint');
    expect(parseBoxGrade('{"is_box":true,"grade":"great"}')).toBeNull();
    expect(parseBoxGrade('{"is_box":false,"grade":null}')?.is_box).toBe(false);
  });

  it('needs Pro without a personal key', async () => {
    const r = await call(gradeRoute, '/box', { image: PHOTO, set_num: '75313-1' });
    expect(r.status).toBe(402);
    expect(r.body.code).toBe('pro_required');
  });

  it('grades with the member\'s own Gemini key', async () => {
    const r = await call(gradeRoute, '/box', { image: PHOTO, set_num: '75313-1' }, { 'X-Gemini-Key': 'mine' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ grade: 'good', seal_intact: true, price_share: 0.85 });
  });

  it('rejects anything that is not a photo', async () => {
    expect((await call(gradeRoute, '/box', { image: 'hello' }, { 'X-Gemini-Key': 'mine' })).status).toBe(400);
  });

  it('caps Pro grades on the shared key per day', async () => {
    (env as any).GEMINI_API_KEY = 'server-key';
    await db.prepare('INSERT INTO user_prefs (user_id, is_supporter) VALUES (?, 1)').bind(user).run();
    for (let i = 0; i < BOX_GRADE_DAILY_LIMIT; i++) expect((await call(gradeRoute, '/box', { image: PHOTO })).status).toBe(200);
    expect((await call(gradeRoute, '/box', { image: PHOTO })).status).toBe(429);
  });
});
