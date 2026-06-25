import { Hono } from 'hono';
import type { Context } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', requireMember);

// Daily submission cap across all contribution types. Supporters get 5×,
// matching the scan/advisor BYOK-free tiers.
const DAILY_LIMIT = 10;
const SUPPORTER_MULTIPLIER = 5;

const DATA_KINDS = new Set(['barcode', 'price', 'image', 'partlist', 'metadata']);
const ALLOWED_IMG = ['image/jpeg', 'image/png', 'image/webp'];

// Atomic per-day throttle (copy of the scan.ts pattern). Returns the JSON
// 429 response when the caller is over their cap, otherwise null.
async function overLimit(c: Ctx, userId: string): Promise<Response | null> {
  const pref = await c.env.DB.prepare(
    'SELECT is_supporter FROM user_prefs WHERE user_id=?'
  ).bind(userId).first<{ is_supporter: number }>();
  const limit = pref?.is_supporter ? DAILY_LIMIT * SUPPORTER_MULTIPLIER : DAILY_LIMIT;
  const windowStart = new Date();
  windowStart.setHours(0, 0, 0, 0);
  const rl = await c.env.DB.prepare(`
    INSERT INTO rate_limits (user_id, endpoint, window_start, hit_count)
    VALUES (?, 'contributions', ?, 1)
    ON CONFLICT (user_id, endpoint, window_start) DO UPDATE SET hit_count = rate_limits.hit_count + 1
    RETURNING hit_count
  `).bind(userId, windowStart.toISOString()).first<{ hit_count: number }>();
  if ((rl?.hit_count || 0) > limit) {
    return c.json({ error: `Daily contribution limit reached (${limit}/day). Try again tomorrow.` }, 429);
  }
  return null;
}

async function setExists(c: Ctx, setNum: string): Promise<boolean> {
  const row = await c.env.DB.prepare('SELECT 1 AS ok FROM lego_sets WHERE set_num=?')
    .bind(setNum).first<{ ok: number }>();
  return !!row;
}

// POST /api/contributions/reviews — submit/replace the caller's review for a set.
app.post('/reviews', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ set_num?: string; rating?: number; title?: string; body?: string }>().catch(() => ({} as { set_num?: string; rating?: number; title?: string; body?: string }));
  const setNum = (body.set_num || '').trim();
  const rating = Number(body.rating);
  if (!setNum) return c.json({ error: 'set_num required' }, 400);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return c.json({ error: 'rating must be an integer 1–5' }, 400);
  }
  if (!(await setExists(c, setNum))) return c.json({ error: 'Unknown set' }, 404);
  const over = await overLimit(c, userId);
  if (over) return over;

  // One live row per (user, set): retire any prior live review, then insert fresh
  // as pending so re-submitting edits the entry and re-enters the queue.
  await c.env.DB.prepare(
    "UPDATE set_reviews SET deleted_at=datetime('now') WHERE user_id=? AND set_num=? AND deleted_at IS NULL"
  ).bind(userId, setNum).run();
  await c.env.DB.prepare(
    'INSERT INTO set_reviews (user_id, set_num, rating, title, body, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(userId, setNum, rating, (body.title || '').slice(0, 120) || null, (body.body || '').slice(0, 4000) || null, 'pending').run();
  return c.json({ ok: true, status: 'pending' });
});

