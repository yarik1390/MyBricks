import { $, $$, haptic, escapeHtml, fmtMoney, parseMarkdown, daysAgo, fmtPct, fmtShortDate } from '../utils.js';
import { state } from '../state.js';
import { api } from '../api.js';
import { I } from '../icons.js';
import { isLocalAiSupported, createLocalAiSession, getLocalAiAvailability, checkGemma3Downloaded, runLocalTextInference } from '../lib/local-ai.js';
import { showSheet, hideSheet } from './sheet.js';

let _activeReader = null;
export function cancelActiveStream() {
  if (_activeReader) { _activeReader.cancel().catch(() => {}); _activeReader = null; }
}

const ADVISOR_PROMPTS = [
  "Which sets should I sell this month?",
  "Best buy with $200 budget?",
  "Which of my sets might retire soon?",
  "How is my Star Wars collection doing?",
];

export async function toggleAdvisor() {
  const drawer = document.getElementById("advisorDrawer");
  if (!drawer) return;
  const isOpen = drawer.classList.contains("open");
  if (isOpen) {
    haptic("light");
    cancelActiveStream();
    drawer.classList.remove("open");
  } else {
    haptic("medium");
    drawer.classList.add("open");
    await renderAdvisorDrawer();
  }
}

export async function renderAdvisorDrawer() {
  const savedGeminiKey = localStorage.getItem('bv_gemini_key') || '';
  
  if (!state.portfolio) {
    try {
      state.portfolio = await api("/api/collection");
    } catch {
      state.portfolio = { items: [], total_value: 0, total_paid: 0, count: 0 };
    }
    const [hist, wl] = await Promise.all([
      api("/api/collection/history?days=365").catch(() => null),
      api("/api/wishlist").catch(() => null),
    ]);
    if (hist) state.portfolioHistory = hist.snapshots || [];
    if (wl) { state.wishlist = wl.wishlist || []; state.wishlistAlerts = wl.unread_alerts || []; }
  }

  let chatHistory = [];
  try { chatHistory = JSON.parse(localStorage.getItem('bv_chat') || '[]'); } catch {}

  const drawer = document.getElementById("advisorDrawer");
  if (!drawer) return;

  drawer.innerHTML = `
    <div style="height:100%; display:flex; flex-direction:column; background:var(--surface);">
      <div class="topbar" style="padding:12px 16px; border-bottom:1.5px solid var(--line-soft); flex-shrink:0;" id="advisorTopbar">
        <div class="topbar-heading">
          <div class="topbar-eyebrow">AI & Local Insights</div>
          <div class="topbar-title" style="font-size:18px;">Advisor</div>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          ${chatHistory.length > 0 ? `<button class="icon-btn" id="clearChat" aria-label="Clear history">${I.trash()}</button>` : ""}
          <button class="icon-btn" id="closeAdvisor" aria-label="Close Advisor">${I.close()}</button>
        </div>
      </div>

      <!-- Tab bar -->
      <div class="chat-tabs" style="display:flex; border-bottom:1.5px solid var(--line-soft); background:var(--surface); flex-shrink:0;">
        <button class="chat-tab-btn active" data-tab="chat" style="flex:1; padding:12px; background:transparent; border:none; border-bottom:2.5px solid var(--ink); font-weight:700; color:var(--ink); cursor:pointer; font-family:var(--sans); font-size:13px; outline:none;">AI Advisor</button>
        <button class="chat-tab-btn" data-tab="analyst" style="flex:1; padding:12px; background:transparent; border:none; border-bottom:2.5px solid transparent; font-weight:500; color:var(--ink-mute); cursor:pointer; font-family:var(--sans); font-size:13px; outline:none;">Local Analyst</button>
      </div>

      <!-- AI Chat Tab Area -->
      <div class="chat-history" id="chatHistory" style="display:flex; flex-direction:column; flex:1; overflow-y:auto; padding:12px 16px; gap:12px;">
        ${chatHistory.length === 0 ? `
          <div class="chat-suggestions" id="chatSuggestions" style="padding:0;">
            ${!savedGeminiKey ? `
              <div class="chat-gemini-card" style="margin-bottom:12px;">
                <div style="font-weight:600; font-size:13px; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
                  ${I.flash({w:16})}<span>Get Free Gemini Key</span>
                </div>
                <div style="font-size:11px; color:var(--ink-mute); line-height:1.45;">
                  Unlock AI advice! Get a key in 30 seconds at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="color:var(--bv-red); font-weight:600; text-decoration:underline;">Google AI Studio</a> and save it in the <strong>Me</strong> tab.
                </div>
              </div>` : ""}
            <div style="font-size:12px; color:var(--ink-mute); text-align:center; margin-bottom:8px;">Ask about your collection…</div>
            <div style="display:flex; flex-direction:column; gap:6px;">
              ${ADVISOR_PROMPTS.map(p => `<button class="chat-suggestion-chip" style="font-size:12px; text-align:left; padding:8px 12px; width:100%;">${escapeHtml(p)}</button>`).join("")}
            </div>
          </div>` :
          chatHistory.map(m => `<div class="chat-msg ${m.role === "user" ? "user" : "ai"}">${m.role === "ai" ? parseMarkdown(m.content) : escapeHtml(m.content)}</div>`).join("")
        }
      </div>

      <!-- Local Analyst Tab Area -->
      <div id="analystArea" style="display:none; flex:1; overflow-y:auto; padding:12px 16px;">
        ${localAnalystHTML()}
      </div>

      <!-- Chat input row -->
      <div class="chat-input-row" id="chatInputRow" style="padding:10px 16px; border-top:1.5px solid var(--line-soft); background:var(--surface); flex-shrink:0;">
        <textarea class="chat-input" id="chatInput" placeholder="Ask anything about your collection…" rows="1" style="max-height:80px;"></textarea>
        <button class="chat-send-btn" id="chatSend" aria-label="Send">${I.arrowU()}</button>
      </div>
    </div>`;

  $("#closeAdvisor")?.addEventListener("click", () => {
    haptic("light");
    cancelActiveStream();
    drawer.classList.remove("open");
  });

  $$(".chat-suggestion-chip").forEach(chip => {
    chip.addEventListener("click", () => sendAdvisorMessage(chip.textContent.trim()));
  });
  $("#clearChat")?.addEventListener("click", () => {
    clearAdvisorHistory();
  });

  // Wire Tab Transitions
  $$(".chat-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      haptic("light");
      $$(".chat-tab-btn").forEach(b => {
        b.classList.toggle("active", b === btn);
        b.style.borderBottomColor = b === btn ? "var(--ink)" : "transparent";
        b.style.color = b === btn ? "var(--ink)" : "var(--ink-mute)";
        b.style.fontWeight = b === btn ? "700" : "500";
      });

      const tab = btn.dataset.tab;
      if (tab === "chat") {
        $("#chatHistory").style.display = "flex";
        $("#chatInputRow").style.display = "flex";
        $("#analystArea").style.display = "none";
        const hist = document.getElementById("chatHistory");
        if (hist) hist.scrollTop = hist.scrollHeight;
      } else if (tab === "analyst") {
        $("#chatHistory").style.display = "none";
        $("#chatInputRow").style.display = "none";
        $("#analystArea").style.display = "block";
        $("#analystArea").innerHTML = localAnalystHTML();
      }
    });
  });

  const input = document.getElementById("chatInput");
  const sendBtn = document.getElementById("chatSend");

  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const q = input.value.trim();
      if (q) { input.value = ""; input.style.height = "auto"; sendAdvisorMessage(q); }
    }
  });
  input?.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 80) + "px";
  });
  sendBtn?.addEventListener("click", () => {
    const q = input?.value.trim();
    if (q) { input.value = ""; input.style.height = "auto"; sendAdvisorMessage(q); }
  });

  const hist = document.getElementById("chatHistory");
  if (hist) hist.scrollTop = hist.scrollHeight;
}

