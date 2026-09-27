// Advisor (#/advisor) — 2026 redesign. A full-screen chat that uses the
// collector's vault: portfolio health, the conversation, suggested questions
// and the input bar. The chat itself (SSE streaming, bring-your-own-key and the
// on-device models) lives in components/advisor.js, loaded lazily.
import { renderAdvisorPage as render } from '../components/advisor-lazy.js';

export async function renderAdvisorPage() {
  await render();
}
