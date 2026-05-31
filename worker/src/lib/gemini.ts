// Calls Gemini 1.5 Flash with a user-supplied Gemini API key (free from Google
// AI Studio: https://aistudio.google.com/apikey). The free tier gives ~1500
// requests/day, so scans run on the user's own quota — not the server's OpenAI
// key — and don't count against the shared rate limit.
export async function callGeminiScan(
  imageDataUrl: string,
  apiKey: string,
): Promise<{ set_num?: string; name?: string; confidence: string; reasoning: string } | null> {
  const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const [, mimeType, b64data] = match;

  const body = {
    contents: [{
      parts: [
        {
          text: 'You are a LEGO product-identification expert. Identify the LEGO set in this image. Return ONLY raw JSON (no markdown fences): { "set_num": "...", "name": "...", "confidence": "high|medium|low|none", "reasoning": "..." }',
        },
        { inline_data: { mime_type: mimeType, data: b64data } },
      ],
    }],
  };

  try {
    const resp = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
      },
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
