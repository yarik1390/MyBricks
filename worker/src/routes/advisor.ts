import { Hono } from 'hono';
import OpenAI from 'openai';
import { requireMember } from '../auth';
import { buildAdvisorContext } from '../lib/advisor-context';
import { fetchTracked } from '../lib/http';
import { recordIntegrationAttempt } from '../lib/integration-health';
import { logEvent } from '../lib/analytics';
import { MODELS, geminiUrl, gatewayHeaders, gatewayMetadataHeader } from '../lib/llm';
import { resolveRoute, type LlmProvider } from '../lib/llm-routing';
import { openAiCompatibleStep } from '../lib/llm-clients';
import { isMergeBudgetExhausted, mergeReportedCostUsd } from '../lib/merge-gateway';
import { recordAiUsage } from '../lib/ai-usage';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Free-tier server-key limit; bypassed entirely when the user supplies their own Gemini key.
const ADVISOR_DAILY_LIMIT = 10;

/** Route-step provider -> the label the user-facing error names. */
function providerLabelFor(provider: LlmProvider): 'gemini' | 'openai' {
  return provider === 'gemini' ? 'gemini' : 'openai';
}

function providerUserMessage(provider: 'gemini' | 'openai', error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  const statusFromMessage = Number(message.match(/HTTP\s+(\d{3})/i)?.[1] || 0);
  const status = typeof (error as { status?: unknown })?.status === 'number'
    ? (error as { status: number }).status
    : statusFromMessage;
  const label = provider === 'gemini' ? 'Gemini' : 'OpenAI';

  if (status === 401 || status === 403 || /api key|unauthorized|forbidden|permission/i.test(message)) {
    return `${label} key could not be used. Check the key in Settings.`;
  }
  if (status === 429 || /quota|rate limit/i.test(message)) {
    return `${label} quota or rate limit was reached. Try again later or switch AI keys.`;
  }
  if (status >= 500 || /timeout|network|fetch/i.test(message)) {
    return `${label} is temporarily unavailable. Try again in a moment.`;
  }
  return `The advisor could not get an AI response from ${label}.`;
}

/**
 * Stream one Gemini turn into the SSE writer. Returns whether any text was
 * emitted — the caller uses that to decide if it may still fall through to the
 * next provider (see the cascade in the route below).
 *
 * Server-key calls go through the Cloudflare AI Gateway; BYOK calls do not and
 * keep their own inline path, so a user's key never transits our gateway.
 */
async function streamGeminiAdvisor(
  env: Env,
  model: string,
  systemPrompt: string,
  q: string,
  send: (obj: Record<string, unknown>) => Promise<void>,
): Promise<boolean> {
  const resp = await fetchTracked(
    env,
    'gemini',
    geminiUrl(model, { env, method: 'streamGenerateContent', query: '?alt=sse', routeThroughGateway: true }),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY ?? '' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: q }] }],
        generationConfig: { maxOutputTokens: 512 },
      }),
    },
  );
  if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
  const reader = resp.body.getReader();
  const tdec = new TextDecoder();
  let buf = '';
  let emitted = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += tdec.decode(value, { stream: true });
    const parts = buf.split('\n');
    buf = parts.pop() ?? '';
    for (const line of parts) {
      if (!line.startsWith('data: ')) continue;
      try {
        const parsed = JSON.parse(line.slice(6)) as Record<string, unknown>;
        const candidates = parsed['candidates'] as { content?: { parts?: { text?: string }[] } }[] | undefined;
        const text = candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        if (text) { emitted = true; await send({ text }); }
      } catch {}
    }
  }
  return emitted;
}

app.use('*', requireMember);

