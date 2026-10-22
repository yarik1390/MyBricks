// Admin > Overview: notes sent from Profile > Send feedback, newest first.
// Open notes count in the header; "Done" files a note away, "Reopen" undoes it.
import { $, escapeHtml, toast } from '../utils.js';
import { api } from '../api.js';

let items = [];

function rowHTML(f) {
  const meta = [f.email, f.platform, f.app_version, f.locale, f.screen, new Date(`${f.created_at}Z`).toLocaleString()].filter(Boolean).join(' · ');
  const done = f.status === 'done';
  return `<article class="admin-supporter-row"${done ? ' style="opacity:.6"' : ''}>
    <div>
      <strong style="white-space:pre-wrap;font-weight:500">${escapeHtml(f.message)}</strong>
      <span>${escapeHtml(meta)}</span>
    </div>
    <button type="button" class="btn-secondary" data-feedback-id="${f.id}" data-feedback-status="${done ? 'open' : 'done'}">${done ? 'Reopen' : 'Done'}</button>
  </article>`;
}

function render(open) {
  const box = $('#adminFeedbackContainer');
  if (!box) return;
  box.innerHTML = `
    <div class="admin-supporters-head">
      <div>
        <strong>Feedback</strong>
        <span>${items.length ? 'Notes from Profile > Send feedback, newest first.' : 'No feedback yet. Testers send it from Profile > Send feedback.'}</span>
      </div>
      ${open ? `<span class="badge">${open}</span>` : ''}
    </div>
    ${items.length ? `<div class="admin-supporter-list">${items.map(rowHTML).join('')}</div>` : ''}`;
  box.querySelectorAll('[data-feedback-id]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await api(`/api/feedback/admin/${b.dataset.feedbackId}`, { method: 'PATCH', body: { status: b.dataset.feedbackStatus } });
      await loadAdminFeedback();
    } catch (e) {
      b.disabled = false;
      toast(e.message || 'Could not update', 'error');
    }
  }));
}

export async function loadAdminFeedback() {
  try {
    const d = await api('/api/feedback/admin');
    items = Array.isArray(d.items) ? d.items : [];
    render(d.open || 0);
  } catch (e) {
    const box = $('#adminFeedbackContainer');
    if (box) box.innerHTML = `<div class="admin-supporters-head"><div><strong>Feedback</strong><span>${escapeHtml(e.message || String(e))}</span></div></div>`;
  }
}
