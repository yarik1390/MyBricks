/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyTestTables } from './test-schema';
import {
  confirmTrainingScanPhoto, deleteTrainingPhotos, pruneUnconfirmedTrainingPhotos,
  saveTrainingScanPhoto, trainingPhotosEnabled,
} from './lib/training-scan-photos';

const db = (env as any).DB as D1Database;
const store = new Map<string, Uint8Array>();
const bucket = {
  put: async (k: string, v: Uint8Array) => { store.set(k, v); },
  delete: async (k: string | string[]) => { for (const x of [k].flat()) store.delete(x); },
};
const e = () => ({ DB: db, PHOTO_BUCKET: bucket } as any);
const jpeg = `data:image/jpeg;base64,${btoa('fake-jpeg-bytes')}`;

describe('opt-in training scan photos', () => {
  beforeEach(async () => {
    store.clear();
    await applyTestTables(db, ['user_prefs', 'training_scan_photos']);
    await db.prepare("INSERT INTO user_prefs (user_id, training_photos) VALUES ('in', 1), ('out', 0)").run();
  });

  it('is off unless the member opted in', async () => {
    expect(await trainingPhotosEnabled(e(), 'in')).toBe(true);
    expect(await trainingPhotosEnabled(e(), 'out')).toBe(false);
    expect(await trainingPhotosEnabled(e(), 'nobody')).toBe(false);
    expect(await trainingPhotosEnabled({ DB: db } as any, 'in')).toBe(false); // no bucket
  });

  it('stores the photo under the member prefix and labels it on confirm', async () => {
    const id = (await saveTrainingScanPhoto(e(), 'in', jpeg, '75192-1'))!;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect([...store.keys()]).toEqual([`training/scans/in/${id}.jpg`]);
    expect(await confirmTrainingScanPhoto(e(), 'someone-else', id, '75192-1')).toBe(false);
    expect(await confirmTrainingScanPhoto(e(), 'in', id, '75192-1')).toBe(true);
    const row = await db.prepare('SELECT confirmed_set_num FROM training_scan_photos WHERE id=?').bind(id).first<any>();
    expect(row.confirmed_set_num).toBe('75192-1');
    expect(await saveTrainingScanPhoto(e(), 'in', 'not-a-data-url', null)).toBeNull();
  });

  it('deletes everything when switched off and prunes old unconfirmed photos', async () => {
    const a = (await saveTrainingScanPhoto(e(), 'in', jpeg, null))!;
    const b = (await saveTrainingScanPhoto(e(), 'in', jpeg, null))!;
    await confirmTrainingScanPhoto(e(), 'in', b, '10294-1');
    await db.prepare("UPDATE training_scan_photos SET created_at=datetime('now','-31 days')").run();
    expect(await pruneUnconfirmedTrainingPhotos(e())).toBe(1);
    expect(store.size).toBe(1);
    expect((await db.prepare('SELECT id FROM training_scan_photos').all<any>()).results.map((r) => r.id)).toEqual([b]);
    void a;
    await deleteTrainingPhotos(e(), 'in');
    expect(store.size).toBe(0);
    expect((await db.prepare('SELECT COUNT(*) n FROM training_scan_photos').first<any>()).n).toBe(0);
  });
});
