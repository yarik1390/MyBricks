/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { runCollectionBackups, backupKey, BACKUP_RETENTION_WEEKS } from './jobs/collection-backups';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;

// Map-backed R2 stub covering the four calls the job + routes use.
function r2Stub() {
  const store = new Map<string, string>();
  return {
    store,
    put: async (k: string, v: string) => { store.set(k, v); },
    get: async (k: string) => {
      const v = store.get(k);
      return v == null ? null : { body: v, text: async () => v };
    },
    delete: async (k: string) => { store.delete(k); },
    list: async ({ prefix }: { prefix: string }) => ({
      objects: [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })),
    }),
  };
}

describe('runCollectionBackups', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'user_collection']);
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name) VALUES ('B-1','Backup Set')`),
      db.prepare(`INSERT INTO user_collection (user_id, set_num, quantity, purchase_price) VALUES ('u1','B-1', 2, 99.5)`),
    ]);
  });

  it('writes a dated snapshot per user with every row serialized', async () => {
    const bucket = r2Stub();
    const r = await runCollectionBackups({ ...env, PHOTO_BUCKET: bucket } as any);
    expect(r.users).toBe(1);
    const today = new Date().toISOString().slice(0, 10);
    const raw = bucket.store.get(backupKey('u1', today));
    expect(raw).toBeTruthy();
    const snap = JSON.parse(raw!);
    expect(snap.rows).toHaveLength(1);
    expect(snap.rows[0].purchase_price).toBe(99.5);
    expect(snap.rows[0].quantity).toBe(2);
  });

  it('prunes snapshots older than the retention window', async () => {
    const bucket = r2Stub();
    const oldDate = new Date(Date.now() - (BACKUP_RETENTION_WEEKS * 7 + 3) * 86_400_000).toISOString().slice(0, 10);
    bucket.store.set(backupKey('u1', oldDate), '{"rows":[]}');
    const r = await runCollectionBackups({ ...env, PHOTO_BUCKET: bucket } as any);
    expect(r.pruned).toBe(1);
    expect(bucket.store.has(backupKey('u1', oldDate))).toBe(false);
  });

  it('is a clean skip without the bucket binding', async () => {
    const r = await runCollectionBackups({ ...env, PHOTO_BUCKET: undefined } as any);
    expect(r.skipped).toMatch(/not configured/);
  });
});
