import { Hono, type Context } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

const MAX_NAME_CHARS = 80;
const MAX_SET_NUMS = 200;
const MAX_SUBCOLLECTIONS = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SET_NUM_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

type StoredSubcollection = { id: string; name: string; set_nums: string; revision: number; updated_at: string };
type Subcollection = Omit<StoredSubcollection, 'set_nums'> & { set_nums: string[] };

function jsonBody(c: AppContext) {
  return c.req.json<unknown>().catch(() => undefined);
}

function normalizeId(value: unknown): string | null {
  return typeof value === 'string' && UUID_RE.test(value) ? value.toLowerCase() : null;
}

function normalizeWriteBody(value: unknown): { name: string; setNums: string[]; revision: number } | { error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'Invalid JSON body' };
  const body = value as Record<string, unknown>;
  if (typeof body.name !== 'string') return { error: 'name must be a string' };
  const name = body.name.trim();
  if (!name || name.length > MAX_NAME_CHARS) return { error: `name must be 1-${MAX_NAME_CHARS} trimmed characters` };
  if (!Array.isArray(body.set_nums)) return { error: 'set_nums must be an array' };
  if (body.set_nums.length > MAX_SET_NUMS) return { error: `set_nums cannot contain more than ${MAX_SET_NUMS} items` };
  if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0 || Number(body.revision) >= Number.MAX_SAFE_INTEGER) {
    return { error: 'revision must be a non-negative safe integer below Number.MAX_SAFE_INTEGER' };
  }
  const setNums: string[] = [];
  const seen = new Set<string>();
  for (const value of body.set_nums) {
    if (typeof value !== 'string') return { error: 'set_nums must contain only strings' };
    const trimmed = value.trim();
    const normalized = /^\d+$/.test(trimmed) ? `${trimmed}-1` : trimmed;
    if (!SET_NUM_RE.test(normalized)) return { error: `Invalid set ID: ${trimmed || '(empty)'}` };
    if (!seen.has(normalized)) { seen.add(normalized); setNums.push(normalized); }
  }
  return { name, setNums, revision: Number(body.revision) };
}

function normalizeDeleteBody(value: unknown): { revision: number } | { error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'Invalid JSON body' };
  const revision = (value as Record<string, unknown>).revision;
  if (!Number.isSafeInteger(revision) || Number(revision) < 1) return { error: 'revision must be a positive safe integer' };
  return { revision: Number(revision) };
}

function present(row: StoredSubcollection): Subcollection {
  return { id: row.id, name: row.name, set_nums: JSON.parse(row.set_nums) as string[], revision: Number(row.revision), updated_at: row.updated_at };
}

app.use('*', async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next(); });
app.use('*', requireMember);

app.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT id,name,set_nums,revision,updated_at FROM user_subcollections
    WHERE user_id=?1 ORDER BY updated_at DESC,name COLLATE NOCASE,id
  `).bind(c.get('userId')).all<StoredSubcollection>();
  return c.json({ subcollections: results.map(present) });
});

app.put('/:id', async (c) => {
  const id = normalizeId(c.req.param('id'));
  if (!id) return c.json({ error: 'id must be a UUID' }, 400);
  const parsed = normalizeWriteBody(await jsonBody(c));
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const userId = c.get('userId');
  let row: StoredSubcollection | null;
  if (parsed.revision === 0) {
    row = await c.env.DB.prepare(`
      INSERT INTO user_subcollections (user_id,id,name,set_nums,revision,updated_at)
      SELECT ?1,?2,?3,?4,1,CURRENT_TIMESTAMP
      WHERE (SELECT COUNT(*) FROM user_subcollections WHERE user_id=?1) < ?5
      ON CONFLICT(user_id,id) DO NOTHING
      RETURNING id,name,set_nums,revision,updated_at
    `).bind(userId, id, parsed.name, JSON.stringify(parsed.setNums), MAX_SUBCOLLECTIONS).first<StoredSubcollection>();
  } else {
    row = await c.env.DB.prepare(`
      UPDATE user_subcollections SET name=?3,set_nums=?4,revision=revision+1,updated_at=CURRENT_TIMESTAMP
      WHERE user_id=?1 AND id=?2 AND revision=?5
      RETURNING id,name,set_nums,revision,updated_at
    `).bind(userId, id, parsed.name, JSON.stringify(parsed.setNums), parsed.revision).first<StoredSubcollection>();
  }
  if (row) return c.json({ subcollection: present(row) });
  const current = await c.env.DB.prepare('SELECT revision FROM user_subcollections WHERE user_id=?1 AND id=?2')
    .bind(userId, id).first<{ revision: number }>();
  if (current) return c.json({ error: 'Revision conflict', code: 'stale_revision', revision: Number(current.revision) }, 409);
  if (parsed.revision > 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ error: 'Subcollection limit reached', code: 'subcollection_limit' }, 400);
});

app.delete('/:id', async (c) => {
  const id = normalizeId(c.req.param('id'));
  if (!id) return c.json({ error: 'id must be a UUID' }, 400);
  const parsed = normalizeDeleteBody(await jsonBody(c));
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const userId = c.get('userId');
  const deleted = await c.env.DB.prepare(`DELETE FROM user_subcollections
    WHERE user_id=?1 AND id=?2 AND revision=?3 RETURNING id`)
    .bind(userId, id, parsed.revision).first<{ id: string }>();
  if (deleted) return c.body(null, 204);
  const current = await c.env.DB.prepare('SELECT revision FROM user_subcollections WHERE user_id=?1 AND id=?2')
    .bind(userId, id).first<{ revision: number }>();
  if (!current) return c.json({ error: 'Not found' }, 404);
  return c.json({ error: 'Revision conflict', code: 'stale_revision', revision: Number(current.revision) }, 409);
});

export { app as subcollectionsRoute };
