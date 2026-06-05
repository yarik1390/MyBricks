import { $, haptic, escapeHtml, fmtMoney, daysAgo } from '../utils.js';
import { I } from '../icons.js';

function sheetKeyHandler(e) { 
  if (e.key === "Escape") hideSheet(); 
}

export function showSheet(html) {
  const back = $("#sheetBackdrop");
  const sheet = $("#sheet");
  sheet.innerHTML = `<div class="sheet-handle"></div>` + html;
  back.classList.add("show");
  sheet.classList.add("show");
  back.setAttribute("aria-hidden", "false");
  sheet.setAttribute("aria-hidden", "false");
  haptic("light");
  back.addEventListener("click", hideSheet, { once: true });
  document.addEventListener("keydown", sheetKeyHandler);
  wireSheetDrag(sheet);
}

export function hideSheet() {
  const sheet = $("#sheet");
  const backdrop = $("#sheetBackdrop");
  if (!backdrop || !backdrop.classList.contains("show")) return;
  backdrop.classList.remove("show");
  backdrop.setAttribute("aria-hidden", "true");
  if (sheet) {
    sheet.classList.remove("show");
    sheet.style.transform = "";
    sheet.style.transition = "";
    sheet.setAttribute("aria-hidden", "true");
  }
  document.removeEventListener("keydown", sheetKeyHandler);
  haptic("light");
}

export function wireSheetDrag(sheet) {
  let startY = 0, dy = 0, dragging = false, t0 = 0;
  const onStart = (e) => {
    if (sheet.scrollTop > 0) return;
    startY = e.touches[0].clientY; dy = 0; dragging = true; t0 = Date.now();
    sheet.style.transition = "none";
  };
  const onMove = (e) => {
    if (!dragging) return;
    dy = e.touches[0].clientY - startY;
    if (dy < 0) dy = 0;
    sheet.style.transform = `translateY(${dy}px)`;
  };
  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = "";
    const velocity = dy / Math.max(1, Date.now() - t0);
    if (dy > sheet.offsetHeight * 0.3 || velocity > 0.6) hideSheet();
    else sheet.style.transform = "";
  };
  sheet.addEventListener("touchstart", onStart, { passive: true });
  sheet.addEventListener("touchmove", onMove, { passive: true });
  sheet.addEventListener("touchend", onEnd);
}

export function confirmSheet({ title, message = "", confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; hideSheet(); resolve(v); };
    showSheet(`
      <div style="font-family:var(--serif);font-size:22px;font-weight:500;margin:0 4px 6px;">${escapeHtml(title)}</div>
      ${message ? `<div style="color:var(--ink-mute);font-size:14px;margin:0 4px 18px;">${escapeHtml(message)}</div>` : `<div style="height:12px;"></div>`}
      <button class="btn-primary ${danger ? "btn-danger" : ""}" id="cfYes">${escapeHtml(confirmLabel)}</button>
      <button class="btn-secondary" id="cfNo" style="margin-top:8px;">Cancel</button>`);
    $("#cfYes").addEventListener("click", () => finish(true));
    $("#cfNo").addEventListener("click", () => finish(false));
    $("#sheetBackdrop").addEventListener("click", () => finish(false), { once: true });
  });
}

export function promptSheet({ title, label = "", value = "", placeholder = "", confirmLabel = "Save" }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; hideSheet(); resolve(v); };
    showSheet(`
      <div style="font-family:var(--serif);font-size:22px;font-weight:500;margin:0 4px 14px;">${escapeHtml(title)}</div>
      ${label ? `<label class="field-lbl" for="psInput">${escapeHtml(label)}</label>` : ""}
      <input class="field-input" id="psInput" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off">
      <button class="btn-primary" id="psSave" style="margin-top:14px;">${escapeHtml(confirmLabel)}</button>
      <button class="btn-secondary" id="psCancel" style="margin-top:8px;">Cancel</button>`);
    const input = $("#psInput");
    setTimeout(() => input?.focus(), 80);
    input?.addEventListener("keydown", (e) => { if (e.key === "Enter") finish(input.value.trim()); });
    $("#psSave").addEventListener("click", () => finish(input.value.trim()));
    $("#psCancel").addEventListener("click", () => finish(null));
    $("#sheetBackdrop").addEventListener("click", () => finish(null), { once: true });
  });
}

export function showAlertsSheet(alerts) {
  const html = alerts.length === 0
    ? `<div style="padding:20px 0;text-align:center;color:var(--ink-mute);">No new alerts.</div>`
    : alerts.map(a => `
        <div class="alert-card">
          <div class="ah">${I.bell()}Price drop · ${daysAgo(a.triggered_at)}d ago</div>
          <div style="font-weight:600;">${escapeHtml(a.set_name)}</div>
          <div style="font-size:13px;margin-top:4px;">Now <strong>${fmtMoney(a.current_value)}</strong> — your target was ${fmtMoney(a.target_price)}.</div>
        </div>`).join("");
  showSheet(`
    <div style="font-family:var(--serif);font-size:22px;font-weight:500;margin:0 4px 14px;">Alerts</div>
    ${html}`);
}