// POST /api/contributions/photos/:setNum — multipart "photo" upload to R2.
app.post('/photos/:setNum', async (c) => {
  const userId = c.get('userId');
  const setNum = c.req.param('setNum');
  if (!(await setExists(c, setNum))) return c.json({ error: 'Unknown set' }, 404);
  if (!c.env.PHOTO_BUCKET) return c.json({ error: 'Photo storage not configured' }, 503);

  const form = await c.req.formData();
  const raw = form.get('photo');
  if (!raw || typeof raw === 'string') return c.json({ error: 'photo field required' }, 400);
  const file = raw as File;
  if (!ALLOWED_IMG.includes(file.type)) {
    return c.json({ error: 'Only JPEG, PNG, or WebP images are accepted' }, 415);
  }
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > 4_000_000) return c.json({ error: 'Image too large (max 4 MB)' }, 413);

  const over = await overLimit(c, userId);
  if (over) return over;

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const key = `set-photos/${setNum}/${userId}-${Date.now()}.${ext}`;
  await c.env.PHOTO_BUCKET.put(key, bytes, {
    httpMetadata: { contentType: file.type },
    customMetadata: { userId, setNum, uploadedAt: new Date().toISOString() },
  });
  const caption = (form.get('caption') as string | null)?.slice(0, 200) || null;
  const res = await c.env.DB.prepare(
    'INSERT INTO set_photos (user_id, set_num, r2_key, caption, status) VALUES (?, ?, ?, ?, ?)'
  ).bind(userId, setNum, key, caption, 'pending').run();
  return c.json({ ok: true, status: 'pending', id: res.meta.last_row_id });
});

// POST /api/contributions/data — barcode/price/report submissions.
app.post('/data', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ set_num?: string; kind?: string; payload?: any; note?: string }>().catch(() => ({} as { set_num?: string; kind?: string; payload?: any; note?: string }));
  const setNum = (body.set_num || '').trim();
  const kind = (body.kind || '').trim();
  if (!setNum) return c.json({ error: 'set_num required' }, 400);
  if (!DATA_KINDS.has(kind)) return c.json({ error: 'Invalid kind' }, 400);
  if (!(await setExists(c, setNum))) return c.json({ error: 'Unknown set' }, 404);

  const payload = body.payload ?? {};
  if (kind === 'barcode') {
    const upc = String(payload.upc || '').replace(/\s+/g, '');
    if (!/^\d{8,14}$/.test(upc)) return c.json({ error: 'Barcode must be 8–14 digits' }, 400);
    payload.upc = upc;
  } else if (kind === 'price') {
    const price = Number(payload.price);
    if (!(price > 0) || price > 1_000_000) return c.json({ error: 'Price must be a positive number' }, 400);
    payload.price = price;
    payload.condition = payload.condition === 'used' ? 'used' : 'new';
  }
  const over = await overLimit(c, userId);
  if (over) return over;

  await c.env.DB.prepare(
    'INSERT INTO set_contributions (user_id, set_num, kind, payload, note, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(userId, setNum, kind, JSON.stringify(payload), (body.note || '').slice(0, 1000) || null, 'pending').run();
  return c.json({ ok: true, status: 'pending' });
});

// GET /api/contributions/sets/:setNum — approved community content for a set.
app.get('/sets/:setNum', async (c) => {
  const userId = c.get('userId');
  const setNum = c.req.param('setNum');
  const [agg, reviews, photos, prices, mine] = await Promise.all([
    c.env.DB.prepare(
      "SELECT AVG(rating) AS avg, COUNT(*) AS count FROM set_reviews WHERE set_num=? AND status='approved' AND deleted_at IS NULL"
    ).bind(setNum).first<{ avg: number | null; count: number }>(),
    c.env.DB.prepare(
      "SELECT id, user_id, rating, title, body, created_at FROM set_reviews WHERE set_num=? AND status='approved' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50"
    ).bind(setNum).all(),
    c.env.DB.prepare(
      "SELECT id, caption, created_at FROM set_photos WHERE set_num=? AND status='approved' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 30"
    ).bind(setNum).all(),
    c.env.DB.prepare(
      "SELECT payload, created_at FROM set_contributions WHERE set_num=? AND kind='price' AND status='approved' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20"
    ).bind(setNum).all(),
    c.env.DB.prepare(
      "SELECT 'review' AS type, status FROM set_reviews WHERE set_num=? AND user_id=? AND deleted_at IS NULL " +
      "UNION ALL SELECT 'photo', status FROM set_photos WHERE set_num=? AND user_id=? AND deleted_at IS NULL " +
      "UNION ALL SELECT 'data', status FROM set_contributions WHERE set_num=? AND user_id=? AND deleted_at IS NULL"
    ).bind(setNum, userId, setNum, userId, setNum, userId).all(),
  ]);

  const pricePoints = (prices.results || []).map((r: any) => {
    let p: any = {}; try { p = JSON.parse(r.payload); } catch {}
    return { price: p.price, condition: p.condition, source: p.source || null, at: r.created_at };
  });
  return c.json({
    rating: { avg: agg?.avg ? Math.round(agg.avg * 10) / 10 : null, count: agg?.count || 0 },
    reviews: reviews.results || [],
    photos: (photos.results || []).map((p: any) => ({ id: p.id, caption: p.caption, url: `/api/contributions/photos/file/${p.id}`, at: p.created_at })),
    prices: pricePoints,
    mine: mine.results || [],
  });
});

