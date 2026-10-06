(async () => {
  const user = await requireUser(['admin', 'pharmacist']); layout(user, 'dashboard');
  $('#hello').textContent = 'Welcome, ' + user.name;
  const row = (cells, cols) => `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
  const empty = (cols, msg) => `<tr><td class="state" colspan="${cols}">${esc(msg)}</td></tr>`;
  let period = 'daily';

  function cards(c) {
    const t = (label, num, href, cls = '', sub = '') => `<a class="card tile ${cls}" href="${href}"><div class="num">${num}</div><div class="lbl">${esc(label)}</div>${sub ? `<small>${esc(sub)}</small>` : ''}</a>`;
    $('#cards').innerHTML = t('Total medicines', c.total_medicines, 'admin-medicines.html', '', `${c.active_medicines} active`) + t('Total customers', c.total_customers, user.role === 'admin' ? 'admin-users.html' : 'admin-orders.html')
      + t('Total orders', c.total_orders, 'admin-orders.html') + t("Today's sales", money(c.todays_sales), 'admin-orders.html', '', `${c.todays_orders} order(s)`)
      + t('Pending orders', c.pending_orders, 'admin-orders.html?status=Pending', c.pending_orders ? 'warn' : '') + t('Low-stock medicines', c.low_stock, 'admin-inventory.html', c.low_stock ? 'warn' : '', c.out_of_stock ? `${c.out_of_stock} out of stock` : '')
      + t('Expiring ≤ 30 days', c.expiring_soon, 'admin-expiry.html', c.expiring_soon ? 'warn' : '') + t('Expired batches', c.expired, 'admin-expiry.html', c.expired ? 'bad' : '', 'with stock on hand')
      + t('Active suppliers', c.total_suppliers, 'admin-suppliers.html') + t('Draft purchases', c.draft_purchases, 'admin-purchases.html?status=Draft', c.draft_purchases ? 'warn' : '');
  }
  function summaries(d) {
    const s = d.sales, i = d.inventory, line = (k, v) => `<dt>${esc(k)}</dt><dd>${v}</dd>`;
    $('#salesSummary').innerHTML = line('Today', `${money(s.today.amount)} · ${s.today.orders} orders`) + line('Last 7 days', `${money(s.last_7_days.amount)} · ${s.last_7_days.orders} orders`)
      + line('This month', `${money(s.this_month.amount)} · ${s.this_month.orders} orders`) + line('Average order (this month)', money(s.this_month.average_order)) + line('All time', `${money(s.all_time.amount)} · ${s.all_time.orders} orders`);
    $('#invSummary').innerHTML = line('Sellable units', i.sellable_units) + line('Stock value (at cost)', money(i.stock_value)) + line('Expiring within 30 / 60 / 90 days', `${i.expiring_30} / ${i.expiring_60} / ${i.expiring_90} batches`)
      + line('Expired units on hand', `${i.expired_units} (${money(i.expired_value)})`);
  }
  function lists(d) {
    $('#recentOrders').innerHTML = d.recent_orders.length ? d.recent_orders.map(o => row([`<a href="order-details.html?id=${o.order_id}">#${o.order_id}</a>`, esc(o.customer_name), money(o.total_amount), statusBadge(o.order_status)])).join('') : empty(4, 'No orders yet.');
    $('#recentPurchases').innerHTML = d.recent_purchases.length ? d.recent_purchases.map(p => row([`<a href="purchase-details.html?id=${p.purchase_id}">#${p.purchase_id}</a>`, esc(p.supplier_name), money(p.total_amount), purchaseBadge(p.status)])).join('') : empty(4, 'No purchases yet.');
    $('#lowStock').innerHTML = d.low_stock_list.length ? d.low_stock_list.map(m => row([esc(m.name + (m.strength ? ' ' + m.strength : '')), m.sellable, m.stock_status === 'OUT_OF_STOCK' ? badge('Out', 'bad') : badge('Low', 'warn')])).join('') : empty(3, 'Nothing is running low. 🎉');
    $('#expiring').innerHTML = d.expiring_list.length ? d.expiring_list.map(b => row([esc(b.name) + `<small>batch ${esc(b.batch_number)}</small>`, fdate(b.expiry_date) + `<small>${b.expiry_status === 'EXPIRED' ? badge('Expired', 'bad') : esc(daysText(b.days_to_expiry))}</small>`, b.quantity])).join('') : empty(3, 'No batches expiring in 30 days.');
  }
  const daysText = (d) => d < 0 ? `${-d} days ago` : d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`;

  async function salesChart() {
    const r = (await api(`/dashboard/sales?period=${period}`)).data, monthly = period === 'monthly';
    const labels = r.series.map(p => monthly ? monthName(p.period) : shortDate(p.period)), none = r.total_orders === 0;
    drawChart($('#salesChart'), { type: monthly ? 'bar' : 'line', data: { labels, datasets: [
      { label: 'Revenue (₹)', data: r.series.map(p => Number(p.revenue)), borderColor: '#0d9488', backgroundColor: monthly ? '#0d9488' : 'rgba(13,148,136,.15)', fill: !monthly, tension: .25, pointRadius: monthly ? 0 : 2, pointHoverRadius: 5 }] },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => money(c.parsed.y), afterLabel: (c) => `${r.series[c.dataIndex].orders} order(s)` } } },
        scales: { y: { beginAtZero: true, ticks: { callback: (v) => '₹' + Number(v).toLocaleString('en-IN') } }, x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: monthly ? 12 : 8 } } } } },
      `${monthly ? 'Monthly' : 'Daily'} revenue chart. Total ${money(r.total_revenue)} from ${r.total_orders} orders.`, none, `No sales in the last ${monthly ? r.span + ' months' : r.span + ' days'} yet.`);
    $('#topPeriod').textContent = monthly ? `last ${r.span} months` : `last ${r.span} days`;
    const top = r.top_medicines;
    drawChart($('#topChart'), { type: 'bar', data: { labels: top.map(t => t.name + (t.strength ? ' ' + t.strength : '')), datasets: [{ label: 'Units sold', data: top.map(t => t.units), backgroundColor: CHART_COLORS }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: (c) => 'Revenue ' + money(top[c.dataIndex].revenue) } } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } } },
      'Top selling medicines by units: ' + top.map(t => `${t.name} ${t.units}`).join(', '), top.length === 0, 'No sales in this period yet.');
  }
  async function inventoryCharts() {
    const d = (await api('/dashboard/inventory')).data;
    drawChart($('#catChart'), { type: 'doughnut', data: { labels: d.categories.map(c => c.name), datasets: [{ data: d.categories.map(c => c.count), backgroundColor: CHART_COLORS, borderWidth: 1 }] }, options: { plugins: { legend: { position: 'right' } } } },
      'Active medicines by category: ' + d.categories.map(c => `${c.name} ${c.count}`).join(', '), d.categories.length === 0, 'No medicines yet.');
    const total = d.batch_status.reduce((a, x) => a + x.count, 0);
    drawChart($('#statusChart'), { type: 'doughnut', data: { labels: d.batch_status.map(s => s.name), datasets: [{ data: d.batch_status.map(s => s.count), backgroundColor: d.batch_status.map(s => STATUS_COLORS[s.name]), borderWidth: 1 }] }, options: { plugins: { legend: { position: 'right' } } } },
      'Batches by status: ' + d.batch_status.map(s => `${s.name} ${s.count}`).join(', '), total === 0, 'No stock batches yet.');
  }
  async function notifs() {
    try {
      const r = await api('/notifications?limit=5');
      $('#recentNotifs').innerHTML = r.data.length ? r.data.map(n => { const l = notifLink(n); return `<li class="${n.is_read ? '' : 'unread'}"><${l ? `a href="${esc(l)}"` : 'div'}><span aria-hidden="true">${NOTIF_ICON[n.type] || '🔔'}</span><span><strong>${esc(n.title)}</strong><br><span class="muted">${esc(String(n.created_at).slice(0, 16))}</span></span></${l ? 'a' : 'div'}></li>`; }).join('') : '<li class="state" style="padding:1rem;text-align:center">No notifications yet.</li>';
    } catch (e) { $('#recentNotifs').innerHTML = `<li class="error-text" style="padding:1rem">${esc(errMsg(e))}</li>`; }
  }
  async function loadAll() {
    $('#error').hidden = true;
    try { const d = (await api('/dashboard/summary')).data; cards(d.cards); summaries(d); lists(d); } catch (e) { const b = $('#error'); b.hidden = false; b.textContent = 'Could not load the dashboard: ' + errMsg(e); }
    await Promise.allSettled([salesChart(), inventoryCharts(), notifs()]);
  }
  document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => { period = b.dataset.p; document.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); salesChart(); }));
  $('#refresh').addEventListener('click', loadAll);
  loadAll();
})();
