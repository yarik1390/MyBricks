import { Hono } from 'hono';
import OpenAI from 'openai';
import { requireMember } from '../auth';
import { buildAdvisorContext } from '../lib/advisor-context';
import { callGeminiScan } from '../lib/gemini';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Free-tier server-key limit; bypassed entirely when the user supplies their own Gemini key.
const ADVISOR_DAILY_LIMIT = 10;

app.use('*', requireMember);

app.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ q?: string }>().catch(() => ({ q: '' }));
  const q = (body.q || '').trim().slice(0, 500);
  if (!q) return c.json({ error: 'q is required' }, 400);

  const geminiKey = c.req.header('X-Gemini-Key');
  const openaiKey = c.req.header('X-OpenAI-Key');

  // Rate limit for server-key path only (BYOK bypasses it).
  if (!geminiKey && !openaiKey) {
    const windowStart = new Date();
    windowStart.setHours(0, 0, 0, 0);
    const ws = windowStart.toISOString();
    await c.env.DB.prepare(`
      INSERT INTO rate_limits (user_id, endpoint, window_start, hit_count)
      VALUES (?, 'advisor', ?, 1)
      ON CONFLICT (user_id, endpoint, window_start) DO UPDATE SET hit_count = rate_limits.hit_count + 1
    `).bind(userId, ws).run();
    const rl = await c.env.DB.prepare(
      'SELECT hit_count FROM rate_limits WHERE user_id=? AND endpoint=? AND window_start=?'
    ).bind(userId, 'advisor', ws).first<{ hit_count: number }>();
    if ((rl?.hit_count ?? 0) > ADVISOR_DAILY_LIMIT) {
      return c.json({ error: `Rate limit: ${ADVISOR_DAILY_LIMIT} advisor queries per day. Add your Gemini key in Settings for unlimited access.` }, 429);
    }
  }

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
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: systemPrompt }] },
              contents: [{ role: 'user', parts: [{ text: q }] }],
              generationConfig: { maxOutputTokens: 512 },
            }),
          }
        );
        if (!resp.ok || !resp.body) {
          await send({ error: 'Gemini request failed' });
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
      } else {
        const openai = new OpenAI({ apiKey: openaiKey || c.env.OPENAI_API_KEY });
        const stream = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
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
      }
      await send({ done: true });
    } catch (e) {
      await send({ error: (e as Error).message });
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
