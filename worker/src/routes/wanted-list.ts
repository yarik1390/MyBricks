import { Hono } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';
import { loadBrickLinkColorMap, lookupBlColor } from '../lib/bricklink-colors';
import { mergeWantedParts, toBrickLinkXml, toRebrickableCsv, type WantedPart } from '../lib/wanted-list';

// Wanted lists for parts the collector needs.
//
// GET /api/wanted-list?set=<num>&format=json|bricklink|rebrickable
//   The parts marked missing on owned sets (all sets, or one with `set`).
// GET /api/wanted-list/build/:setnum?format=…
//   What's short to build :setnum from the parts of the complete sets owned —
//   the same pool Vault → Build ranks candidates with.
//
// Every response is JSON: { parts, count, pieces, skipped, file? }. With a file
// format, `file` is { name, mime, content } and the client saves it, so the
// native app can hand it to the system share sheet like other exports.
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next(); });
app.use('*', requireMember);

const MAX_ROWS = 5000;

async function respond(c: any, parts: WantedPart[], baseName: string) {
  const merged = mergeWantedParts(parts);
  const format = String(c.req.query('format') || 'json');
  const pieces = merged.reduce((s, p) => s + p.quantity, 0);
  const safeBase = baseName.replace(/[^A-Za-z0-9._-]+/g, '-');
  if (format === 'rebrickable') {
    return c.json({ count: merged.length, pieces, skipped: 0,
      file: { name: `${safeBase}-rebrickable.csv`, mime: 'text/csv', content: toRebrickableCsv(merged) } });
  }
  if (format === 'bricklink') {
    const map = await loadBrickLinkColorMap(c.env);
    const { xml, skipped } = toBrickLinkXml(merged, (id) => lookupBlColor(map, id));
    return c.json({ count: merged.length, pieces, skipped,
      file: { name: `${safeBase}-bricklink.xml`, mime: 'application/xml', content: xml } });
  }
  return c.json({ parts: merged, count: merged.length, pieces, skipped: 0 });
}

app.get('/', async (c) => {
  const userId = c.get('userId');
  const setNum = (c.req.query('set') || '').trim();
  const { results } = await c.env.DB.prepare(
    `SELECT m.part_num, m.color_id, m.missing_qty AS quantity,
            MAX(sp.part_name) AS part_name, MAX(sp.color_name) AS color_name
       FROM user_missing_parts m
       JOIN user_collection uc ON uc.user_id = m.user_id AND uc.set_num = m.set_num AND uc.deleted_at IS NULL
       LEFT JOIN set_parts sp ON sp.set_num = m.set_num AND sp.part_num = m.part_num AND sp.color_id = m.color_id
      WHERE m.user_id = ? ${setNum ? 'AND m.set_num = ?' : ''}
      GROUP BY m.set_num, m.part_num, m.color_id
      LIMIT ${MAX_ROWS}`,
  ).bind(...(setNum ? [userId, setNum] : [userId])).all<WantedPart>();
  return respond(c, results || [], setNum ? `missing-${setNum}` : 'missing-parts');
});

app.get('/build/:setnum', async (c) => {
  const userId = c.get('userId');
  const setNum = c.req.param('setnum');
  const { results } = await c.env.DB.prepare(
    `WITH pool AS (
       SELECT sp.part_num, sp.color_id, SUM(sp.quantity * uc.quantity) AS have
         FROM user_collection uc
         JOIN set_parts sp ON sp.set_num = uc.set_num
        WHERE uc.user_id = ? AND uc.deleted_at IS NULL AND uc.is_complete = 1
        GROUP BY sp.part_num, sp.color_id
     )
     SELECT sp.part_num, sp.color_id, sp.part_name, sp.color_name,
            sp.quantity - COALESCE(p.have, 0) AS quantity
       FROM set_parts sp
       LEFT JOIN pool p ON p.part_num = sp.part_num AND p.color_id = sp.color_id
      WHERE sp.set_num = ? AND sp.is_spare = 0 AND sp.quantity > COALESCE(p.have, 0)
      LIMIT ${MAX_ROWS}`,
  ).bind(userId, setNum).all<WantedPart>();
  return respond(c, results || [], `build-${setNum}`);
});

export { app as wantedListRoute };
