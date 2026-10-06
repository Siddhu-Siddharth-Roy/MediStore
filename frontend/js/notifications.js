(async () => {
  const user = await requireUser(); layout(user, 'notifications');
  let filter = 'all', page = 1;
  const icon = NOTIF_ICON;
  async function load(p = 1) {
    page = p; const box = $('#list'); box.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const r = await api('/notifications?' + new URLSearchParams({ page, limit: 15, ...(filter === 'unread' ? { unread: 1 } : {}) }));
      box.innerHTML = r.data.length ? r.data.map(n => `<article class="card notif ${n.is_read ? '' : 'unread'}" data-id="${n.notification_id}" tabindex="0" role="button" aria-label="${n.is_read ? '' : 'Unread: '}${esc(n.title)}">
        <span aria-hidden="true">${icon[n.type] || '🔔'}</span><div><h3>${esc(n.title)}</h3><div>${esc(n.message)}</div><div class="muted">${esc(String(n.created_at).slice(0, 16))}${notifLink(n) ? ` · <a href="${esc(notifLink(n))}" data-open="1">Open →</a>` : ''}</div></div></article>`).join('')
        : `<div class="card state">${filter === 'unread' ? 'You are all caught up.' : 'No notifications yet.'}</div>`;
      renderPager($('#pager'), r.pagination, load);
    } catch (e) { box.innerHTML = `<div class="card error-text">${esc(errMsg(e))}</div>`; }
  }
  async function markRead(el) {
    if (!el.classList.contains('unread')) return;
    try { await api(`/notifications/${el.dataset.id}/read`, { method: 'PUT' }); el.classList.remove('unread'); refreshBell(); } catch (e) { toast(e.message, 'error'); }
  }
  $('#list').addEventListener('click', async (ev) => { const a = ev.target.closest('.notif'); if (!a) return; const link = ev.target.closest('a[data-open]');
    if (link) { ev.preventDefault(); await markRead(a); location.href = link.getAttribute('href'); return; } markRead(a); });
  $('#list').addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { const a = ev.target.closest('.notif'); if (a) { ev.preventDefault(); markRead(a); } } });
  $('#readAll').addEventListener('click', async () => { try { await api('/notifications/read-all', { method: 'PUT' }); setBellCount(0); load(page); } catch (e) { toast(e.message, 'error'); } });
  document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => { filter = b.dataset.f; document.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); load(1); }));
  load(1);
})();
