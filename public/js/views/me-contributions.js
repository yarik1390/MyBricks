import { $, $$, haptic, toast, escapeHtml, fmtDateUpdated } from '../utils.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { go } from '../router.js';
import { subpageTopbarHTML, loadMe } from './me-shared.js';
import { skelPage, skelSettingRows } from '../components/skeleton.js';

const TYPE_LABEL = { review: "Review", photo: "Photo", data: "Data fix" };
const STATUS_CLASS = { pending: "cs-pending", approved: "cs-approved", rejected: "cs-rejected" };

export async function renderMeContributions() {
  if (!state.me) $("#root").innerHTML = skelPage(skelSettingRows(4));
  const me = await loadMe();
  if (me?.is_guest) { go("#/me"); return; }

  $("#root").innerHTML = `
    <div class="page">
      ${subpageTopbarHTML("Your contributions", "Contributions")}
      <div id="contribMineBody"><div class="u-mute" style="text-align:center;padding:24px 0;">Loading…</div></div>
    </div>`;

  await load();
}

async function load() {
  const body = $("#contribMineBody");
  let data;
  try {
    data = await api("/api/contributions/mine");
  } catch (e) {
    body.innerHTML = `<div class="u-mute" style="text-align:center;padding:24px 0;">Couldn't load: ${escapeHtml(e.message)}</div>`;
    return;
  }
  const subs = data.submissions || [];
  const header = `
    <div class="card" style="padding:14px 16px;margin-bottom:14px;text-align:center;">
      <div style="font-size:26px;font-weight:800;color:var(--accent);">${data.approved_count || 0}</div>
      <div class="u-mute" style="font-size:13px;">approved contribution${data.approved_count === 1 ? "" : "s"}${data.approved_count >= 5 ? " · ⭐ Contributor" : ""}</div>
    </div>`;

  if (!subs.length) {
    body.innerHTML = header + `<div class="u-mute" style="text-align:center;padding:18px 0;">No submissions yet. Open any set's <b>Community</b> tab to contribute.</div>`;
    return;
  }

  body.innerHTML = header + `<div class="section-title">History</div>` + subs.map(s => `
    <div class="contrib-mine-row" data-type="${s.type}" data-id="${s.id}">
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;">${escapeHtml(TYPE_LABEL[s.type] || s.type)} · <span class="u-mute">${escapeHtml(s.set_num)}</span></div>
        <div class="u-mute" style="font-size:11px;margin-top:2px;">${fmtDateUpdated(s.created_at)}${s.review_note ? " · " + escapeHtml(s.review_note) : ""}</div>
      </div>
      <span class="contrib-status ${STATUS_CLASS[s.status] || ""}">${escapeHtml(s.status)}</span>
      ${s.status === "pending" ? `<button class="btn-secondary contrib-withdraw" style="padding:5px 9px;font-size:12px;">Withdraw</button>` : ""}
    </div>`).join("");

  $$(".contrib-withdraw").forEach(btn => btn.addEventListener("click", async () => {
    const row = btn.closest(".contrib-mine-row");
    btn.disabled = true;
    try {
      await api(`/api/contributions/${row.dataset.type}/${row.dataset.id}`, { method: "DELETE" });
      haptic("light"); toast("Withdrawn", "success"); row.remove();
    } catch (e) {
      btn.disabled = false; toast(e.message || "Could not withdraw", "error");
    }
  }));
}
