// ---------------------------------------------------------------------------
// What to do about a failing or missed background job.
//
// Admin used to show only the raw error and a Run now button, even when
// re-running could not help (2026-11-13: "PriceCharting (bulk fetch) is
// failing, D1_ERROR: too many columns in result set" was a code bug). This
// turns the error text, the failure streak and the job's known services into
// one concrete recommendation: retry, wait, fix a key, top up, raise a limit,
// or get the code fixed. Pure: no I/O, so it is unit-tested directly.
// ---------------------------------------------------------------------------

export type AdviceKind = 'retry' | 'wait' | 'key' | 'topup' | 'quota' | 'code' | 'check';

export interface JobAdvice {
  kind: AdviceKind;
  /** One short sentence: the recommendation itself. */
  title: string;
  /** Plain-language reason / next steps (1–3 lines). */
  steps: string[];
  /** Whether pressing Run now can be expected to help. */
  retryHelps: boolean;
  /** Service the advice is about, when known (for the Services tab link). */
  service?: string;
}

interface ServiceInfo {
  label: string;
  /** GitHub secret(s) holding the credential. */
  secrets?: string[];
  /** Where credits are bought, when the service is prepaid. */
  billing?: string;
}

const SERVICES: Record<string, ServiceInfo> = {
  pricecharting: { label: 'PriceCharting', secrets: ['PRICECHARTING_TOKEN'], billing: 'pricecharting.com → Subscriptions' },
  bricklink: { label: 'BrickLink', secrets: ['BRICKLINK_CONSUMER_KEY', 'BRICKLINK_CONSUMER_SECRET', 'BRICKLINK_TOKEN', 'BRICKLINK_TOKEN_SECRET'] },
  ebay: { label: 'eBay', secrets: ['EBAY_APP_ID', 'EBAY_CLIENT_SECRET'] },
  brickset: { label: 'Brickset', secrets: ['BRICKSET_API_KEY'] },
  rebrickable: { label: 'Rebrickable', secrets: ['REBRICKABLE_API_KEY'] },
  firecrawl: { label: 'Firecrawl', secrets: ['FIRECRAWL_API_KEYS'], billing: 'firecrawl.dev → Billing' },
  brightdata: { label: 'Bright Data', secrets: ['BRIGHTDATA_API_TOKENS'], billing: 'brightdata.com → Billing' },
  gemini: { label: 'Gemini', secrets: ['GEMINI_API_KEY'], billing: 'Google Cloud console → Billing' },
  groq: { label: 'Groq', secrets: ['GROQ_API_KEY'] },
  openrouter: { label: 'OpenRouter', secrets: ['OPENROUTER_API_KEY'], billing: 'openrouter.ai → Credits' },
  exa: { label: 'Exa', secrets: ['EXA_API_KEY'], billing: 'dashboard.exa.ai → Billing' },
  resend: { label: 'Resend (email)', secrets: ['RESEND_API_KEY'] },
  amazon: { label: 'Amazon Creators API', secrets: ['AMAZON_CREATORS_PUBLIC_KEY', 'AMAZON_CREATORS_PRIVATE_KEY'] },
  brickinsights: { label: 'BrickInsights' },
  lego: { label: 'LEGO.com' },
};

/** Outside services each job depends on, most important first. */
const JOB_SERVICES: Record<string, string[]> = {
  'pricecharting-enrich': ['pricecharting'],
  'pricecharting-link-backfill': ['pricecharting'],
  'pricecharting-bulk': ['pricecharting'],
  'pricecharting-bulk-fetch': ['pricecharting'],
  'valuate-bl-refresh': ['bricklink'],
  'valuate-bl-discovery': ['bricklink'],
  'valuate-minifigs': ['bricklink'],
  'minifig-verify': ['bricklink'],
  'part-price-backfill': ['bricklink'],
  'valuate-owned-deep': ['bricklink', 'ebay'],
  'valuate-sets': ['bricklink', 'ebay'],
  'valuate-topvalue': ['bricklink', 'ebay'],
  'valuate-ebay-ask': ['ebay'],
  'brickset-enrich': ['brickset', 'brightdata', 'firecrawl'],
  'brickinsights-ratings': ['brickinsights'],
  'lego-stock-refresh': ['brightdata', 'firecrawl', 'lego'],
  'promotions-refresh': ['brightdata', 'firecrawl', 'lego'],
  'upcoming-refresh': ['brightdata', 'firecrawl'],
  'store-offers': ['firecrawl', 'brightdata'],
  'weekly-import-sets': ['rebrickable'],
  'weekly-import-figs': ['rebrickable'],
  'bundle-values': ['rebrickable'],
  'model-refresh': ['openrouter'],
  'wishlist-alerts': ['resend'],
  'weekly-digest': ['resend'],
  'amazon-offers': ['amazon'],
  'exa-news-scan': ['exa'],
  'exa-retirement-lookups': ['exa'],
};

