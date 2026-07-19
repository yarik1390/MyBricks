import { Hono } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', requireMember);

// Daily cap on 4 MB R2 writes — every other upload endpoint has one; this was
// the only unthrottled write path. Supporters get the usual 5× headroom.
const PHOTO_DAILY_LIMIT = 20;

// POST /api/collection/:id/photo — upload a custom photo for a collection entry.
// Accepts multipart/form-data with a "photo" file field (JPEG/PNG/WebP, max 4 MB).
app.post('/:id/photo', async (c) => {
  const userId = c.get('userId');
  const id = parseInt(c.req.param('id'), 10);
  if (!id) return c.json({ error: 'Invalid id' }, 400);

  const row = await c.env.DB.prepare(
    'SELECT set_num FROM user_collection WHERE id=? AND user_id=? AND deleted_at IS NULL'
  ).bind(id, userId).first<{ set_num: string }>();
  if (!row) return c.json({ error: 'Collection entry not found' }, 404);

  if (!c.env.PHOTO_BUCKET) return c.json({ error: 'Photo storage not configured' }, 503);

  {
    const pref = await c.env.DB.prepare('SELECT is_supporter FROM user_prefs WHERE user_id=?')
      .bind(userId).first<{ is_supporter: number }>();
    const limit = pref?.is_supporter ? PHOTO_DAILY_LIMIT * 5 : PHOTO_DAILY_LIMIT;
    const windowStart = new Date();
    windowStart.setUTCHours(0, 0, 0, 0);
    const rl = await c.env.DB.prepare(`
      INSERT INTO rate_limits (user_id, endpoint, window_start, hit_count)
      VALUES (?, 'photo_upload', ?, 1)
      ON CONFLICT (user_id, endpoint, window_start) DO UPDATE SET hit_count = rate_limits.hit_count + 1
      RETURNING hit_count
    `).bind(userId, windowStart.toISOString()).first<{ hit_count: number }>();
    if ((rl?.hit_count || 0) > limit) {
      return c.json({ error: `Photo upload limit: ${limit} per day.` }, 429);
    }
  }

  const form = await c.req.formData();
  const raw = form.get('photo');
  if (!raw || typeof raw === 'string') return c.json({ error: 'photo field required' }, 400);
  const file = raw as File;

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    return c.json({ error: 'Only JPEG, PNG, or WebP images are accepted' }, 415);
  }

  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > 4_000_000) return c.json({ error: 'Image too large (max 4 MB)' }, 413);

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const key = `${userId}/${row.set_num}.${ext}`;

  await c.env.PHOTO_BUCKET.put(key, bytes, {
    httpMetadata: { contentType: file.type },
    customMetadata: { userId, setNum: row.set_num, uploadedAt: new Date().toISOString() },
  });

  // Store the R2 key as a path reference in user_collection
  const photoUrl = `/api/collection/${id}/photo`;
  await c.env.DB.prepare(
    'UPDATE user_collection SET custom_image_url=? WHERE id=? AND user_id=?'
  ).bind(photoUrl, id, userId).run();

  return c.json({ ok: true, url: photoUrl });
});

// GET /api/collection/:id/photo — serve the stored photo
app.get('/:id/photo', async (c) => {
  const userId = c.get('userId');
  const id = parseInt(c.req.param('id'), 10);
  if (!id) return c.json({ error: 'Invalid id' }, 400);

  const row = await c.env.DB.prepare(
    'SELECT set_num FROM user_collection WHERE id=? AND user_id=? AND deleted_at IS NULL'
  ).bind(id, userId).first<{ set_num: string }>();
  if (!row) return c.json({ error: 'Not found' }, 404);

  if (!c.env.PHOTO_BUCKET) return c.json({ error: 'Photo storage not configured' }, 503);

  // Try all supported extensions
  for (const ext of ['jpg', 'png', 'webp']) {
    const key = `${userId}/${row.set_num}.${ext}`;
    const obj = await c.env.PHOTO_BUCKET.get(key);
    if (obj) {
      const headers = new Headers();
      headers.set('Content-Type', obj.httpMetadata?.contentType || 'image/jpeg');
      headers.set('Cache-Control', 'private, max-age=86400');
      return new Response(obj.body, { headers });
    }
  }
  return c.json({ error: 'No photo uploaded' }, 404);
});

