import { Hono } from 'hono';
import { optionalMember } from '../auth';
import type { Env, Variables } from '../types';

// "Price It!" — the daily price game. Five real sets a day, everyone gets the
// same five (deterministic from the UTC date), guess the market value, learn
// how the market actually prices LEGO. Signed-in guesses are recorded to
// price_guesses as an ANALYTICS-ONLY crowd prior (never in the pricing blend;
// same k>=5 ethos as community comps if it ever graduates).

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', optionalMember);

const ROUNDS = 5;
const POOL_SIZE = 400;
const CORRECT_BAND = 0.2; // within ±20% of market counts as a hit
const GUESS_DAILY_LIMIT = 25;

// Deterministic PRNG (mulberry32) seeded from the day string, so every client
// and every isolate agrees on today's five sets without storing anything.
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function daySeed(day: string): number {
  let h = 0;
  for (let i = 0; i < day.length; i++) h = (h * 31 + day.charCodeAt(i)) | 0;
  return h;
}

type GameSet = {
  set_num: string; name: string; theme: string | null; year: number | null;
  pieces: number | null; image_url: string | null; retail_price: number | null;
  value: number;
};

// Today's pool: market-valued, recognizable sets (real image + enough pieces
// that the value isn't trivia). Stable ordering makes the seeded pick stable.
async function dailyRounds(env: Env, day: string): Promise<GameSet[]> {
  const { results } = await env.DB.prepare(`
    SELECT set_num, name, theme, year, pieces, image_url, retail_price,
           COALESCE(NULLIF(blended_value, 0), current_value) AS value
    FROM lego_sets
    WHERE COALESCE(NULLIF(blended_value, 0), current_value) >= 20
      AND pieces >= 100 AND image_url IS NOT NULL
      AND COALESCE(valuation_method, '') NOT IN ('formula_bulk', 'local', 'ai')
    ORDER BY value DESC, set_num
    LIMIT ${POOL_SIZE}
  `).all<GameSet>();
  const pool = results || [];
  if (pool.length <= ROUNDS) return pool;
  const rand = mulberry32(daySeed(day));
  const picked: GameSet[] = [];
  const used = new Set<number>();
  while (picked.length < ROUNDS && used.size < pool.length) {
    const i = Math.floor(rand() * pool.length);
    if (used.has(i)) continue;
    used.add(i);
    picked.push(pool[i]);
  }
  return picked;
}

const utcDay = () => new Date().toISOString().slice(0, 10);

// GET /api/game/daily — today's five sets, values withheld (that's the game).
app.get('/daily', async (c) => {
  const day = utcDay();
  const rounds = await dailyRounds(c.env, day);
  return c.json({
    day,
    rounds: rounds.map(({ value: _value, ...pub }) => pub),
  });
});

// POST /api/game/guess — check one guess against today's game. Returns the
// actual value + verdict; signed-in guesses are recorded (rate-limited).
app.post('/guess', async (c) => {
  const userId = c.get('userId') || '';
  const body = await c.req.json<{ set_num?: string; guess?: number }>().catch(() => ({} as Record<string, never>));
  const setNum = String(body.set_num || '');
  const guess = Number(body.guess);
  if (!setNum) return c.json({ error: 'set_num required' }, 400);
  if (!Number.isFinite(guess) || guess <= 0 || guess > 1_000_000) {
    return c.json({ error: 'guess must be a positive number' }, 400);
  }

  const day = utcDay();
  const rounds = await dailyRounds(c.env, day);
  const round = rounds.find(r => r.set_num === setNum);
  if (!round) return c.json({ error: "That set isn't in today's game" }, 404);

  const actual = Number(round.value);
  const pctOff = Math.abs(guess - actual) / actual;
  const correct = pctOff <= CORRECT_BAND;

  if (userId) {
    const windowStart = new Date();
    windowStart.setUTCHours(0, 0, 0, 0);
    const rl = await c.env.DB.prepare(`
      INSERT INTO rate_limits (user_id, endpoint, window_start, hit_count)
      VALUES (?, 'game_guess', ?, 1)
      ON CONFLICT (user_id, endpoint, window_start) DO UPDATE SET hit_count = rate_limits.hit_count + 1
      RETURNING hit_count
    `).bind(userId, windowStart.toISOString()).first<{ hit_count: number }>();
    if ((rl?.hit_count || 0) <= GUESS_DAILY_LIMIT) {
      await c.env.DB.prepare(`
        INSERT INTO price_guesses (user_id, day, set_num, guessed_value, actual_value)
        VALUES (?,?,?,?,?)
      `).bind(userId, day, setNum, Math.round(guess * 100) / 100, actual).run().catch(() => {});
    }
  }

  return c.json({
    set_num: setNum,
    actual,
    guess,
    pct_off: Math.round(pctOff * 100),
    correct,
  });
});

export { app as gameRoute };
