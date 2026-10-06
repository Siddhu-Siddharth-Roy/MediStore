(async () => {
  const user = await requireUser(['customer']); layout(user, 'cart');
  async function render(cart) {
    cart = cart || (await api('/cart')).data; setCartCount(cart.item_count);
    const box = $('#items'), sum = $('#summary');
    if (!cart.items.length) { box.innerHTML = '<div class="card state">Your cart is empty. <a href="medicines.html">Browse medicines</a></div>'; sum.hidden = true; return; }
    sum.hidden = false;
    box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Medicine</th><th>Price</th><th>Quantity</th><th>Total</th><th><span class="sr-only">Remove</span></th></tr></thead><tbody>${cart.items.map(i => `<tr>
      <td><a href="medicine.html?id=${i.medicine_id}">${esc(i.name)}</a><small>${esc([i.strength, i.dosage_form].filter(Boolean).join(' · '))}</small>
        ${i.prescription_required ? badge('Rx', 'warn') : ''} ${i.issue ? badge(i.issue, 'bad') : ''}</td>
      <td>${money(i.unit_price)}</td>
      <td><div class="stepper" role="group" aria-label="Quantity for ${esc(i.name)}"><button type="button" class="btn-sm btn-ghost" data-act="dec" data-id="${i.medicine_id}" data-q="${i.quantity}" aria-label="Decrease quantity" ${i.quantity <= 1 ? 'disabled' : ''}>−</button>
        <input type="number" min="1" max="${Math.max(i.available, 1)}" value="${i.quantity}" data-qty="${i.medicine_id}" aria-label="Quantity">
        <button type="button" class="btn-sm btn-ghost" data-act="inc" data-id="${i.medicine_id}" data-q="${i.quantity}" aria-label="Increase quantity" ${i.quantity >= i.available ? 'disabled' : ''}>+</button></div></td>
      <td>${money(i.line_total)}</td><td><button class="btn-sm btn-danger" data-act="rm" data-id="${i.medicine_id}" aria-label="Remove ${esc(i.name)}">✕</button></td></tr>`).join('')}</tbody></table></div>
      <p><button class="btn-ghost btn-sm" data-act="clear">Clear cart</button></p>`;
    sum.innerHTML = `<h2>Summary</h2><div class="sum-row"><span>Items</span><span>${cart.item_count}</span></div><div class="sum-row"><span>Subtotal</span><span>${money(cart.subtotal)}</span></div>
      <div class="sum-row sum-total"><span>Total</span><span>${money(cart.total)}</span></div>
      ${cart.has_issues ? '<div class="banner bad" role="alert">Some items are unavailable or exceed stock. Fix them to continue.</div>' : ''}
      ${cart.requires_prescription ? '<p class="muted">Your cart has prescription medicines. You will be asked to confirm at checkout.</p>' : ''}
      <div class="sum-actions"><a class="btn" href="checkout.html" ${cart.has_issues ? 'aria-disabled="true" style="pointer-events:none;opacity:.5"' : ''}>Proceed to checkout</a></div><p class="muted">Final price is confirmed by the store at checkout.</p>`;
  }
  const change = async (id, qty) => { try { await render((await api(`/cart/items/${id}`, { method: 'PUT', body: { quantity: qty } })).data); } catch (e) { toast(errMsg(e), 'error'); render(); } };
  onAction($('#items'), {
    inc: (id, b) => change(id, +b.dataset.q + 1), dec: (id, b) => change(id, +b.dataset.q - 1),
    rm: async (id) => { try { await render((await api('/cart/items/' + id, { method: 'DELETE' })).data); } catch (e) { toast(errMsg(e), 'error'); } },
    clear: async () => { if (await confirmBox('Remove everything from your cart?', 'Clear cart')) await render((await api('/cart', { method: 'DELETE' })).data); }
  });
  $('#items').addEventListener('change', (ev) => { const i = ev.target.closest('input[data-qty]'); if (i) { const q = parseInt(i.value, 10); if (q >= 1) change(i.dataset.qty, q); else render(); } });
  try { await render(); } catch (e) { $('#items').innerHTML = `<div class="card error-text">${esc(errMsg(e))}</div>`; }
})();
