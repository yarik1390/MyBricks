import type { Env } from '../types';
import type { RouteStep } from './llm-routing';
import { GROQ_SCAN_MODEL } from './llm-routing';
import { WORKERS_AI_SCAN_MODEL } from './workers-ai';

// ---------------------------------------------------------------------------
// BYOK-first AI access (2026-11-08, Iaroslav).
//
// Every new account gets a trial: for AI_TRIAL_DAYS after its first AI request
// the shared server keys, paid Gemini included, power every AI feature within
// the usual per-feature daily limits. After the trial:
//   - users with their own Gemini/OpenAI key (BYOK) keep everything, unlimited;
//   - everyone else keeps EVERY feature on the FREE providers only (Workers AI,
//     Groq), within the same daily limits. Barcode and Brickognize are not AI
//     and never count. Iaroslav: "Barcode and Brickognize, and free models stay
//     free for all the features."
// The paid Gemini/OpenAI server keys are never used for an account past its
// trial; hitting a daily limit then suggests adding a free key.
//
// The trial clock lives in its own table (`ai_trials`) and starts lazily, on
// the first AI call, so it needs no account-creation date. Every read fails
// OPEN (an accounting outage must not lock people out of the app).
// ---------------------------------------------------------------------------

export const AI_TRIAL_DAYS = 14;

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
  /** Past the trial: free providers only, same daily limits. */
  | { mode: 'free'; trial: AiTrial };

/**
 * Decide how a request for `feature` may use AI. BYOK always wins. Guests
 * (no userId) are handled by the callers' existing guest rules and get trial
 * treatment here. Nothing is ever blocked: past the trial it is free models.
 */
export async function aiAccess(env: Env, userId: string | null | undefined, _feature: AiFeature, byok: boolean): Promise<AiAccess> {
  if (byok) return { mode: 'byok' };
  if (!userId) return { mode: 'trial', trial: trialFrom(null) };
  const trial = await touchAiTrial(env, userId);
  if (trial.active) return { mode: 'trial', trial };
  return { mode: 'free', trial };
}

/** Extra JSON for a 429 on the free path: the app offers the free-key sheet. */
export function byokSuggested(feature: AiFeature, access: AiAccess) {
  return access.mode === 'free' ? { code: 'byok_suggested', feature } : {};
}

/** Providers a post-trial (free) request may use: never a billed key. */
export const FREE_ONLY_PROVIDERS = new Set(['workersai', 'groq']);

/** The free steps used when a route holds none (e.g. an older stored admin route). */
export const FREE_FALLBACK_STEPS: RouteStep[] = [
  { provider: 'workersai', model: WORKERS_AI_SCAN_MODEL, enabled: true },
  { provider: 'groq', model: GROQ_SCAN_MODEL, enabled: true },
];

/** Keep only free providers; fall back to the default free pair when none are left. */
export function freeOnlySteps(steps: RouteStep[]): RouteStep[] {
  const free = steps.filter((s) => FREE_ONLY_PROVIDERS.has(s.provider));
  return free.length ? free : FREE_FALLBACK_STEPS.map((s) => ({ ...s }));
}