/** Guess the service an error is about from its text, else the job's main one. */
export function serviceFor(name: string, text: string): string | undefined {
  const t = text.toLowerCase();
  for (const key of Object.keys(SERVICES)) {
    if (key === 'lego') continue; // "LEGO" appears in too many messages to mean LEGO.com
    const label = SERVICES[key].label.toLowerCase().split(' ')[0];
    const re = new RegExp(`\\b(${key}|${label.replace(/[^a-z0-9]/g, '')})\\b`);
    if (re.test(t.replace(/[_-]/g, ' '))) return key;
  }
  if (/\bai gateway\b|code 2009/.test(t)) return 'gemini';
  return JOB_SERVICES[name]?.[0];
}

const SECRET_HOWTO = 'Update it in GitHub → repo Settings → Secrets → Actions, then run the "Deploy Brickvault" workflow with push_secrets ticked.';
const CODE_HOWTO = 'Re-running will hit the same error. Copy the error and ask Claude to fix the job; it will be fixed in a PR.';

export interface AdviceInput {
  name: string;
  health: string; // ok | failing | missed | running | idle
  error?: string | null;
  summary?: string | null;
  consecutive_failures?: number;
  /** Runs (newest first) with their errors, to spot "same error every time". */
  recent_errors?: Array<string | null>;
  /** Service names the Services tab currently reports as blocked/offline. */
  blocked_services?: string[];
}

const norm = (e: string | null | undefined) => String(e || '').replace(/\d+/g, '#').slice(0, 80);

/** Same error text (numbers ignored) on the last `n` runs. */
function repeated(input: AdviceInput, n = 2): boolean {
  const errs = (input.recent_errors || []).slice(0, n);
  return errs.length >= n && errs.every((e) => e && norm(e) === norm(errs[0]));
}

