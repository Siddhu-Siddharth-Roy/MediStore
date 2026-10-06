(async () => {
  const user = await requireUser(), staff = user.role !== 'customer'; layout(user, staff ? 'orders' : 'orders');
  if (staff) $('#back').href = 'admin-orders.html';
  const qs = new URLSearchParams(location.search), id = qs.get('id'), box = $('#box');
  const FLOW = ['Pending', 'Confirmed', 'Processing', 'Packed', 'Dispatched', 'Out for Delivery', 'Delivered'];
  async function load() {
    let o;
    try { if (!/^\d+$/.test(id || '')) throw new Error('Order not found'); o = (await api('/orders/' + id)).data; }
    catch (e) { box.innerHTML = `<div class="card"><h1>Order not found</h1><p>${esc(e.message)}</p></div>`; return; }
    const reached = Math.max(...o.history.map(h => FLOW.indexOf(h.status)));
    const tracker = o.order_status === 'Cancelled' ? '<div class="banner bad">This order was cancelled.</div>'
      : `<ol class="tracker" aria-label="Order progress">${FLOW.map((s, i) => `<li class="${i < reached ? 'done' : i === reached ? 'current' : ''}" ${i === reached ? 'aria-current="step"' : ''}>${esc(s)}</li>`).join('')}</ol>`;
    box.innerHTML = `${qs.get('placed') ? '<div class="banner ok" role="status">🎉 Order placed! We will confirm it shortly.</div>' : ''}
      <div class="page-head"><h1>Order #${o.order_id} ${statusBadge(o.order_status)}</h1><div id="actions"></div></div>${tracker}
      <div class="two-col"><section class="card"><h2>Items</h2><div class="table-wrap"><table><thead><tr><th>Medicine</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>${o.items.map(i =>
        `<tr><td>${esc(i.name)}<small>${esc([i.strength, i.dosage_form].filter(Boolean).join(' · '))}</small></td><td>${i.quantity}</td><td>${money(i.unit_price)}</td><td>${money(i.subtotal)}</td></tr>`).join('')}</tbody></table></div>
        <div class="sum-row sum-total"><span>Total</span><span>${money(o.total_amount)}</span></div></section>
      <section class="card"><h2>Delivery</h2><dl class="detail-grid" style="margin-top:0"><div><dt>Placed</dt><dd>${fdatetime(o.order_date)}</dd></div>
        <div><dt>Customer</dt><dd>${esc(o.customer_name)}${staff ? `<small>${esc(o.customer_email)}</small>` : ''}</dd></div><div><dt>Phone</dt><dd>${esc(o.delivery_phone || '—')}</dd></div><div><dt>Payment</dt><dd>Cash on delivery</dd></div>
        <div style="grid-column:1/-1"><dt>Address</dt><dd>${esc(o.delivery_address)}</dd></div>${o.notes ? `<div style="grid-column:1/-1"><dt>Notes</dt><dd>${esc(o.notes)}</dd></div>` : ''}
        ${o.prescription_confirmed ? '<div><dt>Prescription</dt><dd>Customer confirmed</dd></div>' : ''}</dl></section></div>
      ${staff ? `<section class="card" style="margin-top:1rem"><h2>Stock taken from (first-expiry-first-out)</h2>${o.allocations.length ? `<div class="table-wrap"><table><thead><tr><th>Medicine</th><th>Batch</th><th>Expiry</th><th>Qty</th></tr></thead><tbody>${o.allocations.map(a =>
        `<tr><td>${esc(a.name)}</td><td>${esc(a.batch_number)}</td><td>${fdate(a.expiry_date)}</td><td>${a.quantity}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">None.</p>'}</section>` : ''}
      <section class="card" style="margin-top:1rem"><h2>History</h2><ul class="log">${o.history.slice().reverse().map(h =>
        `<li>${statusBadge(h.status)} <span class="muted">${fdatetime(h.created_at)}${staff && h.changed_by_name ? ' · ' + esc(h.changed_by_name) : ''}</span>${h.note ? `<div>${esc(h.note)}</div>` : ''}</li>`).join('')}</ul></section>`;
    const act = $('#actions', box);
    if (staff && o.next_statuses.length) { const b = document.createElement('button'); b.textContent = 'Mark as ' + o.next_statuses[0]; b.addEventListener('click', async () => {
      b.disabled = true; try { await api(`/orders/${o.order_id}/status`, { method: 'PUT', body: { status: o.next_statuses[0] } }); toast('Status updated'); load(); } catch (e) { toast(errMsg(e), 'error'); b.disabled = false; } }); act.append(b, ' '); }
    if (o.can_cancel) { const b = document.createElement('button'); b.className = 'btn-danger'; b.textContent = 'Cancel order'; b.addEventListener('click', () => openForm({
      title: `Cancel order #${o.order_id}`, submitLabel: 'Cancel order', intro: '<p>Cancelling returns the medicines to stock. This cannot be undone.</p>', fields: [{ name: 'reason', label: staff ? 'Reason (shown to customer)' : 'Reason (optional)', full: true, maxlength: 200, required: staff }],
      onSubmit: async (v) => { await (staff ? api(`/orders/${o.order_id}/status`, { method: 'PUT', body: { status: 'Cancelled', note: v.reason } }) : api(`/orders/${o.order_id}/cancel`, { method: 'POST', body: { reason: v.reason || undefined } })); toast('Order cancelled'); load(); } })); act.append(b); }
  }
  load();
})();