function localAnalystHTML() {
  const p = state.portfolio;
  const items = p?.items || [];
  if (!items.length) {
    return `<div style="text-align:center;color:var(--ink-mute);padding:40px 20px;font-size:14px;">
      <div class="u-center" style="margin-bottom:8px;color:var(--ink-mute);">${I.trend({w:24,h:24})}</div>
      Add items to your vault to generate a local portfolio analysis report.
    </div>`;
  }

  let score = 70; 
  
  const themeCounts = {};
  const themeValues = {};
  let maxThemeCount = 0;
  let totalValue = 0;
  let totalSets = 0;
  let completeCount = 0;
  let totalPaid = 0;
  let retiredValue = 0;
  let retiredCount = 0;

  items.forEach(i => {
    const t = i.theme || 'Other';
    const qty = i.quantity || 1;
    themeCounts[t] = (themeCounts[t] || 0) + qty;
    themeValues[t] = (themeValues[t] || 0) + (Number(i.current_value) || 0) * qty;
    totalValue += (Number(i.current_value) || 0) * qty;
    totalSets += qty;
    totalPaid += (Number(i.purchase_price) || 0) * qty;
    if (i.is_complete !== 0) completeCount += qty;
    if (i.retired === 1 || i.retired === true) {
      retiredValue += (Number(i.current_value) || 0) * qty;
      retiredCount += qty;
    }
    if (themeCounts[t] > maxThemeCount) maxThemeCount = themeCounts[t];
  });

  const uniqueThemes = Object.keys(themeCounts).length;
  if (uniqueThemes >= 5) score += 10;
  else if (uniqueThemes === 1) score -= 15;
  
  const primaryThemeRatio = maxThemeCount / totalSets;
  if (primaryThemeRatio > 0.6) score -= 15;
  else if (primaryThemeRatio < 0.3) score += 5;

  const completeRatio = completeCount / totalSets;
  score += Math.round((completeRatio - 0.8) * 50);

  let overallRoi = 0;
  if (totalPaid > 0) {
    overallRoi = (totalValue - totalPaid) / totalPaid;
    if (overallRoi > 0.5) score += 15;
    else if (overallRoi > 0.2) score += 8;
    else if (overallRoi < 0) score -= 20;
  }

  const healthScore = Math.max(10, Math.min(100, Math.round(score)));
  const healthColor = healthScore >= 80 ? 'var(--up)' : healthScore >= 50 ? 'var(--bv-yellow)' : 'var(--bv-red)';
  let healthStatusText = "Your collection is well-diversified and in excellent condition.";
  if (healthScore < 50) healthStatusText = "High theme concentration or missing parts detected. Consider diversifying.";
  else if (healthScore < 70) healthStatusText = "Decent health, but room to improve on theme diversification or set completeness.";

  const themeSummaries = Object.keys(themeCounts).map(theme => {
    const val = themeValues[theme];
    const pctVal = totalValue > 0 ? (val / totalValue) * 100 : 0;
    const count = themeCounts[theme];
    const pctCount = totalSets > 0 ? (count / totalSets) * 100 : 0;
    return { theme, val, pctVal, count, pctCount };
  }).sort((a, b) => b.val - a.val);

  let diversificationWarning = '';
  const primaryTheme = themeSummaries[0];
  if (primaryTheme && primaryTheme.pctVal > 50) {
    diversificationWarning = `
      <div style="background:rgba(229, 57, 53, 0.08);border-left:4px solid var(--bv-red);padding:10px 14px;font-size:12px;color:var(--ink);border-radius:0 var(--r-2) var(--r-2) 0;margin-bottom:14px;line-height:1.45;">
        <strong class="u-row u-gap-1">${I.alert({w:13,h:13})} Theme Concentration Warning</strong><br>
        Your largest theme (<em>${escapeHtml(primaryTheme.theme)}</em>) accounts for <strong>${primaryTheme.pctVal.toFixed(1)}%</strong> of your total portfolio value. Consider spreading acquisitions across other high-performing themes to reduce risk.
      </div>
    `;
  }

  const retirementAlerts = [];
  items.forEach(i => {
    const score = Number(i.retirement_risk_score) || 0;
    const isRetired = i.retired === 1 || i.retired === true;
    if (score > 70 && !isRetired) {
      retirementAlerts.push({ set_num: i.set_num, name: i.name, score });
    }
  });
  retirementAlerts.sort((a, b) => b.score - a.score);

  const retiredPct = totalValue > 0 ? (retiredValue / totalValue) * 100 : 0;

  const performanceItems = items.map(i => {
    const current = Number(i.current_value) || 0;
    const paid = Number(i.purchase_price) || 0;
    const gain = current - paid;
    const roi = paid > 0 ? (gain / paid) * 100 : 0;
    return { set_num: i.set_num, name: i.name, current, paid, gain, roi };
  }).filter(x => x.paid > 0);

  const topRoi = performanceItems.slice().sort((a, b) => b.roi - a.roi).slice(0, 3);
  const topGain = performanceItems.slice().sort((a, b) => b.gain - a.gain).slice(0, 3);

  return `
    <div style="margin-bottom:14px;display:flex;align-items:center;gap:20px;background:var(--surface-2);border:1px solid var(--line-soft);border-radius:var(--r-2);padding:16px;">
      <div style="position:relative;width:80px;height:80px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <svg width="80" height="80" viewBox="0 0 36 36" style="transform: rotate(-90deg);">
          <circle cx="18" cy="18" r="16" fill="none" stroke="var(--line-soft)" stroke-width="3"></circle>
          <circle cx="18" cy="18" r="16" fill="none" stroke="${healthColor}" stroke-width="3" stroke-dasharray="${healthScore}, 100" stroke-linecap="round"></circle>
        </svg>
        <div style="position:absolute;font-family:var(--mono);font-size:22px;font-weight:700;color:var(--ink);">${healthScore}</div>
      </div>
      <div>
        <div style="font-weight:700;font-size:15px;color:var(--ink);">Portfolio Health Score</div>
        <div style="font-size:12px;color:var(--ink-mute);margin-top:4px;line-height:1.4;">${healthStatusText}</div>
      </div>
    </div>

    ${diversificationWarning}

    <div class="card" style="padding:14px 16px;margin-bottom:14px;">
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-mute);margin-bottom:8px;">Theme Diversification</div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${themeSummaries.slice(0, 4).map(t => {
          const maxVal = themeSummaries[0]?.val || 1;
          const barPct = (t.val / maxVal * 100).toFixed(1);
          return `
            <div>
              <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
                <span style="font-weight:600;color:var(--ink);">${escapeHtml(t.theme)}</span>
                <span style="color:var(--ink-mute);">${fmtMoney(t.val, { cents: 0 })} (${t.pctVal.toFixed(1)}%)</span>
              </div>
              <div class="theme-bar-track" style="height:6px;background:var(--surface-3);border-radius:3px;overflow:hidden;">
                <div class="theme-bar-fill" style="width:${barPct}%;height:100%;background:var(--bv-yellow);border-radius:3px;"></div>
              </div>
            </div>`;
        }).join('')}
        ${themeSummaries.length > 4 ? `
          <div style="font-size:11px;color:var(--ink-mute);text-align:right;">
            + ${themeSummaries.length - 4} other themes in your collection
          </div>` : ''}
      </div>
    </div>

    <div class="card" style="padding:14px 16px;margin-bottom:14px;">
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-mute);margin-bottom:8px;">Retirement Risk & Analytics</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:12px;margin-bottom:10px;border-bottom:1px solid var(--line-soft);padding-bottom:10px;">
        <div>
          <span style="color:var(--ink-mute);">Retired Value:</span><br>
          <strong style="color:var(--ink);">${fmtMoney(retiredValue, { cents: 0 })} (${retiredPct.toFixed(1)}%)</strong>
        </div>
        <div>
          <span style="color:var(--ink-mute);">Retired Sets:</span><br>
          <strong style="color:var(--ink);">${retiredCount} of ${totalSets} sets</strong>
        </div>
      </div>
      
      ${retirementAlerts.length > 0 ? `
        <div style="font-size:12px;color:var(--ink);margin-top:6px;">
          <div class="u-row u-gap-1" style="font-weight:600;color:var(--bv-red);margin-bottom:4px;">${I.alert({w:13,h:13})} Active sets approaching retirement:</div>
          <div style="display:flex;flex-direction:column;gap:4px;">
            ${retirementAlerts.slice(0, 3).map(a => `
              <div style="display:flex;justify-content:space-between;color:var(--ink);background:var(--surface-3);padding:4px 8px;border-radius:4px;">
                <span style="text-overflow:ellipsis;overflow:hidden;white-space:nowrap;max-width:200px;">${a.set_num} ${escapeHtml(a.name)}</span>
                <span style="font-weight:700;color:var(--bv-red);flex-shrink:0;">${a.score}% risk</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : `
        <div style="font-size:11px;color:var(--ink-mute);text-align:center;">
          No active sets are currently approaching high retirement risk.
        </div>
      `}
    </div>

    <div style="display:grid;grid-template-columns:1fr;gap:14px;margin-bottom:14px;">
      <div class="card" style="padding:14px 16px;">
        <div style="font-family:var(--mono);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-mute);margin-bottom:8px;">Top ROI Leaders</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${topRoi.length > 0 ? topRoi.map((item, idx) => `
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;">
              <span style="color:var(--ink);text-overflow:ellipsis;overflow:hidden;white-space:nowrap;max-width:200px;">
                ${idx + 1}. <strong style="font-family:var(--mono);">${item.set_num}</strong> ${escapeHtml(item.name)}
              </span>
              <strong style="color:var(--up);flex-shrink:0;margin-left:8px;">+${item.roi.toFixed(1)}%</strong>
            </div>
          `).join('') : '<div style="font-size:11px;color:var(--ink-mute);text-align:center;">No data available</div>'}
        </div>
      </div>

      <div class="card" style="padding:14px 16px;">
        <div style="font-family:var(--mono);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-mute);margin-bottom:8px;">Top Dollar Gainers</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${topGain.length > 0 ? topGain.map((item, idx) => `
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;">
              <span style="color:var(--ink);text-overflow:ellipsis;overflow:hidden;white-space:nowrap;max-width:200px;">
                ${idx + 1}. <strong style="font-family:var(--mono);">${item.set_num}</strong> ${escapeHtml(item.name)}
              </span>
              <strong style="color:var(--up);flex-shrink:0;margin-left:8px;">+${fmtMoney(item.gain, { cents: 0 })}</strong>
            </div>
          `).join('') : '<div style="font-size:11px;color:var(--ink-mute);text-align:center;">No data available</div>'}
        </div>
      </div>
    </div>
  `;
}

async function sendAdvisorMessage(q) {
  document.getElementById("chatSuggestions")?.remove();

  const hist = document.getElementById("chatHistory");
  if (!hist) return;

  appendChatBubble("user", q);
  saveChatMessage("user", q);

  const aiBubble = appendChatBubble("ai", "", true);

  const engine = localStorage.getItem('bv_ai_engine') || 'cloud';
  if (engine === 'local') {
    const nanoAvail = await getLocalAiAvailability();
    const nanoReady = isLocalAiSupported() && nanoAvail !== 'no';

    if (nanoReady) {
      // --- Gemini Nano path ---
      aiBubble.querySelector(".chat-typing")?.remove();
      let session = null;
      try {
        const context = buildLocalAdvisorContext();
        const systemPrompt = `You are a knowledgeable LEGO investment and collection advisor running locally on-device. You have access to the user's real collection data below. Answer questions concisely and specifically — always reference actual set names and numbers from their data. Recommend actionable decisions. Keep responses under 300 words.\n\n${context}`;
        session = await createLocalAiSession(systemPrompt);
        let fullText = "";
        try {
          const stream = session.promptStreaming(q);
          for await (const chunk of stream) {
            // Legacy Prompt API streams cumulative snapshots; current API streams
            // deltas. A cumulative chunk always extends the previous text.
            fullText = chunk.startsWith(fullText) ? chunk : fullText + chunk;
            aiBubble.innerHTML = parseMarkdown(fullText);
            hist.scrollTop = hist.scrollHeight;
          }
        } catch (streamErr) {
          fullText = await session.prompt(q);
          aiBubble.innerHTML = parseMarkdown(fullText);
        }
        if (fullText) saveChatMessage("ai", fullText);
      } catch (err) {
        aiBubble.classList.add("error");
        aiBubble.innerHTML = `<span>Local AI session failed. ${escapeHtml(err.message || "Ensure Gemini Nano is enabled in Chrome settings.")}</span>
          <button class="btn-secondary chat-retry-btn" style="display:block;margin-top:8px;padding:6px 12px;font-size:12px;width:auto;">Retry</button>`;
        aiBubble.querySelector(".chat-retry-btn")?.addEventListener("click", () => {
          aiBubble.previousElementSibling?.remove();
          aiBubble.remove();
          sendAdvisorMessage(q);
        });
      } finally {
        if (session) { try { session.destroy(); } catch {} }
      }
      hist.scrollTop = hist.scrollHeight;
      return;
    }

    // --- Gemma LlmInference path (Nano unavailable but model downloaded) ---
    const gemmaReady = await checkGemma3Downloaded();
    if (gemmaReady) {
      aiBubble.querySelector(".chat-typing")?.remove();
      try {
        const context = buildLocalAdvisorContext();
        // Keep the prompt compact — Gemma 2B has a limited context window.
        const truncCtx = context.length > 3000 ? context.slice(0, 3000) + "\n[…truncated]" : context;
        const fullPrompt = `You are a LEGO investment advisor. Collection:\n${truncCtx}\n\nQuestion: ${q}\nAnswer (be brief and specific):`;
        let fullText = "";
        const finalText = await runLocalTextInference(fullPrompt, (partial) => {
          fullText = partial;
          aiBubble.innerHTML = parseMarkdown(fullText);
          hist.scrollTop = hist.scrollHeight;
        });
        fullText = finalText || fullText;
        aiBubble.innerHTML = parseMarkdown(fullText);
        if (fullText) saveChatMessage("ai", fullText);
      } catch (err) {
        aiBubble.classList.add("error");
        aiBubble.innerHTML = `<span>Local Gemma error: ${escapeHtml(err.message)}</span>
          <button class="btn-secondary chat-retry-btn" style="display:block;margin-top:8px;padding:6px 12px;font-size:12px;width:auto;">Retry</button>`;
        aiBubble.querySelector(".chat-retry-btn")?.addEventListener("click", () => {
          aiBubble.previousElementSibling?.remove();
          aiBubble.remove();
          sendAdvisorMessage(q);
        });
      }
      hist.scrollTop = hist.scrollHeight;
      return;
    }

    // Neither Nano nor Gemma available
    if (!navigator.onLine) {
      aiBubble.querySelector(".chat-typing")?.remove();
      aiBubble.classList.add("error");
      aiBubble.innerHTML = `<span>You're offline and no local AI is available. Download the Gemma model in <strong>Settings → On-Device Offline AI</strong> to use the advisor offline.</span>`;
      hist.scrollTop = hist.scrollHeight;
      return;
    }
    toast("Gemini Nano is not supported and Gemma isn't downloaded. Falling back to Cloud AI.", "info");
  }

  // --- Cloud path ---
  if (!navigator.onLine) {
    aiBubble.querySelector(".chat-typing")?.remove();
    aiBubble.classList.add("error");
    aiBubble.innerHTML = `<span>You're offline. Switch to Local AI in <strong>Settings → On-Device Offline AI</strong> and download the Gemma model for offline use.</span>`;
    hist.scrollTop = hist.scrollHeight;
    return;
  }

  let streamTimeout = null;
  let reader = null;
  try {
    const geminiKey = localStorage.getItem('bv_gemini_key');
    const openaiKey = localStorage.getItem('bv_openai_key');
    const extraHeaders = {};
    if (geminiKey) extraHeaders['X-Gemini-Key'] = geminiKey;
    else if (openaiKey) extraHeaders['X-OpenAI-Key'] = openaiKey;
    const resp = await api("/api/advisor", {
      method: "POST",
      body: { q },
      headers: extraHeaders,
      stream: true,
    });

    const ac = new AbortController();
    streamTimeout = setTimeout(() => ac.abort(), 60000);
    reader = resp.body.getReader();
    _activeReader = reader;
    const dec = new TextDecoder();
    let buf = "";
    let fullText = "";

    aiBubble.querySelector(".chat-typing")?.remove();

    while (true) {
      const readPromise = reader.read();
      const { done, value } = await Promise.race([
        readPromise,
        new Promise((_, reject) => ac.signal.addEventListener('abort', () => reject(new Error('Response timed out')), { once: true })),
      ]);
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const parsed = JSON.parse(line.slice(6));
          if (parsed.text) {
            fullText += parsed.text;
            aiBubble.innerHTML = parseMarkdown(fullText);
            hist.scrollTop = hist.scrollHeight;
          }
          if (parsed.error) {
            // Surface the error even if partial text already streamed: keep the
            // partial answer and append an escaped notice (never raw innerHTML).
            const note = `<div class="chat-stream-error" style="margin-top:6px;font-size:12px;opacity:.85;">⚠ ${escapeHtml(parsed.error)}</div>`;
            aiBubble.innerHTML = (fullText ? parseMarkdown(fullText) : "") + note;
            aiBubble.classList.add("error");
          }
          if (parsed.done) break;
        } catch {}
      }
    }
    if (fullText) saveChatMessage("ai", fullText);
  } catch (err) {
    aiBubble.querySelector(".chat-typing")?.remove();
    aiBubble.classList.add("error");
    const errMsg = err.message || "";
    const noKey = !localStorage.getItem('bv_gemini_key') && !localStorage.getItem('bv_openai_key');
    const rateLimited = /rate.?limit|api key|unlimited|quota|too many|429/i.test(errMsg);
    // On a shared-quota rate-limit, a personal free Gemini key removes the cap.
    const keyCta = (noKey && rateLimited) ? `
      <div class="chat-gemini-card" style="margin-top:8px;">
        <div style="font-weight:600; font-size:13px; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
          ${I.flash({ w: 16 })}<span>Hit the free limit?</span>
        </div>
        <div style="font-size:11px; color:var(--ink-mute); line-height:1.45;">
          Get a free key in 30 seconds at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="color:var(--bv-red); font-weight:600; text-decoration:underline;">Google AI Studio</a> and save it in the <strong>Me</strong> tab for unlimited advice.
        </div>
      </div>` : "";
    aiBubble.innerHTML = `<span>Sorry, couldn't reach the advisor. ${escapeHtml(errMsg)}</span>
      <button class="btn-secondary chat-retry-btn" style="display:block;margin-top:8px;padding:6px 12px;font-size:12px;width:auto;">Retry</button>${keyCta}`;
    // Retry re-sends the same question in a fresh bubble pair.
    aiBubble.querySelector(".chat-retry-btn")?.addEventListener("click", () => {
      aiBubble.previousElementSibling?.remove(); // the user bubble (re-added by retry)
      aiBubble.remove();
      sendAdvisorMessage(q);
    });
  } finally {
    clearTimeout(streamTimeout);
    // Release the response stream on timeout/error paths — a raced abort leaves
    // the reader open otherwise, leaking the connection.
    try { await reader?.cancel(); } catch {}
    if (_activeReader === reader) _activeReader = null;
  }

  hist.scrollTop = hist.scrollHeight;

  if (!document.getElementById("clearChat")) {
    const topbar = document.querySelector("#advisorTopbar");
    if (topbar) {
      const btn = document.createElement("button");
      btn.className = "icon-btn"; btn.id = "clearChat";
      btn.setAttribute("aria-label", "Clear history");
      btn.innerHTML = I.trash();
      btn.addEventListener("click", () => clearAdvisorHistory());
      // Insert clear button before close button
      topbar.querySelector(".topbar-heading")?.nextElementSibling?.prepend(btn);
    }
  }
}

