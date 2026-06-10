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
    const url = `https://brickset.com/api/v3.asmx/login?apiKey=${encodeURIComponent(c.env.BRICKSET_API_KEY)}&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
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
    return c.json({ error: (e as Error).message }, 500);
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
    const url = `https://brickset.com/api/v3.asmx/getSets?apiKey=${encodeURIComponent(c.env.BRICKSET_API_KEY)}&userHash=${encodeURIComponent(userHash)}&params={"owned":1,"pageSize":500}`;
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) return c.json({ error: `Brickset API error: ${resp.status}` }, 502);
    const data = await resp.json() as {
      status?: string;
      message?: string;
      sets?: Array<{ setID: number; number: string; numberVariant: number; name: string; year: number; owned: boolean }>;
    };
    if (data.status !== 'success') return c.json({ error: data.message || 'Brickset returned error' }, 502);

    const sets = (data.sets || []).filter(s => s.owned);
    let added = 0;
    let skipped = 0;
    for (const s of sets) {
      const setNum = `${s.number}-${s.numberVariant || 1}`;
      // Only import sets that exist in our catalog
      const known = await c.env.DB.prepare('SELECT set_num FROM lego_sets WHERE set_num=?').bind(setNum).first();
      if (!known) { skipped++; continue; }
      await c.env.DB.prepare(
        `INSERT INTO user_collection (user_id, set_num, acquisition_source, last_modified, added_at)
         VALUES (?, ?, 'brickset', datetime('now'), datetime('now'))
         ON CONFLICT (user_id, set_num) DO NOTHING`
      ).bind(userId, setNum).run();
      added++;
    }
    return c.json({ ok: true, added, skipped, total: sets.length });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

export { app as bricksetSyncRoute };
