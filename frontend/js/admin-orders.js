(async () => {
  const user = await requireUser(['admin', 'pharmacist']); layout(user, 'orders');
  const NEXT = { Pending: 'Confirmed', Confirmed: 'Processing', Processing: 'Packed', Packed: 'Dispatched', Dispatched: 'Out for Delivery', 'Out for Delivery': 'Delivered' };
  const view = listView({ tbody: $('#rows'), pager: $('#pager'), colspan: 7, empty: 'No orders match your filters.',
    fetcher: (page) => api('/orders?' + new URLSearchParams({ page, limit: 10, q: $('#q').value, status: $('#status').value, from: $('#from').value, to: $('#to').value })),
    row: (o) => `<tr><td>#${o.order_id}</td><td>${fdatetime(o.order_date)}</td><td>${esc(o.customer_name)}</td><td>${o.item_count}</td><td>${money(o.total_amount)}</td><td>${statusBadge(o.order_status)}</td>
      <td class="actions"><a class="btn btn-sm btn-ghost" href="order-details.html?id=${o.order_id}">View</a>${NEXT[o.order_status] ? `<button class="btn-sm" data-act="next" data-id="${o.order_id}" data-to="${NEXT[o.order_status]}">→ ${esc(NEXT[o.order_status])}</button>` : ''}</td></tr>` });
  onAction($('#rows'), { next: async (id, b) => { b.disabled = true; try { await api(`/orders/${id}/status`, { method: 'PUT', body: { status: b.dataset.to } }); toast(`Order #${id} → ${b.dataset.to}`); view.reload(); } catch (e) { toast(errMsg(e), 'error'); b.disabled = false; } } });
  ['status', 'from', 'to'].forEach(i => $('#' + i).addEventListener('change', () => view.load(1)));
  $('#q').addEventListener('input', debounce(() => view.load(1)));
  const pre = new URLSearchParams(location.search).get('status'); if (pre) $('#status').value = pre;
  view.load(1);
})();
