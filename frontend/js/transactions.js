(async () => {
  const user = await requireUser(['admin', 'pharmacist']); layout(user, 'transactions');
  const qs = new URLSearchParams(location.search), scope = {};
  ['batch_id', 'medicine_id'].forEach(k => { if (/^\d+$/.test(qs.get(k) || '')) scope[k] = qs.get(k); });
  if (Object.keys(scope).length) $('#chip').innerHTML = `<span class="chip">Filtered to ${scope.batch_id ? 'batch #' + esc(scope.batch_id) : 'medicine #' + esc(scope.medicine_id)} <a href="admin-transactions.html">clear</a></span>`;
  const cls = { PURCHASE: 'info', SALE: '', RETURN: 'ok', EXPIRED: 'bad', DAMAGED: 'bad', ADJUSTMENT: 'warn' };
  const view = listView({ tbody: $('#rows'), pager: $('#pager'), colspan: 7, empty: 'No stock movements match.',
    fetcher: (page) => api('/inventory/transactions?' + new URLSearchParams({ page, limit: 15, type: $('#type').value, from: $('#from').value, to: $('#to').value, ...scope })),
    row: (t) => `<tr><td>${esc(String(t.transaction_date).slice(0, 16))}</td><td>${esc(t.medicine_name)}<small>${esc(t.strength || '')}</small></td><td>${esc(t.batch_number)}</td>
      <td>${badge(t.transaction_type, cls[t.transaction_type])}</td><td class="${t.quantity > 0 ? 'qty-pos' : 'qty-neg'}">${t.quantity > 0 ? '+' : ''}${t.quantity}</td><td>${t.reference_id ?? '—'}</td><td>${esc(t.remarks || '')}</td></tr>` });
  ['type', 'from', 'to'].forEach(i => $('#' + i).addEventListener('change', () => view.load(1)));
  view.load(1);
})();