// GET /api/contributions/photos/file/:id — stream an approved photo (or the
// owner's own pending one) from R2.
app.get('/photos/file/:id', async (c) => {
  const userId = c.get('userId');
  const id = parseInt(c.req.param('id'), 10);
  if (!id) return c.json({ error: 'Invalid id' }, 400);
  if (!c.env.PHOTO_BUCKET) return c.json({ error: 'Photo storage not configured' }, 503);
  const row = await c.env.DB.prepare(
    'SELECT r2_key, user_id, status FROM set_photos WHERE id=? AND deleted_at IS NULL'
  ).bind(id).first<{ r2_key: string; user_id: string; status: string }>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.status !== 'approved' && row.user_id !== userId) return c.json({ error: 'Not found' }, 404);
  const obj = await c.env.PHOTO_BUCKET.get(row.r2_key);
  if (!obj) return c.json({ error: 'Not found' }, 404);
  const headers = new Headers();
  headers.set('Content-Type', obj.httpMetadata?.contentType || 'image/jpeg');
  headers.set('Cache-Control', row.status === 'approved' ? 'public, max-age=86400' : 'private, max-age=300');
  return new Response(obj.body, { headers });
});

// GET /api/contributions/mine — the caller's submissions + approved count.
app.get('/mine', async (c) => {
  const userId = c.get('userId');
  const rows = await c.env.DB.prepare(
    "SELECT 'review' AS type, id, set_num, status, review_note, created_at, reviewed_at FROM set_reviews WHERE user_id=? AND deleted_at IS NULL " +
    "UNION ALL SELECT 'photo', id, set_num, status, review_note, created_at, reviewed_at FROM set_photos WHERE user_id=? AND deleted_at IS NULL " +
    "UNION ALL SELECT 'data', id, set_num, status, review_note, created_at, reviewed_at FROM set_contributions WHERE user_id=? AND deleted_at IS NULL " +
    'ORDER BY created_at DESC LIMIT 200'
  ).bind(userId, userId, userId).all();
  const approved = (rows.results || []).filter((r: any) => r.status === 'approved').length;
  return c.json({ submissions: rows.results || [], approved_count: approved });
});

const TYPE_TABLE: Record<string, string> = {
  review: 'set_reviews',
  photo: 'set_photos',
  data: 'set_contributions',
};

// DELETE /api/contributions/:type/:id — withdraw the caller's own pending item.
app.delete('/:type/:id', async (c) => {
  const userId = c.get('userId');
  const table = TYPE_TABLE[c.req.param('type')];
  const id = parseInt(c.req.param('id'), 10);
  if (!table || !id) return c.json({ error: 'Invalid request' }, 400);
  const res = await c.env.DB.prepare(
    `UPDATE ${table} SET deleted_at=datetime('now') WHERE id=? AND user_id=? AND status='pending' AND deleted_at IS NULL`
  ).bind(id, userId).run();
  if (!res.meta.changes) return c.json({ error: 'Not found or already reviewed' }, 404);
  return c.body(null, 204);
});

export { app as contributionsRoute };
