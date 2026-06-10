import { Hono } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', requireMember);

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

export { app as photosRoute };
