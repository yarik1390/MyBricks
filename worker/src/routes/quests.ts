import { Hono } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';

// Theme quests (mounted at /api/quests): for every subtheme the member already
// collects ("Ultimate Collector Series", "Botanical Collection"…), how many of
// its sets they own, plus the missing ones, cheapest first.
//
// GET /api/quests   { quests: [{ theme, subtheme, owned, total, missing: [...] }] }
//
// Only subthemes of QUEST_MIN–QUEST_MAX real sets count: a 3-set subtheme is
// not a quest, a 400-set one can never be finished. Gear, key chains and
// polybag-sized items (under MIN_PIECES pieces) are left out of both counts.
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireMember);

export const QUEST_MIN = 4;
export const QUEST_MAX = 60;
export const MIN_PIECES = 25;
const MAX_QUESTS = 12;
const MISSING_SHOWN = 30;
// Catch-all subthemes that aren't a collection anyone sets out to finish.
const SKIP_SUBTHEMES = ['miscellaneous', 'promotional', 'other', 'product collection', 'magnets', 'key chains', 'gear', 'bulk bricks', 'supplementary', 'collection'];

export type QuestRow = { theme: string; subtheme: string; owned: number; total: number };

/** Most complete first (by share, then by owned count), then smaller quests. */
export function rankQuests<T extends QuestRow>(rows: T[]): T[] {
  return rows
    .filter((r) => r.owned > 0 && r.total >= QUEST_MIN && r.total <= QUEST_MAX && !SKIP_SUBTHEMES.includes(r.subtheme.trim().toLowerCase()))
    .sort((a, b) => b.owned / b.total - a.owned / a.total || b.owned - a.owned || a.total - b.total || a.subtheme.localeCompare(b.subtheme));
}

app.get('/', async (c) => {
  const userId = c.get('userId');
  const owned = `SELECT set_num FROM user_collection WHERE user_id = ? AND deleted_at IS NULL AND sold_at IS NULL`;
  const { results } = await c.env.DB.prepare(
    `WITH mine AS (
       SELECT DISTINCT s.theme, s.subtheme FROM lego_sets s
        WHERE s.set_num IN (${owned}) AND s.subtheme IS NOT NULL AND s.subtheme <> ''
     )
     SELECT s.theme, s.subtheme, COUNT(*) AS total,
            SUM(CASE WHEN s.set_num IN (${owned}) THEN 1 ELSE 0 END) AS owned
       FROM lego_sets s JOIN mine m ON m.theme = s.theme AND m.subtheme = s.subtheme
      WHERE COALESCE(s.pieces, 0) >= ${MIN_PIECES}
      GROUP BY s.theme, s.subtheme`,
  ).bind(userId, userId).all<QuestRow>().catch(() => ({ results: [] as QuestRow[] }));
  const quests = rankQuests((results || []).map((r) => ({ ...r, owned: Number(r.owned) || 0, total: Number(r.total) || 0 }))).slice(0, MAX_QUESTS);
  if (!quests.length) return c.json({ quests: [] });

  // Missing sets for the shown quests in one read, cheapest first so the
  // "next set" suggestion is the easiest step toward finishing.
  const keys = quests.map(() => '(s.theme = ? AND s.subtheme = ?)').join(' OR ');
  const { results: missing } = await c.env.DB.prepare(
    `SELECT s.set_num, s.name, s.year, s.theme, s.subtheme, s.image_url, s.retired, s.retail_price,
            COALESCE(s.current_value, s.retail_price) AS value
       FROM lego_sets s
      WHERE (${keys}) AND COALESCE(s.pieces, 0) >= ${MIN_PIECES}
        AND s.set_num NOT IN (${owned})
      ORDER BY (COALESCE(s.current_value, s.retail_price) IS NULL), COALESCE(s.current_value, s.retail_price) ASC, s.year DESC`,
  ).bind(...quests.flatMap((q) => [q.theme, q.subtheme]), userId).all<Record<string, unknown> & { theme: string; subtheme: string }>()
    .catch(() => ({ results: [] as (Record<string, unknown> & { theme: string; subtheme: string })[] }));
  const byQuest = new Map<string, Record<string, unknown>[]>();
  for (const row of missing || []) {
    const key = `${row.theme}\u0000${row.subtheme}`;
    const list = byQuest.get(key) || [];
    if (list.length < MISSING_SHOWN) list.push({ set_num: row.set_num, name: row.name, year: row.year, image_url: row.image_url, retired: row.retired, value: row.value });
    byQuest.set(key, list);
  }
  return c.json({ quests: quests.map((q) => ({ ...q, missing: byQuest.get(`${q.theme}\u0000${q.subtheme}`) || [] })) });
});

export { app as questsRoute };
