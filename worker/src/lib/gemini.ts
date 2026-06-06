import { fetchWithRetry } from './http';

// Calls Gemini 1.5 Flash with a user-supplied Gemini API key (free from Google
// AI Studio: https://aistudio.google.com/apikey). The free tier gives ~1500
// requests/day, so scans run on the user's own quota — not the server's OpenAI
// key — and don't count against the shared rate limit.
export async function callGeminiScan(
  imageDataUrl: string,
  apiKey: string,
): Promise<{ sets?: Array<{ set_num: string; name: string; confidence: string; reasoning: string }> } | null> {
  const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const [, mimeType, b64data] = match;

  const body = {
    contents: [{
      parts: [
        {
          text: 'You are a LEGO product-identification expert. Identify all the LEGO sets visible in this image. Return ONLY raw JSON (no markdown fences) in this format: { "sets": [ { "set_num": "...", "name": "...", "confidence": "high|medium|low|none", "reasoning": "..." } ] }',
        },
        { inline_data: { mime_type: mimeType, data: b64data } },
      ],
    }],
  };

  try {
    const resp = await fetchWithRetry(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
      },
      // Vision calls with a base64 image take longer; give them headroom.
      { timeoutMs: 30000, retries: 1 },
    );
    if (!resp.ok) {
      console.warn('[gemini] API error:', resp.status, await resp.text().catch(() => ''));
      return null;
    }
    const data = await resp.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return null;
    return JSON.parse(text.replace(/```json?\n?|```/g, '').trim());
  } catch (e) {
    console.warn('[gemini] parse error:', (e as Error).message);
    return null;
  }
}

export async function callGeminiValuation(
  setNum: string,
  setName: string,
  apiKey: string,
): Promise<{ current_value: number; used_value: number; ebay_value: number } | null> {
  const body = {
    contents: [{
      parts: [
        {
          text: `Estimate the current market valuation in USD for Lego set ${setNum} ${setName}. Provide average sold prices for: 1. Sealed/New box 2. Used/Good box 3. Recent average sales price on eBay. Return JSON only: { "current_value": number, "used_value": number, "ebay_value": number }`,
        },
      ],
    }],
    generationConfig: {
      responseMimeType: "application/json",
    }
  };

  try {
    const resp = await fetchWithRetry(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
      },
      { timeoutMs: 20000, retries: 1 },
    );
    if (!resp.ok) {
      console.warn('[gemini-val] API error:', resp.status, await resp.text().catch(() => ''));
      return null;
    }
    const data = await resp.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return null;
    const parsed = JSON.parse(text.replace(/```json?\n?|```/g, '').trim()) as { current_value: number; used_value: number; ebay_value: number };
    if (typeof parsed.current_value === 'number' && typeof parsed.used_value === 'number' && typeof parsed.ebay_value === 'number') {
      return parsed;
    }
    return null;
  } catch (e) {
    console.warn('[gemini-val] parse error:', (e as Error).message);
    return null;
  }
}

