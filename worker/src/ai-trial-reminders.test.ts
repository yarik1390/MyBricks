/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pushes: { userId: string; payload: any }[] = [];
vi.mock('./jobs/wishlist-alerts', () => ({
  sendPushToUser: vi.fn(async (_env: unknown, userId: string, payload: string) => { pushes.push({ userId, payload: JSON.parse(payload) }); }),
}));

import { runAiTrialReminders, trialReminderMessage } from './jobs/ai-trial-reminders';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;
const NOW = new Date('2026-11-20T08:00:00Z');

async function start(userId: string, daysAgo: number) {
  const s = new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
  await db.prepare('INSERT INTO ai_trials (user_id, started_at) VALUES (?, ?)').bind(userId, s).run();
}

describe('AI trial reminders', () => {
  beforeEach(async () => {
    pushes.length = 0;
    await db.prepare('DROP TABLE IF EXISTS ai_trials').run();
    await applyTestTables(db, ['ai_trials']);
  });

  it('pushes once when 3 days or less are left, and once when the trial ends', async () => {
    await start('fresh', 2);      // 12 days left: nothing
    await start('ending', 11.5);  // 3 days left
    await start('ended', 14.5);   // just ended
    await start('old', 40);       // ended long ago: never told

    expect(await runAiTrialReminders(env as any, NOW)).toEqual({ ending: 1, ended: 1 });
    expect(pushes.map(p => p.userId).sort()).toEqual(['ended', 'ending']);
    const ending = pushes.find(p => p.userId === 'ending')!.payload;
    expect(ending.title).toBe('Free AI trial: 3 days left');
    expect(ending.url).toBe('#/me?ai=trial');
    expect(pushes.find(p => p.userId === 'ended')!.payload.title).toBe('Your free AI trial has ended');

    // Latched: a second run the same day sends nothing.
    pushes.length = 0;
    expect(await runAiTrialReminders(env as any, NOW)).toEqual({ ending: 0, ended: 0 });
    expect(pushes).toEqual([]);

    // Four days later the "ending" account has ended: it gets the end push once.
    const later = new Date(NOW.getTime() + 4 * 86_400_000);
    expect(await runAiTrialReminders(env as any, later)).toEqual({ ending: 0, ended: 1 });
    expect(pushes.map(p => p.userId)).toEqual(['ending']);
  });

  it('words the last day in the singular', () => {
    expect(trialReminderMessage('ending', 1).title).toBe('Free AI trial: 1 day left');
  });
});
