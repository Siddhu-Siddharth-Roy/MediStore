(async () => {
  const user = await requireUser(['customer']); layout(user, 'orders');
  let status = '';
  const view = listView({ tbody: $('#rows'), pager: $('#pager'), colspan: 6, empty: 'No orders here yet.',
    fetcher: (page) => api('/orders?' + new URLSearchParams({ page, limit: 10, status })),
    row: (o) => `<tr><td>#${o.order_id}</td><td>${fdatetime(o.order_date)}</td><td>${o.item_count}</td><td>${money(o.total_amount)}</td><td>${statusBadge(o.order_status)}</td>
      <td><a class="btn btn-sm btn-ghost" href="order-details.html?id=${o.order_id}">View</a></td></tr>` });
  document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => { status = b.dataset.s; document.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); view.load(1); }));
  view.load(1);
})();
