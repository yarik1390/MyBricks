import type { Env } from '../types';

/**
 * Opt-in scan photos for training the scan model (user_prefs.training_photos,
 * "Help improve photo recognition" in Settings > Data). Off by default.
 *
 * A photo scan from an opted-in member is kept in R2 under
 * training/scans/<user>/<id>.jpg. When the member then adds a set from that
 * scan, the set becomes the photo's label (confirmed_set_num). Unconfirmed
 * photos are deleted after 30 days; all of a member's photos are deleted when
 * they switch it off or delete their account. Never for kids profiles (the app
 * hides the switch) or guests (no account).
 */
const MAX_BYTES = 1_500_000;
const prefix = (userId: string) => `training/scans/${userId}/`;

export async function trainingPhotosEnabled(env: Env, userId: string): Promise<boolean> {
  if (!userId || !env.PHOTO_BUCKET) return false;
  const row = await env.DB.prepare('SELECT training_photos FROM user_prefs WHERE user_id=?')
    .bind(userId).first<{ training_photos: number | null }>().catch(() => null);
  return row?.training_photos === 1;
}

function decodeDataUrl(image: string): { bytes: Uint8Array; type: string } | null {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image);
  if (!m) return null;
  try {
    const bin = atob(m[2]);
    if (!bin.length || bin.length > MAX_BYTES) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, type: m[1] };
  } catch { return null; }
}

/** Store the scan photo; returns its id for the app to confirm later, or null. */
export async function saveTrainingScanPhoto(env: Env, userId: string, image: string, predictedSetNum: string | null): Promise<string | null> {
  const decoded = decodeDataUrl(image);
  if (!decoded || !env.PHOTO_BUCKET) return null;
  const id = crypto.randomUUID();
  const key = `${prefix(userId)}${id}.${decoded.type === 'image/png' ? 'png' : decoded.type === 'image/webp' ? 'webp' : 'jpg'}`;
  try {
    await env.PHOTO_BUCKET.put(key, decoded.bytes, { httpMetadata: { contentType: decoded.type } });
    await env.DB.prepare('INSERT INTO training_scan_photos (id, user_id, r2_key, predicted_set_num) VALUES (?, ?, ?, ?)')
      .bind(id, userId, key, predictedSetNum).run();
    return id;
  } catch (e) {
    console.warn('[training-photos] save failed:', (e as Error)?.message);
    return null;
  }
}

export async function confirmTrainingScanPhoto(env: Env, userId: string, id: string, setNum: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9A-Za-z][0-9A-Za-z-]{0,30}$/.test(setNum)) return false;
  const res = await env.DB.prepare(
    "UPDATE training_scan_photos SET confirmed_set_num=?, confirmed_at=datetime('now') WHERE id=? AND user_id=?",
  ).bind(setNum, id, userId).run();
  return (res.meta.changes ?? 0) > 0;
}

async function deleteKeys(env: Env, keys: string[]) {
  if (!env.PHOTO_BUCKET) return;
  for (let i = 0; i < keys.length; i += 500) {
    await env.PHOTO_BUCKET.delete(keys.slice(i, i + 500)).catch(() => {});
  }
}

export async function deleteTrainingPhotos(env: Env, userId: string): Promise<void> {
  const { results } = await env.DB.prepare('SELECT r2_key FROM training_scan_photos WHERE user_id=?')
    .bind(userId).all<{ r2_key: string }>();
  await deleteKeys(env, (results ?? []).map((r) => r.r2_key));
  await env.DB.prepare('DELETE FROM training_scan_photos WHERE user_id=?').bind(userId).run();
}

/** Daily hygiene: drop photos nobody confirmed within 30 days. */
export async function pruneUnconfirmedTrainingPhotos(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(
    "SELECT id, r2_key FROM training_scan_photos WHERE confirmed_set_num IS NULL AND created_at < datetime('now', '-30 days') LIMIT 1000",
  ).all<{ id: string; r2_key: string }>();
  if (!results?.length) return 0;
  await deleteKeys(env, results.map((r) => r.r2_key));
  for (let i = 0; i < results.length; i += 90) {
    const ids = results.slice(i, i + 90).map((r) => r.id);
    await env.DB.prepare(`DELETE FROM training_scan_photos WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).run();
  }
  return results.length;
}
