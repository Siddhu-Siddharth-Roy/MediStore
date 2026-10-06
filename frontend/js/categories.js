(async () => {
  const user = await requireUser(['admin', 'pharmacist']); layout(user, 'categories');
  let cache = [];
  const view = listView({ tbody: $('#rows'), colspan: 4, empty: 'No categories yet. Add the first one.',
    fetcher: async () => { const r = await api('/categories'); cache = r.data; return r; },
    row: (c) => `<tr><td>${esc(c.category_name)}</td><td>${esc(c.description || '—')}</td><td>${c.medicine_count}</td>
      <td class="actions"><button class="btn-sm btn-ghost" data-act="edit" data-id="${c.category_id}">Edit</button><button class="btn-sm btn-danger" data-act="del" data-id="${c.category_id}">Delete</button></td></tr>` });
  const fields = [{ name: 'category_name', label: 'Category name', required: true, maxlength: 100, full: true }, { name: 'description', label: 'Description', type: 'textarea', full: true, maxlength: 1000 }];
  $('#addBtn').addEventListener('click', () => openForm({ title: 'Add category', fields, onSubmit: async (v) => { await api('/categories', { method: 'POST', body: v }); toast('Category added'); view.reload(); } }));
  onAction($('#rows'), {
    edit: (id) => { const c = cache.find(x => x.category_id == id); openForm({ title: 'Edit category', fields, values: c, onSubmit: async (v) => { await api('/categories/' + id, { method: 'PUT', body: v }); toast('Category updated'); view.reload(); } }); },
    del: async (id) => { const c = cache.find(x => x.category_id == id);
      if (!await confirmBox(`Delete "${c.category_name}"? ${c.medicine_count} medicine(s) will become uncategorised.`, 'Delete')) return;
      try { await api('/categories/' + id, { method: 'DELETE' }); toast('Category deleted'); view.reload(); } catch (e) { toast(e.message, 'error'); } }
  });
  view.load();
})();
