import type { Env } from '../types';

// Weekly per-user collection snapshots to R2 ("never lose a brick").
//
// D1's point-in-time recovery protects the whole database from US; these
// snapshots protect each USER from themselves — a bad bulk import, an
// over-eager cleanup — with a visible, self-serve restore in Settings → Data.
// Every column is serialized (including soft-deleted rows, so a restore can
// un-delete) and objects live under backups/{user_id}/{YYYY-MM-DD}.json with
// an 8-week retention prune. The photo bucket is reused: backups are tiny
// (a few KB of JSON per user) next to photos.

export const BACKUP_RETENTION_WEEKS = 8;
const USERS_PER_RUN = 500;

export const backupKey = (userId: string, date: string) => `backups/${userId}/${date}.json`;

export async function runCollectionBackups(env: Env) {
  if (!env.PHOTO_BUCKET) return { users: 0, pruned: 0, skipped: 'PHOTO_BUCKET not configured' };
  const today = new Date().toISOString().slice(0, 10);

  const { results: users } = await env.DB.prepare(`
    SELECT DISTINCT user_id FROM user_collection WHERE deleted_at IS NULL LIMIT ?
  `).bind(USERS_PER_RUN).all<{ user_id: string }>();

  let written = 0;
  for (const u of users) {
    const { results: rows } = await env.DB.prepare(
      `SELECT * FROM user_collection WHERE user_id = ?`,
    ).bind(u.user_id).all();
    if (!rows.length) continue;
    const body = JSON.stringify({ version: 1, user_id: u.user_id, date: today, rows });
    await env.PHOTO_BUCKET.put(backupKey(u.user_id, today), body, {
      httpMetadata: { contentType: 'application/json' },
    }).catch(() => {});
    written++;
  }

  // Retention prune: list each backed-up user's prefix and delete anything
  // older than the retention window (object keys embed the date, so no
  // metadata reads are needed).
  const cutoff = new Date(Date.now() - BACKUP_RETENTION_WEEKS * 7 * 86_400_000)
    .toISOString().slice(0, 10);
  let pruned = 0;
  for (const u of users) {
    const listing = await env.PHOTO_BUCKET.list({ prefix: `backups/${u.user_id}/` }).catch(() => null);
    for (const obj of listing?.objects ?? []) {
      const date = obj.key.slice(obj.key.lastIndexOf('/') + 1).replace(/\.json$/, '');
      if (date < cutoff) {
        await env.PHOTO_BUCKET.delete(obj.key).catch(() => {});
        pruned++;
      }
    }
  }

  return { users: written, pruned };
}
