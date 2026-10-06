(async () => {
  const me = await requireUser(['admin']); layout(me, 'users');
  const ROLES = [['customer', 'Customer'], ['pharmacist', 'Pharmacist / Staff'], ['admin', 'Admin']];
  let cache = [];
  const view = listView({
    tbody: $('#rows'), pager: $('#pager'), colspan: 6, empty: 'No users match your filters.',
    fetcher: async (page) => { const p = new URLSearchParams({ page, limit: 10, q: $('#q').value, role: $('#role').value, status: $('#status').value }); const r = await api('/users?' + p); cache = r.data; return r; },
    row: (u) => `<tr><td>${esc(u.name)}<small>${esc(u.email)}</small></td><td>${esc(u.phone || '—')}</td>
      <td>${badge(u.role, u.role === 'admin' ? 'info' : u.role === 'pharmacist' ? 'warn' : '')}</td><td>${badge(u.status, u.status === 'active' ? 'ok' : 'bad')}</td><td>${fdate(u.created_at)}</td>
      <td class="actions"><button class="btn-sm btn-ghost" data-act="edit" data-id="${u.user_id}">Edit</button>
      ${u.user_id === me.user_id ? '' : `<button class="btn-sm btn-warn" data-act="toggle" data-id="${u.user_id}">${u.status === 'active' ? 'Deactivate' : 'Activate'}</button>
      <button class="btn-sm btn-danger" data-act="del" data-id="${u.user_id}">Delete</button>`}</td></tr>`
  });
  const fields = (edit) => [
    { name: 'name', label: 'Full name', required: true, maxlength: 100, full: true }, { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'role', label: 'Role', type: 'select', options: ROLES },
    { name: 'password', label: edit ? 'New password (leave blank to keep)' : 'Password', type: 'password', required: !edit, autocomplete: 'new-password' }];
  $('#addBtn').addEventListener('click', () => openForm({ title: 'Add user', fields: fields(false), values: { role: 'customer' }, submitLabel: 'Create user',
    onSubmit: async (v) => { await api('/users', { method: 'POST', body: v }); toast('User created'); view.reload(); } }));
  onAction($('#rows'), {
    edit: (id) => { const u = cache.find(x => x.user_id == id); openForm({ title: 'Edit user', fields: fields(true), values: u,
      onSubmit: async (v) => { if (u.user_id === me.user_id) v.role = u.role; await api('/users/' + id, { method: 'PUT', body: v }); toast('User updated'); view.reload(); } }); },
    toggle: async (id) => { const u = cache.find(x => x.user_id == id), next = u.status === 'active' ? 'inactive' : 'active';
      if (next === 'inactive' && !await confirmBox(`Deactivate ${u.name}? They will be signed out and unable to log in.`, 'Deactivate')) return;
      try { await api(`/users/${id}/status`, { method: 'PATCH', body: { status: next } }); toast('User ' + (next === 'active' ? 'activated' : 'deactivated')); view.reload(); } catch (e) { toast(e.message, 'error'); } },
    del: async (id) => { const u = cache.find(x => x.user_id == id);
      if (!await confirmBox(`Permanently delete ${u.name}? This cannot be undone. (Users with orders can only be deactivated.)`, 'Delete')) return;
      try { await api('/users/' + id, { method: 'DELETE' }); toast('User deleted'); view.reload(); } catch (e) { toast(e.message, 'error'); } }
  });
  ['role', 'status'].forEach(i => $('#' + i).addEventListener('change', () => view.load(1)));
  $('#q').addEventListener('input', debounce(() => view.load(1)));
  view.load(1);
})();
