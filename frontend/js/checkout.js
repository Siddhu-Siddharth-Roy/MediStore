(async () => {
  const user = await requireUser(['customer']); layout(user, 'cart');
  let cart, me;
  try { [cart, me] = [(await api('/cart')).data, (await api('/users/me')).data]; } catch (e) { return toast(errMsg(e), 'error'); }
  if (!cart.items.length) { location.href = 'cart.html'; return; }
  $('#name').value = me.name; $('#delivery_phone').value = me.phone || '';
  $('#rxBox').hidden = !cart.requires_prescription;
  $('#summary').innerHTML = `<h2>Order summary</h2>${cart.items.map(i => `<div class="sum-row"><span>${esc(i.name)} × ${i.quantity}${i.issue ? ' ' + badge(i.issue, 'bad') : ''}</span><span>${money(i.line_total)}</span></div>`).join('')}
    <div class="sum-row sum-total"><span>Total</span><span>${money(cart.total)}</span></div><p class="muted">Cash on delivery.</p>`;
  if (cart.has_issues) { const p = $('#problem'); p.hidden = false; p.innerHTML = 'Some items are unavailable or exceed stock. <a href="cart.html">Update your cart</a> before placing the order.'; $('#placeBtn').disabled = true; }
  const f = $('#f'), clearErr = () => { document.querySelectorAll('.field-error').forEach(x => x.textContent = ''); $('#msg').textContent = ''; };
  f.addEventListener('input', (ev) => { const t = ev.target.name && $(`[data-err="${ev.target.name}"]`); if (t) t.textContent = ''; }); // clear a field's error as soon as the user edits it
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault(); clearErr();
    const body = { delivery_phone: $('#delivery_phone').value.trim(), delivery_address: $('#delivery_address').value.trim(), notes: $('#notes').value.trim(), prescription_confirmed: $('#rx').checked };
    if (cart.requires_prescription && !body.prescription_confirmed) { $('[data-err=prescription_confirmed]').textContent = 'Please confirm to continue'; return; }
    const btn = $('#placeBtn'); btn.disabled = true; btn.textContent = 'Placing order…';
    try { const r = await api('/orders', { method: 'POST', body }); location.href = `order-details.html?id=${r.data.order_id}&placed=1`; }
    catch (e) {
      btn.disabled = false; btn.textContent = 'Place order';
      if (e.errors) e.errors.forEach(x => { const t = $(`[data-err="${x.field}"]`); if (t) t.textContent = x.message; });
      else { $('#msg').innerHTML = `${esc(e.message)} ${e.status === 409 ? '<a href="cart.html">Review your cart</a>' : ''}`; }
    }
  });
})();
