import { Hono } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', requireMember);

// POST /api/brickset/login — exchange username+password for userHash server-side and store it.
app.post('/login', async (c) => {
  const userId = c.get('userId');
  if (!c.env.BRICKSET_API_KEY) return c.json({ error: 'Brickset not configured' }, 503);
  const body = await c.req.json<{ username: string; password: string }>().catch(() => ({ username: '', password: '' }));
  const { username, password } = body;
  if (!username || !password) return c.json({ error: 'username and password required' }, 400);
  try {
    // Send credentials in a POST form body — Brickset v3.asmx supports
    // application/x-www-form-urlencoded — so the password never appears in the
    // request URL (and therefore not in Cloudflare/proxy/Brickset access logs).
    const resp = await fetch('https://brickset.com/api/v3.asmx/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ apiKey: c.env.BRICKSET_API_KEY, username, password }).toString(),
    });
    if (!resp.ok) return c.json({ error: `Brickset API error: ${resp.status}` }, 502);
    const data = await resp.json() as { status?: string; message?: string; hash?: string };
    if (data.status !== 'success' || !data.hash) {
      return c.json({ error: data.message || 'Login failed — check username and password' }, 401);
    }
    await c.env.DB.prepare(
      `INSERT INTO user_prefs (user_id, brickset_user_hash, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT (user_id) DO UPDATE SET brickset_user_hash = excluded.brickset_user_hash, updated_at = datetime('now')`
    ).bind(userId, data.hash).run();
    return c.json({ ok: true });
  } catch (e) {
    console.warn('[brickset/login] failed:', (e as Error).message);
    return c.json({ error: 'Brickset login failed. Check your credentials and try again.' }, 500);
  }
});

// POST /api/brickset/connect — store a Brickset userHash for the current user.
// The client exchanges username+password via the Brickset API (from the frontend)
// and sends us the resulting userHash to store.
app.post('/connect', async (c) => {
  const userId = c.get('userId');
  const { user_hash } = await c.req.json<{ user_hash: string }>();
  if (!user_hash || typeof user_hash !== 'string' || !/^[a-zA-Z0-9_-]{8,}$/.test(user_hash)) {
    return c.json({ error: 'invalid user_hash' }, 400);
  }
  await c.env.DB.prepare(
    `INSERT INTO user_prefs (user_id, brickset_user_hash, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT (user_id) DO UPDATE SET brickset_user_hash = excluded.brickset_user_hash, updated_at = datetime('now')`
  ).bind(userId, user_hash).run();
  return c.json({ ok: true });
});

// DELETE /api/brickset/connect — remove stored userHash
app.delete('/connect', async (c) => {
  const userId = c.get('userId');
  await c.env.DB.prepare(
    `UPDATE user_prefs SET brickset_user_hash = NULL, updated_at = datetime('now') WHERE user_id = ?`
  ).bind(userId).run();
  return c.json({ ok: true });
});

// POST /api/brickset/sync — import owned sets from Brickset into user_collection
app.post('/sync', async (c) => {
  const userId = c.get('userId');
  if (!c.env.BRICKSET_API_KEY) return c.json({ error: 'Brickset not configured' }, 503);

  const prefs = await c.env.DB.prepare(
    'SELECT brickset_user_hash FROM user_prefs WHERE user_id=?'
  ).bind(userId).first<{ brickset_user_hash: string | null }>();
  const userHash = prefs?.brickset_user_hash;
  if (!userHash) return c.json({ error: 'Brickset account not connected' }, 400);

  try {
    // POST form body keeps the userHash (a credential) and params out of the
    // request URL/logs; Brickset v3.asmx accepts form-encoded POST.
    const resp = await fetch('https://brickset.com/api/v3.asmx/getSets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ apiKey: c.env.BRICKSET_API_KEY, userHash, params: '{"owned":1,"pageSize":500}' }).toString(),
    });
    if (!resp.ok) return c.json({ error: `Brickset API error: ${resp.status}` }, 502);
    const data = await resp.json() as {
      status?: string;
      message?: string;
      sets?: Array<{ setID: number; number: string; numberVariant: number; name: string; year: number; owned: boolean }>;
    };
    if (data.status !== 'success') return c.json({ error: data.message || 'Brickset returned error' }, 502);

    const sets = (data.sets || []).filter(s => s.owned);
    const setNums = [...new Set(sets.map(s => `${s.number}-${s.numberVariant || 1}`))];

    // Batch the catalog-existence check: one IN(...) query per 100 sets instead
    // of a SELECT per set (the old N+1).
    const known = new Set<string>();
    for (let i = 0; i < setNums.length; i += 100) {
      const chunk = setNums.slice(i, i + 100);
      const ph = chunk.map(() => '?').join(',');
      const { results } = await c.env.DB.prepare(
        `SELECT set_num FROM lego_sets WHERE set_num IN (${ph})`
      ).bind(...chunk).all<{ set_num: string }>();
      for (const r of results) known.add(r.set_num);
    }

    let added = 0;
    let skipped = 0;
    const inserts: D1PreparedStatement[] = [];
    for (const setNum of setNums) {
      if (!known.has(setNum)) { skipped++; continue; }
      inserts.push(c.env.DB.prepare(
        `INSERT INTO user_collection (user_id, set_num, acquisition_source, last_modified, added_at)
         VALUES (?, ?, 'brickset', datetime('now'), datetime('now'))
         ON CONFLICT (user_id, set_num) DO UPDATE SET
           deleted_at = NULL, last_modified = datetime('now')
         WHERE user_collection.deleted_at IS NOT NULL`
      ).bind(userId, setNum));
    }
    // Batch the writes too (D1 batch limit is 100 statements/call).
    for (let i = 0; i < inserts.length; i += 100) {
      const res = await c.env.DB.batch(inserts.slice(i, i + 100));
      for (const r of res) { if (((r.meta?.changes as number | undefined) ?? 0) > 0) added++; else skipped++; }
    }
    return c.json({ ok: true, added, skipped, total: sets.length });
  } catch (e) {
    console.warn('[brickset/sync] failed:', (e as Error).message);
    return c.json({ error: 'Brickset sync failed. Try again in a moment.' }, 500);
  }
});

export { app as bricksetSyncRoute };