// DELETE /api/collection/:id/photo — remove the stored photo
app.delete('/:id/photo', async (c) => {
  const userId = c.get('userId');
  const id = parseInt(c.req.param('id'), 10);
  if (!id) return c.json({ error: 'Invalid id' }, 400);

  const row = await c.env.DB.prepare(
    'SELECT set_num FROM user_collection WHERE id=? AND user_id=? AND deleted_at IS NULL'
  ).bind(id, userId).first<{ set_num: string }>();
  if (!row) return c.json({ error: 'Not found' }, 404);

  if (!c.env.PHOTO_BUCKET) return c.json({ error: 'Photo storage not configured' }, 503);

  for (const ext of ['jpg', 'png', 'webp']) {
    await c.env.PHOTO_BUCKET.delete(`${userId}/${row.set_num}.${ext}`).catch(() => {});
  }

  await c.env.DB.prepare(
    'UPDATE user_collection SET custom_image_url=NULL WHERE id=? AND user_id=?'
  ).bind(id, userId).run();

  return c.body(null, 204);
});

// --- Set stories -----------------------------------------------------------
// Per-user memories on a set's timeline: short notes and photos. Keyed by
// set_num so the story survives selling and re-adding; the collection entry
// is only the authorization handle + a hint of which copy it was about.

const STORY_BODY_MAX = 1000;
const STORY_LIST_MAX = 100;

