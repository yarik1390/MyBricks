import type { Env } from '../types';

// ---------------------------------------------------------------------------
// BYOK-first AI access (2026-11-08, Iaroslav).
//
// Every new account gets a trial: for AI_TRIAL_DAYS after its first AI request
// the shared server keys power every AI feature, within the usual per-feature
// daily limits. After the trial:
//   - users with their own Gemini/OpenAI key (BYOK) keep everything, unlimited;
//   - photo scans keep working on the FREE providers only (Workers AI, Groq),
//     at POST_TRIAL_SCAN_DAILY_LIMIT a day — scanning is the app's front door;
//   - shelf scans, the advisor, listing drafts and box grading need a key.
// The paid Gemini key is never used for an account past its trial.
//
// The trial clock lives in its own table (`ai_trials`) and starts lazily, on
// the first AI call, so it needs no account-creation date. Every read fails
// OPEN (an accounting outage must not lock people out of the app).
// ---------------------------------------------------------------------------

export const AI_TRIAL_DAYS = 14;
export const POST_TRIAL_SCAN_DAILY_LIMIT = 5;

export type AiFeature = 'scan' | 'shelf' | 'advisor' | 'listing' | 'grade';

export interface AiTrial {
  started_at: string | null;
  ends_at: string | null;
  active: boolean;
  days_left: number;
}

/** True when the request carries the user's own provider key. */
export function hasByok(headers: { get(name: string): string | null | undefined } | ((name: string) => string | undefined)): boolean {
  const read = typeof headers === 'function' ? headers : (n: string) => headers.get(n) ?? undefined;
  return !!((read('X-Gemini-Key') || '').trim() || (read('X-OpenAI-Key') || '').trim());
}

function trialFrom(startedAt: string | null, now = Date.now()): AiTrial {
  if (!startedAt) {
    return { started_at: null, ends_at: null, active: true, days_left: AI_TRIAL_DAYS };
  }
  const start = Date.parse(startedAt.includes('T') ? startedAt : `${startedAt.replace(' ', 'T')}Z`);
  if (!Number.isFinite(start)) return { started_at: startedAt, ends_at: null, active: true, days_left: AI_TRIAL_DAYS };
  const end = start + AI_TRIAL_DAYS * 86_400_000;
  const left = Math.max(0, Math.ceil((end - now) / 86_400_000));
  return { started_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString(), active: now < end, days_left: left };
}

/** Read the trial without starting it (for /api/me). Fails open as "not started". */
export async function readAiTrial(env: Env, userId: string, now = Date.now()): Promise<AiTrial> {
  if (!userId) return trialFrom(null, now);
  try {
    const row = await env.DB.prepare('SELECT started_at FROM ai_trials WHERE user_id=?')
      .bind(userId).first<{ started_at: string }>();
    return trialFrom(row?.started_at ?? null, now);
  } catch {
    return trialFrom(null, now);
  }
}

/** Start the trial clock on first AI use (idempotent) and return its state. */
export async function touchAiTrial(env: Env, userId: string, now = Date.now()): Promise<AiTrial> {
  if (!userId) return trialFrom(null, now);
  try {
    const row = await env.DB.prepare(
      `INSERT INTO ai_trials (user_id, started_at) VALUES (?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET started_at = ai_trials.started_at
       RETURNING started_at`,
    ).bind(userId).first<{ started_at: string }>();
    return trialFrom(row?.started_at ?? null, now);
  } catch {
    return trialFrom(null, now);
  }
}

export type AiAccess =
  | { mode: 'byok' }
  | { mode: 'trial'; trial: AiTrial }
  /** Past the trial, free providers only, with a smaller daily limit. */
  | { mode: 'free'; trial: AiTrial; dailyLimit: number }
  | { mode: 'blocked'; trial: AiTrial };

/**
 * Decide how a request for `feature` may use AI. BYOK always wins. Guests
 * (no userId) are handled by the callers' existing guest rules and get trial
 * treatment here.
 */
export async function aiAccess(env: Env, userId: string | null | undefined, feature: AiFeature, byok: boolean): Promise<AiAccess> {
  if (byok) return { mode: 'byok' };
  if (!userId) return { mode: 'trial', trial: trialFrom(null) };
  const trial = await touchAiTrial(env, userId);
  if (trial.active) return { mode: 'trial', trial };
  if (feature === 'scan') return { mode: 'free', trial, dailyLimit: POST_TRIAL_SCAN_DAILY_LIMIT };
  return { mode: 'blocked', trial };
}

/** JSON body for a blocked request. The app opens the "add your key" sheet on this code. */
export function byokRequiredBody(feature: AiFeature) {
  return {
    error: 'Your free AI trial has ended. Add your own free Gemini key in Settings to keep using this feature.',
    code: 'byok_required',
    feature,
  };
}

/** Providers a post-trial (free) request may use: never a billed key. */
export const FREE_ONLY_PROVIDERS = new Set(['workersai', 'groq']);
