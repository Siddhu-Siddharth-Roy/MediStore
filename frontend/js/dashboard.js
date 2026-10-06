// Customer dashboard (the staff dashboard is js/admin-dashboard.js).
(async () => {
  const user = await requireUser(['customer']); layout(user, 'home');
  $('#hello').textContent = 'Welcome, ' + user.name;
  const recent = $('#recent');
  api('/orders?limit=5').then(r => {
    recent.innerHTML = r.data.length ? r.data.map(o => `<tr><td>#${o.order_id}</td><td>${fdatetime(o.order_date)}</td><td>${money(o.total_amount)}</td><td>${statusBadge(o.order_status)}</td>
      <td><a class="btn btn-sm btn-ghost" href="order-details.html?id=${o.order_id}">View</a></td></tr>`).join('') : '<tr><td class="state" colspan="5">No orders yet. <a href="medicines.html">Browse medicines</a></td></tr>';
  }).catch(e => { recent.innerHTML = `<tr><td class="state error-text" colspan="5">${esc(errMsg(e))}</td></tr>`; });
  api('/orders?status=active&limit=1').then(r => { $('#activeNum').textContent = r.pagination.total; }).catch(() => { $('#activeNum').textContent = '—'; });
})();