// GET /api/collection/:id/story — the timeline for this entry's set.
app.get('/:id/story', async (c) => {
  const userId = c.get('userId');
  const id = parseInt(c.req.param('id'), 10);
  if (!id) return c.json({ error: 'Invalid id' }, 400);
  const row = await c.env.DB.prepare(
    'SELECT set_num FROM user_collection WHERE id=? AND user_id=?'
  ).bind(id, userId).first<{ set_num: string }>();
  if (!row) return c.json({ error: 'Collection entry not found' }, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT id, kind, body, created_at, (r2_key IS NOT NULL) AS has_photo
     FROM collection_stories WHERE user_id=? AND set_num=?
     ORDER BY created_at DESC, id DESC LIMIT ${STORY_LIST_MAX}`
  ).bind(userId, row.set_num).all();
  return c.json({ set_num: row.set_num, stories: results || [] });
});

// POST /api/collection/:id/story — add a memory. JSON {body} adds a note;
// multipart/form-data with a "photo" field adds a photo (optional caption in
// a "body" form field). Photos share the photo_upload daily ledger.
app.post('/:id/story', async (c) => {
  const userId = c.get('userId');
  const id = parseInt(c.req.param('id'), 10);
  if (!id) return c.json({ error: 'Invalid id' }, 400);
  const row = await c.env.DB.prepare(
    'SELECT set_num FROM user_collection WHERE id=? AND user_id=? AND deleted_at IS NULL'
  ).bind(id, userId).first<{ set_num: string }>();
  if (!row) return c.json({ error: 'Collection entry not found' }, 404);

  const contentType = c.req.header('content-type') || '';

  if (!contentType.includes('multipart/form-data')) {
    const { body } = await c.req.json<{ body?: string }>().catch(() => ({} as { body?: string }));
    const text = String(body || '').trim();
    if (!text) return c.json({ error: 'body required' }, 400);
    if (text.length > STORY_BODY_MAX) return c.json({ error: `Note too long (max ${STORY_BODY_MAX} chars)` }, 400);
    const ins = await c.env.DB.prepare(
      `INSERT INTO collection_stories (user_id, set_num, collection_id, kind, body) VALUES (?,?,?,'note',?) RETURNING id, created_at`
    ).bind(userId, row.set_num, id, text).first<{ id: number; created_at: string }>();
    return c.json({ ok: true, id: ins?.id, kind: 'note', body: text, created_at: ins?.created_at });
  }

  // Photo story — same guards + daily ledger as the custom-photo upload.
  if (!c.env.PHOTO_BUCKET) return c.json({ error: 'Photo storage not configured' }, 503);
  {
    const pref = await c.env.DB.prepare('SELECT is_supporter FROM user_prefs WHERE user_id=?')
      .bind(userId).first<{ is_supporter: number }>();
    const limit = pref?.is_supporter ? PHOTO_DAILY_LIMIT * 5 : PHOTO_DAILY_LIMIT;
    const windowStart = new Date();
    windowStart.setUTCHours(0, 0, 0, 0);
    const rl = await c.env.DB.prepare(`
      INSERT INTO rate_limits (user_id, endpoint, window_start, hit_count)
      VALUES (?, 'photo_upload', ?, 1)
      ON CONFLICT (user_id, endpoint, window_start) DO UPDATE SET hit_count = rate_limits.hit_count + 1
      RETURNING hit_count
    `).bind(userId, windowStart.toISOString()).first<{ hit_count: number }>();
    if ((rl?.hit_count || 0) > limit) {
      return c.json({ error: `Photo upload limit: ${limit} per day.` }, 429);
    }
  }
  const form = await c.req.formData();
  const raw = form.get('photo');
  if (!raw || typeof raw === 'string') return c.json({ error: 'photo field required' }, 400);
  const file = raw as File;
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    return c.json({ error: 'Only JPEG, PNG, or WebP images are accepted' }, 415);
  }
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > 4_000_000) return c.json({ error: 'Image too large (max 4 MB)' }, 413);
  const caption = String(form.get('body') || '').trim().slice(0, STORY_BODY_MAX) || null;

  const ins = await c.env.DB.prepare(
    `INSERT INTO collection_stories (user_id, set_num, collection_id, kind, body) VALUES (?,?,?,'photo',?) RETURNING id, created_at`
  ).bind(userId, row.set_num, id, caption).first<{ id: number; created_at: string }>();
  if (!ins) return c.json({ error: 'Could not save story' }, 500);
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const key = `stories/${userId}/${ins.id}.${ext}`;
  await c.env.PHOTO_BUCKET.put(key, bytes, {
    httpMetadata: { contentType: file.type },
    customMetadata: { userId, setNum: row.set_num, storyId: String(ins.id) },
  });
  await c.env.DB.prepare('UPDATE collection_stories SET r2_key=? WHERE id=?').bind(key, ins.id).run();
  return c.json({ ok: true, id: ins.id, kind: 'photo', body: caption, created_at: ins.created_at, has_photo: 1 });
});

// GET /api/collection/story/:storyId/photo — serve a story photo (owner only).
app.get('/story/:storyId/photo', async (c) => {
  const userId = c.get('userId');
  const storyId = parseInt(c.req.param('storyId'), 10);
  if (!storyId) return c.json({ error: 'Invalid id' }, 400);
  const row = await c.env.DB.prepare(
    'SELECT r2_key FROM collection_stories WHERE id=? AND user_id=?'
  ).bind(storyId, userId).first<{ r2_key: string | null }>();
  if (!row?.r2_key || !c.env.PHOTO_BUCKET) return c.json({ error: 'Not found' }, 404);
  const obj = await c.env.PHOTO_BUCKET.get(row.r2_key);
  if (!obj) return c.json({ error: 'Not found' }, 404);
  const headers = new Headers();
  headers.set('Content-Type', obj.httpMetadata?.contentType || 'image/jpeg');
  headers.set('Cache-Control', 'private, max-age=86400');
  return new Response(obj.body, { headers });
});

// DELETE /api/collection/story/:storyId — remove a memory (and its photo).
app.delete('/story/:storyId', async (c) => {
  const userId = c.get('userId');
  const storyId = parseInt(c.req.param('storyId'), 10);
  if (!storyId) return c.json({ error: 'Invalid id' }, 400);
  const row = await c.env.DB.prepare(
    'SELECT r2_key FROM collection_stories WHERE id=? AND user_id=?'
  ).bind(storyId, userId).first<{ r2_key: string | null }>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.r2_key && c.env.PHOTO_BUCKET) await c.env.PHOTO_BUCKET.delete(row.r2_key).catch(() => {});
  await c.env.DB.prepare('DELETE FROM collection_stories WHERE id=? AND user_id=?').bind(storyId, userId).run();
  return c.body(null, 204);
});

export { app as photosRoute };
