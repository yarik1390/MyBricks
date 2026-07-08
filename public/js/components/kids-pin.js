// Shared "set a parent PIN" sheet — used by the Me tab's Kids Mode row and the
// first-run setup wizard so both entry points set a PIN the same way. The PIN
// is stored server-side (POST /api/me/kids-pin/set), so this is only shown to
// signed-in users. Dismissing the sheet just closes it — entering Kids Mode
// without a PIN is safe because the exit gate only engages once a PIN exists.
import { $, toast } from '../utils.js';
import { showSheet, hideSheet } from './sheet.js';
import { api } from '../api.js';

export function showKidsPinSetup({ onSuccess } = {}) {
  showSheet(`
    <h2 class="u-serif-h">Set Kids PIN</h2>
    <p style="color:var(--ink-mute);margin-bottom:12px">Choose a 4-digit PIN. Kids will need this to exit Kids Mode.</p>
    <input id="kidsPin1" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]*"
      placeholder="New PIN" style="font-size:24px;text-align:center;letter-spacing:6px;width:100%;margin-bottom:10px" class="input">
    <input id="kidsPin2" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]*"
      placeholder="Confirm PIN" style="font-size:24px;text-align:center;letter-spacing:6px;width:100%;margin-bottom:12px" class="input">
    <div id="kidsPinErr" style="color:var(--down);font-size:13px;margin-bottom:10px;display:none"></div>
    <button class="btn-primary" id="kidsPinSetBtn" style="width:100%">Set PIN &amp; Enter Kids Mode</button>
  `);
  setTimeout(() => $("#kidsPin1")?.focus(), 100);
  $("#kidsPinSetBtn")?.addEventListener("click", async () => {
    const p1 = $("#kidsPin1")?.value || "";
    const p2 = $("#kidsPin2")?.value || "";
    const errEl = $("#kidsPinErr");
    if (!/^\d{4}$/.test(p1)) {
      if (errEl) { errEl.textContent = "PIN must be exactly 4 digits."; errEl.style.display = "block"; } return;
    }
    if (p1 !== p2) {
      if (errEl) { errEl.textContent = "PINs don't match."; errEl.style.display = "block"; } return;
    }
    try {
      await api("/api/me/kids-pin/set", { method: "POST", body: { pin: p1 } });
      hideSheet();
      onSuccess?.();
    } catch { toast("Couldn't set PIN. Try again.", "error"); }
  });
}