app.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ q?: string }>().catch(() => ({ q: '' }));
  const q = (body.q || '').trim().slice(0, 500);
  if (!q) return c.json({ error: 'q is required' }, 400);

  const geminiKey = c.req.header('X-Gemini-Key');
  const openaiKey = c.req.header('X-OpenAI-Key');
  if (!geminiKey && !openaiKey && !c.env.OPENAI_API_KEY) {
    return c.json({ error: 'OpenAI is not configured. Add your own Gemini or OpenAI key in Settings.' }, 500);
  }

  // Rate limit for server-key path only (BYOK bypasses it).
  if (!geminiKey && !openaiKey) {
    const windowStart = new Date();
    windowStart.setHours(0, 0, 0, 0);
    const ws = windowStart.toISOString();
    // Atomic increment+read: RETURNING the new count in one statement closes the
    // read-after-write race where two concurrent requests both pass the limit.
    const rl = await c.env.DB.prepare(`
      INSERT INTO rate_limits (user_id, endpoint, window_start, hit_count)
      VALUES (?, 'advisor', ?, 1)
      ON CONFLICT (user_id, endpoint, window_start) DO UPDATE SET hit_count = rate_limits.hit_count + 1
      RETURNING hit_count
    `).bind(userId, ws).first<{ hit_count: number }>();
    if ((rl?.hit_count ?? 0) > ADVISOR_DAILY_LIMIT) {
      return c.json({ error: `Rate limit: ${ADVISOR_DAILY_LIMIT} advisor queries per day. Add your Gemini key in Settings for unlimited access.` }, 429);
    }
  }

  logEvent(c.env, 'advisor_used', userId);
  const context = await buildAdvisorContext(userId, c.env);

  const systemPrompt = `You are a knowledgeable LEGO investment and collection advisor. You have access to the user's real collection data below. Answer questions concisely and specifically — always reference actual set names and numbers from their data. Recommend actionable decisions. Keep responses under 300 words unless the user asks for more detail.

${context}`;

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();

  const send = async (obj: Record<string, unknown>) => {
    await writer.write(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
  };

  // Stream in a detached async task so we can return the Response immediately
  c.executionCtx.waitUntil((async () => {
    try {
      if (geminiKey) {
        // Gemini path: use the scan helper but adapted for text-only chat
        const resp = await fetchTracked(
          c.env,
          'gemini',
          // BYOK advisor: call Google directly with the user's key.
          geminiUrl(MODELS.advisor, { method: 'streamGenerateContent', query: '?alt=sse' }),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: systemPrompt }] },
              contents: [{ role: 'user', parts: [{ text: q }] }],
              generationConfig: { maxOutputTokens: 512 },
            }),
          }
        );
        if (!resp.ok || !resp.body) {
          await send({ error: providerUserMessage('gemini', `HTTP ${resp.status}`) });
          await send({ done: true });
          await writer.close();
          return;
        }
        const reader = resp.body.getReader();
        const tdec = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += tdec.decode(value, { stream: true });
          const parts = buf.split('\n');
          buf = parts.pop() ?? '';
          for (const line of parts) {
            if (!line.startsWith('data: ')) continue;
            try {
              const parsed = JSON.parse(line.slice(6)) as Record<string, unknown>;
              const candidates = parsed['candidates'] as { content?: { parts?: { text?: string }[] } }[] | undefined;
              const text = candidates?.[0]?.content?.parts?.[0]?.text ?? '';
              if (text) await send({ text });
            } catch {}
          }
        }
      } else if (openaiKey) {
        // BYOK OpenAI: the user's own key, direct, no cascade and no gateway.
        const openai = new OpenAI({ apiKey: openaiKey });
        const stream = await openai.chat.completions.create({
          model: MODELS.openaiFallback,
          max_tokens: 512,
          stream: true,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: q },
          ],
        });
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content ?? '';
          if (text) await send({ text });
        }
        await recordIntegrationAttempt(c.env, 'openai', true);
      } else {
        // SERVER-key cascade, ordered by the admin-tunable advisor route.
        //
        // One constraint shapes this loop: once a step has emitted a token to
        // the client we are committed to it. The bytes are already on the wire,
        // so falling through to another provider would splice two different
        // answers into one reply. A step may therefore only be retried if it
        // failed BEFORE producing text — `emitted` is what enforces that.
        const meta = { ...gatewayHeaders(c.env), ...gatewayMetadataHeader({ workload: 'advisor' }) };
        const steps = await resolveRoute(c.env, 'advisor');
        let emitted = false;
        let lastError: unknown = null;
        let lastProvider: LlmProvider = 'openai';

        for (const step of steps) {
          lastProvider = step.provider;
          try {
            if (step.provider === 'gemini') {
              emitted = await streamGeminiAdvisor(c.env, step.model, systemPrompt, q, send);
            } else {
              const { client, models } = await openAiCompatibleStep(c.env, step, meta, 'text');
              if (!client) continue;
              for (const model of models) {
                const stream = await client.chat.completions.create({
                  model,
                  max_tokens: 512,
                  stream: true,
                  stream_options: { include_usage: true },
                  messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: q },
                  ],
                });
                let usage: unknown = null;
                for await (const chunk of stream) {
                  const text = chunk.choices[0]?.delta?.content ?? '';
                  if (text) { emitted = true; await send({ text }); }
                  if ((chunk as { usage?: unknown }).usage) usage = (chunk as { usage?: unknown }).usage;
                }
                const cost = step.provider === 'merge' ? mergeReportedCostUsd(usage) : null;
                await recordAiUsage(
                  c.env, step.provider, model,
                  usage as { prompt_tokens?: number; completion_tokens?: number } | null,
                  cost,
                );
                if (emitted) break;
              }
            }
            if (emitted) {
              await recordIntegrationAttempt(c.env, step.provider, true);
              break;
            }
          } catch (e) {
            lastError = e;
            await recordIntegrationAttempt(c.env, step.provider, false, e);
            if (emitted) break; // committed — cannot splice a second answer in
            const status = Number((e as { status?: unknown })?.status ?? 0);
            if (step.provider === 'merge' && isMergeBudgetExhausted(status)) {
              console.warn(`[advisor] Merge out of budget/key (HTTP ${status}) — skipping provider`);
            }
          }
        }

        if (!emitted) {
          await send({ error: providerUserMessage(providerLabelFor(lastProvider), lastError ?? 'no provider produced a reply') });
        }
      }
      await send({ done: true });
    } catch (e) {
      const provider = geminiKey ? 'gemini' : 'openai';
      await recordIntegrationAttempt(c.env, provider, false, e);
      await send({ error: providerUserMessage(provider, e) });
      await send({ done: true });
    } finally {
      await writer.close().catch(() => {});
    }
  })());

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});

export { app as advisorRoute };