function appendChatBubble(role, content, streaming = false) {
  const hist = document.getElementById("chatHistory");
  if (!hist) return null;
  const el = document.createElement("div");
  el.className = `chat-msg ${role === "user" ? "user" : "ai"}`;
  if (streaming) {
    el.innerHTML = `<span class="chat-typing"><span></span><span></span><span></span></span>`;
  } else {
    el.innerHTML = role === "ai" ? parseMarkdown(content) : escapeHtml(content);
  }
  hist.appendChild(el);
  hist.scrollTop = hist.scrollHeight;
  return el;
}

function saveChatMessage(role, content) {
  try {
    const msgs = JSON.parse(localStorage.getItem('bv_chat') || '[]');
    msgs.push({ role, content });
    localStorage.setItem('bv_chat', JSON.stringify(msgs.slice(-20)));
  } catch {}
}

function clearAdvisorHistory() {
  localStorage.removeItem('bv_chat');
  renderAdvisorDrawer();
}



function buildLocalAdvisorContext() {
  const p = state.portfolio;
  const items = p?.items || [];
  const wl = state.wishlist || [];
  
  const lines = [];
  lines.push(`USER COLLECTION (${p?.count || items.length} sets)`);
  lines.push(`Total value: $${(p?.total_value || 0).toFixed(0)} | Total paid: $${(p?.total_paid || 0).toFixed(0)}`);
  
  if (p?.total_value > 0 && p?.total_paid > 0) {
    const gain = ((p.total_value - p.total_paid) / p.total_paid * 100).toFixed(1);
    lines.push(`Overall ROI: ${Number(gain) >= 0 ? '+' : ''}${gain}%`);
  }
  lines.push('');
  
  // Theme breakdown
  const themes = {};
  for (const i of items) {
    const t = i.theme || 'Other';
    if (!themes[t]) themes[t] = { sets: 0, value: 0, paid: 0 };
    themes[t].sets += (i.quantity || 1);
    themes[t].value += (Number(i.current_value) || 0) * (i.quantity || 1);
    themes[t].paid += (Number(i.purchase_price) || 0) * (i.quantity || 1);
  }
  
  const sortedThemes = Object.entries(themes)
    .map(([theme, data]) => ({ theme, ...data }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
    
  if (sortedThemes.length > 0) {
    lines.push('THEME BREAKDOWN:');
    for (const t of sortedThemes) {
      const roi = t.paid > 0 ? ` ${((t.value - t.paid) / t.paid * 100).toFixed(0)}% ROI` : '';
      lines.push(`- ${t.theme}: ${t.sets} sets, $${t.value.toFixed(0)} value,${roi}`);
    }
    lines.push('');
  }
  
  lines.push('TOP OWNED SETS:');
  const topSets = items.slice()
    .sort((a, b) => (Number(b.current_value) || 0) - (Number(a.current_value) || 0))
    .slice(0, 25);
    
  for (const s of topSets) {
    const risk = s.retirement_risk_score != null && s.retirement_risk_score >= 70 ? ' [HIGH RETIRE RISK]' : '';
    const ret = s.retired ? ' [RETIRED]' : '';
    const cond = s.condition ? ` | Condition: ${s.condition}` : '';
    const roi = (s.purchase_price && s.current_value) 
      ? ` (${(((s.current_value - s.purchase_price) / s.purchase_price) * 100).toFixed(0)}% ROI)` 
      : '';
    lines.push(
      `- ${s.name} (${s.set_num}) | ${s.theme || 'Unknown'} | Value: $${(Number(s.current_value) || 0).toFixed(0)}${roi} | Paid: $${s.purchase_price ? s.purchase_price.toFixed(0) : 'unknown'} | Qty: ${s.quantity}${cond}${risk}${ret}`
    );
  }
  lines.push('');
  
  if (wl.length > 0) {
    lines.push('WISHLIST:');
    const sortedWl = wl.slice()
      .sort((a, b) => (Number(b.current_value) || 0) - (Number(a.current_value) || 0))
      .slice(0, 15);
    for (const w of sortedWl) {
      const gap = w.target_price ? ` | Target: $${Number(w.target_price).toFixed(0)}` : '';
      lines.push(`- ${w.name} (${w.set_num}) | Value: $${(Number(w.current_value) || 0).toFixed(0)}${gap}`);
    }
    lines.push('');
  }
  
  return lines.join('\n');
}
