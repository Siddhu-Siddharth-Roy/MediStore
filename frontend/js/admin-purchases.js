(async () => {
  const user = await requireUser(['admin', 'pharmacist']); layout(user, 'purchases');
  try { const sups = await fetchAll('/suppliers'); $('#supplier').innerHTML += sups.map(s => `<option value="${s.supplier_id}">${esc(s.supplier_name)}</option>`).join(''); } catch (e) { toast(errMsg(e), 'error'); }
  const qs = new URLSearchParams(location.search); if (qs.get('status')) $('#status').value = qs.get('status'); if (qs.get('supplier_id')) $('#supplier').value = qs.get('supplier_id');
  const view = listView({ tbody: $('#rows'), pager: $('#pager'), colspan: 8, empty: 'No purchases match. Click “New purchase” to record one.',
    fetcher: (page) => api('/purchases?' + new URLSearchParams({ page, limit: 10, q: $('#q').value, supplier_id: $('#supplier').value, status: $('#status').value, from: $('#from').value, to: $('#to').value })),
    row: (p) => `<tr><td>#${p.purchase_id}</td><td>${fdate(p.purchase_date)}</td><td>${esc(p.supplier_name)}</td><td>${esc(p.invoice_number || '—')}</td><td>${p.item_count} line(s)<small>${p.units} units</small></td>
      <td>${money(p.total_amount)}</td><td>${purchaseBadge(p.status)}</td><td><a class="btn btn-sm btn-ghost" href="purchase-details.html?id=${p.purchase_id}">${p.status === 'Draft' ? 'Open' : 'View'}</a></td></tr>` });
  ['supplier', 'status', 'from', 'to'].forEach(i => $('#' + i).addEventListener('change', () => view.load(1)));
  $('#q').addEventListener('input', debounce(() => view.load(1)));
  view.load(1);
})();
