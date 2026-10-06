(async () => {
  const user = await requireUser(['admin', 'pharmacist']); layout(user, 'suppliers');
  let cache = [];
  const view = listView({ tbody: $('#rows'), pager: $('#pager'), colspan: 5, empty: 'No suppliers match your filters.',
    fetcher: async (page) => { const r = await api('/suppliers?' + new URLSearchParams({ page, limit: 10, q: $('#q').value, status: $('#status').value })); cache = r.data; return r; },
    row: (s) => `<tr><td>${esc(s.supplier_name)}<small>${esc(s.company_name || '')}</small></td><td>${esc(s.contact_person || '—')}<small>${esc(s.phone || '')} ${esc(s.email || '')}</small></td>
      <td>${esc(s.gst_number || '—')}</td><td>${badge(s.status, s.status === 'active' ? 'ok' : 'bad')}</td>
      <td class="actions"><button class="btn-sm btn-ghost" data-act="view" data-id="${s.supplier_id}">View</button><button class="btn-sm btn-ghost" data-act="edit" data-id="${s.supplier_id}">Edit</button>
      <button class="btn-sm btn-warn" data-act="toggle" data-id="${s.supplier_id}">${s.status === 'active' ? 'Deactivate' : 'Activate'}</button><button class="btn-sm btn-danger" data-act="del" data-id="${s.supplier_id}">Delete</button></td></tr>` });
  const fields = [{ name: 'supplier_name', label: 'Supplier name', required: true, maxlength: 150 }, { name: 'company_name', label: 'Company name', maxlength: 150 },
    { name: 'contact_person', label: 'Contact person', maxlength: 100 }, { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' },
    { name: 'gst_number', label: 'GST / tax number', maxlength: 30 }, { name: 'address', label: 'Address', type: 'textarea', full: true, maxlength: 1000 }];
  const table = (head, rows) => rows.length ? `<div class="table-wrap"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : '<p class="muted">Nothing recorded yet.</p>';
  $('#addBtn').addEventListener('click', () => openForm({ title: 'Add supplier', fields, onSubmit: async (v) => { await api('/suppliers', { method: 'POST', body: v }); toast('Supplier added'); view.reload(); } }));
  onAction($('#rows'), {
    edit: (id) => { const s = cache.find(x => x.supplier_id == id); openForm({ title: 'Edit supplier', fields, values: s, onSubmit: async (v) => { await api('/suppliers/' + id, { method: 'PUT', body: v }); toast('Supplier updated'); view.reload(); } }); },
    view: async (id) => {
      const s = cache.find(x => x.supplier_id == id);
      const d = openInfo(s.supplier_name, `<dl class="detail-grid"><div><dt>Company</dt><dd>${esc(s.company_name || '—')}</dd></div><div><dt>Contact</dt><dd>${esc(s.contact_person || '—')}</dd></div>
        <div><dt>Phone</dt><dd>${esc(s.phone || '—')}</dd></div><div><dt>Email</dt><dd>${esc(s.email || '—')}</dd></div><div><dt>GST</dt><dd>${esc(s.gst_number || '—')}</dd></div><div><dt>Status</dt><dd>${esc(s.status)}</dd></div>
        <div style="grid-column:1/-1"><dt>Address</dt><dd>${esc(s.address || '—')}</dd></div></dl><h2>Purchase history</h2><div id="ph">Loading…</div><h2 style="margin-top:1rem">Medicines supplied</h2><div id="ms">Loading…</div>`);
      try {
        const [p, m] = await Promise.all([api(`/suppliers/${id}/purchases`), api(`/suppliers/${id}/medicines`)]);
        $('#ph', d).innerHTML = (p.totals ? `<p class="muted"><strong>${p.totals.confirmed_purchases}</strong> confirmed purchase(s) · <strong>${money(p.totals.total_purchased)}</strong> total</p>` : '') + table(['#', 'Date', 'Invoice', 'Items', 'Total', 'Status'], p.data.map(r => `<tr><td><a href="purchase-details.html?id=${r.purchase_id}">#${r.purchase_id}</a></td><td>${fdate(r.purchase_date)}</td><td>${esc(r.invoice_number || '—')}</td><td>${r.item_count}</td><td>${money(r.total_amount)}</td><td>${purchaseBadge(r.status)}</td></tr>`));
        $('#ms', d).innerHTML = table(['Medicine', 'Purchased', 'In stock (their batches)', 'Last supplied'], m.data.map(r => `<tr><td>${esc(r.name)}<small>${esc([r.strength, r.dosage_form].filter(Boolean).join(' · '))}</small></td><td>${r.total_purchased}</td><td>${r.quantity_in_stock}</td><td>${fdate(r.last_supplied)}</td></tr>`));
      } catch (e) { $('#ph', d).textContent = $('#ms', d).textContent = errMsg(e); }
    },
    toggle: async (id) => { const s = cache.find(x => x.supplier_id == id), next = s.status === 'active' ? 'inactive' : 'active';
      if (next === 'inactive' && !await confirmBox(`Deactivate ${s.supplier_name}?`, 'Deactivate')) return;
      try { await api(`/suppliers/${id}/status`, { method: 'PATCH', body: { status: next } }); toast('Supplier ' + (next === 'active' ? 'activated' : 'deactivated')); view.reload(); } catch (e) { toast(e.message, 'error'); } },
    del: async (id) => { const s = cache.find(x => x.supplier_id == id);
      if (!await confirmBox(`Delete ${s.supplier_name}? Suppliers with purchase or stock history cannot be deleted — deactivate them instead.`, 'Delete')) return;
      try { await api('/suppliers/' + id, { method: 'DELETE' }); toast('Supplier deleted'); view.reload(); } catch (e) { toast(e.message, 'error'); } }
  });
  $('#status').addEventListener('change', () => view.load(1));
  $('#q').addEventListener('input', debounce(() => view.load(1)));
  view.load(1);
})();