export function adviseJob(input: AdviceInput): JobAdvice | null {
  const { name, health } = input;
  if (health === 'missed') {
    return {
      kind: 'check',
      title: 'Its scheduled slot did not start it. Press Run now.',
      steps: [
        'Nothing failed: the job simply was not started on time, usually because the slot it shares was cut short.',
        'The hourly catch-up retries daily jobs on its own; if it stays missed for another day, ask Claude to check the cron schedule.',
      ],
      retryHelps: true,
    };
  }
  if (health !== 'failing') return null;

  const raw = `${input.error || ''} ${input.summary || ''}`.trim();
  const text = raw.toLowerCase();
  const service = serviceFor(name, raw);
  const svc = service ? SERVICES[service] : undefined;
  const svcLabel = svc?.label || 'the provider';
  const streak = Math.max(1, Number(input.consecutive_failures || 1));

  // A provider the Services tab already knows to be down.
  if (service && input.blocked_services?.includes(service) && !/d1_error|sqlite|typeerror|referenceerror/.test(text)) {
    return {
      kind: 'wait', service,
      title: `${svcLabel} is unavailable right now. Wait; nothing to fix on our side.`,
      steps: ['The job pauses calls to it and resumes by itself once it answers again. Check Services for when it was last seen working.'],
      retryHelps: false,
    };
  }

  // 1. Code / schema bugs: retrying cannot help.
  if (/d1_error.*(syntax error|no such (column|table)|too many (columns|terms|sql variables)|has no column|not null constraint|unique constraint|datatype mismatch|incomplete input|ambiguous column)|sqlite_error|typeerror|referenceerror|is not a function|is not defined|cannot read propert|undefined is not|unexpected token|json\.parse|staging row exceeds/.test(text)) {
    return {
      kind: 'code', service,
      title: 'This is a bug in the job\'s code. It needs a code fix.',
      steps: [CODE_HOWTO],
      retryHelps: false,
    };
  }

  // 2. Bad / missing credentials.
  if (/\b(401|403)\b|unauthori[sz]ed|forbidden|invalid (api )?key|invalid token|api key not valid|authentication|not set\b|not configured|missing (api )?key|code 2009/.test(text)
    && !/provider offline|maintenance/.test(text)) {
    const secret = svc?.secrets?.length ? svc.secrets.join(', ') : 'the service key';
    return {
      kind: 'key', service,
      title: `${svcLabel} refused the key. Replace ${svc?.secrets?.length === 1 ? svc.secrets[0] : 'its key'}.`,
      steps: [
        `Get a fresh key from ${svcLabel} and put it in ${secret}.`,
        SECRET_HOWTO,
        'Then press Test on Services; Run now after that.',
      ],
      retryHelps: false,
    };
  }

  // 3. Out of credits / payment.
  if (/\b402\b|insufficient (credits|funds|balance)|out of credits|no credits|payment required|billing|quota exceeded for (the )?month|credit balance/.test(text)) {
    return {
      kind: 'topup', service,
      title: `${svcLabel} is out of credits. Top it up or switch it off.`,
      steps: [
        svc?.billing ? `Add credits at ${svc.billing}.` : `Add credits in your ${svcLabel} account.`,
        'Or turn the service off on Services so the job stops trying it; other sources keep working.',
      ],
      retryHelps: false,
    };
  }

  // 4. Daily limits / rate limits.
  if (/\b429\b|rate.?limit|too many requests|daily (cap|limit|quota)|quota (reached|exhausted|spent)|limited to once per/.test(text)) {
    return {
      kind: 'quota', service,
      title: `${svcLabel}'s limit is used up for now. Wait for it to reset.`,
      steps: [
        'Daily limits reset at midnight UTC; per-minute limits after a few minutes. The next scheduled run picks up where this one stopped.',
        'If this happens every day, raise the daily cap on Pricing → sources, or ask Claude to spread the job out.',
      ],
      retryHelps: false,
    };
  }

  // 5. Provider outage.
  if (/provider offline|maintenance|\b5\d\d\b|bad gateway|service unavailable|gateway timeout|econn|enotfound|fetch failed|network (error|connection lost)|socket|tls|dns|non-csv|unexpected .*body/.test(text)
    && !/d1_error/.test(text)) {
    return {
      kind: 'wait', service,
      title: `${svcLabel} is having trouble on its side. Wait, then Run now.`,
      steps: [
        streak >= 3
          ? `It has failed ${streak} runs in a row. Check ${svcLabel}'s status page; if it is up for everyone else, ask Claude to look.`
          : 'Outages usually clear within hours; the next scheduled run retries on its own.',
      ],
      retryHelps: streak < 3,
    };
  }

  // 6. Cloudflare / D1 transient trouble.
  if (/overloaded|7429|d1_error.*(reset|timeout|busy|locked|network)|storage operation exceeded|internal error|durable object/.test(text)) {
    return repeated(input, 3)
      ? { kind: 'code', title: 'The database keeps rejecting this job. It needs a code fix.', steps: ['The same database error three runs in a row is no longer a blip: the job asks too much of D1 at once.', CODE_HOWTO], retryHelps: false }
      : { kind: 'retry', title: 'A short database hiccup. Run now should work.', steps: ['Cloudflare D1 was briefly busy. Press Run now, or let the next run handle it.'], retryHelps: true };
  }

  // 7. Ran out of time or was cut off.
  if (/timed out|stale:|invocation ended|not started: earlier jobs|exceeded (cpu|time)|cpu limit|memory limit/.test(text)) {
    if (/not started: earlier jobs/.test(text)) {
      return { kind: 'retry', title: 'Jobs before it used up the slot. Press Run now.', steps: ['It never started, so nothing is wrong with it. The hourly catch-up will also start it.'], retryHelps: true };
    }
    return streak >= 2
      ? { kind: 'code', service, title: 'It runs out of time every run. It needs a code fix (smaller batches).', steps: [`Cut off ${streak} runs in a row: the work no longer fits in one Worker run.`, CODE_HOWTO], retryHelps: false }
      : { kind: 'retry', service, title: 'It ran out of time once. Run now, and watch the progress.', steps: ['A slow provider can push one run over its time limit. If the next run is cut off too, it needs a code fix.'], retryHelps: true };
  }

  // 8. Some items failed but the job itself ran.
  if (/provider\/item failures|failed \d/.test(text)) {
    return {
      kind: 'check', service,
      title: `Some sets could not be priced. Check ${svcLabel} on Services.`,
      steps: ['The job ran, but a source failed for part of its batch. If Services shows the source healthy, these sets are simply retried next run.'],
      retryHelps: false,
    };
  }

  // 9. Unknown: one retry tells transient from permanent.
  return repeated(input, 2)
    ? { kind: 'code', service, title: 'Same error twice in a row. It likely needs a code fix.', steps: [CODE_HOWTO], retryHelps: false }
    : { kind: 'retry', service, title: 'Unclear error. Run now once to see if it repeats.', steps: ['If it fails again with the same message, copy the error and ask Claude to fix it.'], retryHelps: true };
}
