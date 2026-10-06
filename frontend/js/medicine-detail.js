(async () => {
  const user = await currentUser(); layout(user, 'catalog');
  const box = $('#detail'), id = new URLSearchParams(location.search).get('id');
  try {
    if (!/^\d+$/.test(id || '')) throw new Error('Medicine not found');
    const m = (await api('/medicines/' + id)).data, stock = Number(m.stock_available);
    document.title = m.name + ' – MediStore';
    box.innerHTML = `<h1>${esc(m.name)}</h1><p class="muted">${esc([m.generic_name, m.brand].filter(Boolean).join(' · '))}</p>
      <div><span class="price">${money(m.selling_price)}</span>${m.mrp > m.selling_price ? `<span class="mrp">${money(m.mrp)}</span>` : ''}</div>
      <p>${m.prescription_required ? badge('Prescription required', 'warn') + ' ' : ''}${stock <= 0 ? badge('Out of stock', 'bad') : stock <= 10 ? badge('Only ' + stock + ' left', 'warn') : badge('In stock', 'ok')}</p>
      <dl class="detail-grid"><div><dt>Category</dt><dd>${esc(m.category_name || '—')}</dd></div><div><dt>Manufacturer</dt><dd>${esc(m.manufacturer || '—')}</dd></div>
      <div><dt>Dosage form</dt><dd>${esc(m.dosage_form || '—')}</dd></div><div><dt>Strength</dt><dd>${esc(m.strength || '—')}</dd></div></dl>
      <h2>About this medicine</h2><p>${esc(m.description || 'No description available.')}</p>
      <div id="buy"></div>`;
    const buy = $('#buy');
    if (!user) buy.innerHTML = '<p class="muted"><a href="login.html">Log in</a> or <a href="register.html">register</a> to order this medicine.</p>';
    else if (user.role !== 'customer') buy.innerHTML = '<p class="muted">Staff accounts cannot place orders. Manage this medicine from the admin pages.</p>';
    else if (stock > 0) {
      buy.innerHTML = `<div style="display:flex;gap:.75rem;align-items:end;flex-wrap:wrap"><div><label for="qty">Quantity</label><input id="qty" type="number" min="1" max="${stock}" value="1" style="width:90px"></div>
        <button id="addBtn">Add to cart</button><a class="btn btn-ghost" href="cart.html">View cart</a></div><div class="field-error" id="qtyErr"></div>`;
      $('#addBtn').addEventListener('click', async () => {
        const q = parseInt($('#qty').value, 10); $('#qtyErr').textContent = '';
        if (!(q >= 1)) { $('#qtyErr').textContent = 'Enter a quantity of at least 1'; return; }
        if (q > stock) { $('#qtyErr').textContent = `Only ${stock} available`; return; }
        $('#addBtn').disabled = true; await addToCart(m.medicine_id, q); $('#addBtn').disabled = false;
      });
    }
  } catch (e) { box.innerHTML = `<h1>Not found</h1><p>${esc(e.message)}</p><a href="medicines.html">Browse medicines</a>`; }
})();
