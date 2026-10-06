(async () => {
  const user = await requireUser(['admin', 'pharmacist']); layout(user, 'medicines');
  let cache = [], cats = [];
  const fillSelect = (sel, items, first) => { sel.innerHTML = `<option value="">${first}</option>` + items.map(i => `<option value="${esc(i[0])}">${esc(i[1])}</option>`).join(''); };
  try {
    cats = (await api('/categories')).data; fillSelect($('#cat'), cats.map(c => [c.category_id, c.category_name]), 'All categories');
    const m = (await api('/medicines/manufacturers')).data; fillSelect($('#mfr'), m.map(x => [x, x]), 'All manufacturers');
  } catch (e) { toast(errMsg(e), 'error'); }
  const stockBadge = (m) => Number(m.stock_available) === 0 ? badge('Out of stock', 'bad') : badge(m.stock_available + ' in stock', 'ok');
  const view = listView({ tbody: $('#rows'), pager: $('#pager'), colspan: 9, empty: 'No medicines match your filters.',
    fetcher: async (page) => { const [sort, dir] = $('#sort').value.split('|');
      const r = await api('/medicines?' + new URLSearchParams({ page, limit: 10, q: $('#q').value, category_id: $('#cat').value, manufacturer: $('#mfr').value, status: $('#status').value, sort, dir })); cache = r.data; return r; },
    row: (m) => `<tr><td>${esc(m.name)}<small>${esc([m.generic_name, m.strength, m.dosage_form].filter(Boolean).join(' · '))}</small></td><td>${esc(m.category_name || '—')}</td><td>${esc(m.manufacturer || '—')}</td>
      <td>${money(m.mrp)}</td><td>${money(m.selling_price)}</td><td>${m.prescription_required ? badge('Rx', 'warn') : '—'}</td><td>${stockBadge(m)}</td><td>${badge(m.status, m.status === 'active' ? 'ok' : 'bad')}</td>
      <td class="actions"><button class="btn-sm btn-ghost" data-act="view" data-id="${m.medicine_id}">View</button><button class="btn-sm btn-ghost" data-act="edit" data-id="${m.medicine_id}">Edit</button>
      ${m.status === 'active' ? `<button class="btn-sm btn-danger" data-act="del" data-id="${m.medicine_id}">Deactivate</button>` : ''}</td></tr>` });
  const fields = () => [
    { name: 'name', label: 'Medicine name', required: true, maxlength: 150, full: true }, { name: 'generic_name', label: 'Generic name', maxlength: 150 }, { name: 'brand', label: 'Brand', maxlength: 100 },
    { name: 'category_id', label: 'Category', type: 'select', options: [['', '— none —'], ...cats.map(c => [c.category_id, c.category_name])] }, { name: 'manufacturer', label: 'Manufacturer', maxlength: 150 },
    { name: 'dosage_form', label: 'Dosage form (Tablet, Syrup…)', maxlength: 50 }, { name: 'strength', label: 'Strength (500mg…)', maxlength: 50 },
    { name: 'mrp', label: 'MRP (₹)', type: 'number', step: '0.01', min: 0, required: true }, { name: 'selling_price', label: 'Selling price (₹)', type: 'number', step: '0.01', min: 0, required: true },
    { name: 'status', label: 'Status', type: 'select', options: [['active', 'Active'], ['inactive', 'Inactive']] }, { name: 'prescription_required', label: 'Prescription required', type: 'checkbox' },
    { name: 'description', label: 'Description', type: 'textarea', full: true }];
  $('#addBtn').addEventListener('click', () => openForm({ title: 'Add medicine', fields: fields(), values: { status: 'active' }, onSubmit: async (v) => { await api('/medicines', { method: 'POST', body: v }); toast('Medicine added'); view.reload(); } }));
  onAction($('#rows'), {
    edit: (id) => { const m = cache.find(x => x.medicine_id == id); openForm({ title: 'Edit medicine', fields: fields(), values: m, onSubmit: async (v) => { await api('/medicines/' + id, { method: 'PUT', body: v }); toast('Medicine updated'); view.reload(); } }); },
    view: async (id) => {
      try {
        const m = (await api('/medicines/' + id)).data, st = { EXPIRED: 'bad', 'EXPIRING SOON': 'warn', VALID: 'ok' };
        openInfo(m.name, `<dl class="detail-grid"><div><dt>Generic</dt><dd>${esc(m.generic_name || '—')}</dd></div><div><dt>Brand</dt><dd>${esc(m.brand || '—')}</dd></div><div><dt>Category</dt><dd>${esc(m.category_name || '—')}</dd></div>
          <div><dt>Manufacturer</dt><dd>${esc(m.manufacturer || '—')}</dd></div><div><dt>Form / strength</dt><dd>${esc([m.dosage_form, m.strength].filter(Boolean).join(' · ') || '—')}</dd></div>
          <div><dt>MRP / Price</dt><dd>${money(m.mrp)} / ${money(m.selling_price)}</dd></div><div><dt>Prescription</dt><dd>${m.prescription_required ? 'Required' : 'Not required'}</dd></div><div><dt>Sellable stock</dt><dd>${m.stock_available}</dd></div></dl>
          <p>${esc(m.description || '')}</p><h2>Batches</h2>` + (m.batches.length ? `<div class="table-wrap"><table><thead><tr><th>Batch</th><th>Expiry</th><th>Qty</th><th>Reorder at</th><th>Status</th></tr></thead><tbody>${m.batches.map(b =>
          `<tr><td>${esc(b.batch_number)}</td><td>${fdate(b.expiry_date)}</td><td>${b.quantity}</td><td>${b.reorder_level}</td><td>${badge(b.expiry_status, st[b.expiry_status])}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No batches yet. Stock is added via purchases/inventory (Phases 3 & 5).</p>'));
      } catch (e) { toast(errMsg(e), 'error'); }
    },
    del: async (id) => { const m = cache.find(x => x.medicine_id == id);
      if (!await confirmBox(`Deactivate "${m.name}"? It will be hidden from customers; history and stock records are kept.`, 'Deactivate')) return;
      try { await api('/medicines/' + id, { method: 'DELETE' }); toast('Medicine deactivated'); view.reload(); } catch (e) { toast(e.message, 'error'); } }
  });
  ['cat', 'mfr', 'status', 'sort'].forEach(i => $('#' + i).addEventListener('change', () => view.load(1)));
  $('#q').addEventListener('input', debounce(() => view.load(1)));
  view.load(1);
})();
