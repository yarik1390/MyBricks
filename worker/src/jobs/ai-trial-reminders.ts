import type { Env } from '../types';
import { AI_TRIAL_DAYS } from '../lib/ai-access';
import { sendPushToUser } from './wishlist-alerts';

// AI trial reminders (daily, 08:00 UTC, after wishlist alerts). Two pushes per
// account, each sent once (latched in ai_trials):
//   - "ending": when the trial has 3 days or less left;
//   - "ended": the first run after it ends (only for trials that ended in the
//     last week, so old accounts aren't told about a trial long gone).
// The app shows the same countdown on Profile → AI features and a one-a-day
// snackbar in the last 3 days (components/byok-sheet.js maybeRemindAiTrial).
// Tapping either push opens Profile with the free-key sheet.

export const AI_TRIAL_REMIND_DAYS = 3;
const BATCH = 200;
const TAP_URL = '#/me?ai=trial';

export function trialReminderMessage(kind: 'ending' | 'ended', daysLeft = AI_TRIAL_REMIND_DAYS): { title: string; body: string } {
  if (kind === 'ended') {
    return {
      title: 'Your free AI trial has ended',
      body: 'Scans, the advisor and every AI feature keep working on free models. Add your free Gemini key to remove the daily limits.',
    };
  }
  const n = Math.max(1, Math.round(daysLeft));
  return {
    title: `Free AI trial: ${n} ${n === 1 ? 'day' : 'days'} left`,
    body: 'After that AI keeps working on free models with daily limits. Add your free Gemini key (2 minutes) to keep it unlimited.',
  };
}

const sqlTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const parse = (s: string) => Date.parse(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);

export async function runAiTrialReminders(env: Env, now = new Date()) {
  const day = 86_400_000;
  const t = now.getTime();
  const trialEndsBy = sqlTime(t - (AI_TRIAL_DAYS - AI_TRIAL_REMIND_DAYS) * day); // ends within 3 days
  const trialEnded = sqlTime(t - AI_TRIAL_DAYS * day);
  const endedRecently = sqlTime(t - (AI_TRIAL_DAYS + 7) * day);

  const ending = await env.DB.prepare(
    `SELECT user_id, started_at FROM ai_trials
      WHERE ending_notified_at IS NULL AND ended_notified_at IS NULL
        AND started_at <= ? AND started_at > ?
      LIMIT ?`,
  ).bind(trialEndsBy, trialEnded, BATCH).all<{ user_id: string; started_at: string }>()
    .catch(() => ({ results: [] as { user_id: string; started_at: string }[] }));
  let endingSent = 0;
  for (const row of ending.results || []) {
    const start = parse(row.started_at);
    const left = Number.isFinite(start) ? Math.ceil((start + AI_TRIAL_DAYS * day - t) / day) : AI_TRIAL_REMIND_DAYS;
    // Latch first so a push failure never repeats the reminder daily.
    await env.DB.prepare('UPDATE ai_trials SET ending_notified_at = ? WHERE user_id = ?')
      .bind(sqlTime(t), row.user_id).run().catch(() => {});
    const { title, body } = trialReminderMessage('ending', left);
    await sendPushToUser(env, row.user_id, JSON.stringify({ title, body, url: TAP_URL })).catch(() => {});
    endingSent++;
  }

  const ended = await env.DB.prepare(
    `SELECT user_id FROM ai_trials
      WHERE ended_notified_at IS NULL AND started_at <= ? AND started_at > ?
      LIMIT ?`,
  ).bind(trialEnded, endedRecently, BATCH).all<{ user_id: string }>()
    .catch(() => ({ results: [] as { user_id: string }[] }));
  let endedSent = 0;
  for (const row of ended.results || []) {
    await env.DB.prepare('UPDATE ai_trials SET ended_notified_at = ? WHERE user_id = ?')
      .bind(sqlTime(t), row.user_id).run().catch(() => {});
    const { title, body } = trialReminderMessage('ended');
    await sendPushToUser(env, row.user_id, JSON.stringify({ title, body, url: TAP_URL })).catch(() => {});
    endedSent++;
  }
  return { ending: endingSent, ended: endedSent };
}
