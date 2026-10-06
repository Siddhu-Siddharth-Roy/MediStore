(async () => {
  const user = await currentUser(); layout(user, 'catalog');
  try {
    const cats = (await api('/categories')).data, mf = (await api('/medicines/manufacturers')).data;
    $('#cat').innerHTML += cats.map(c => `<option value="${c.category_id}">${esc(c.category_name)}</option>`).join('');
    $('#mfr').innerHTML += mf.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  } catch { /* filters are optional */ }
  async function load(page = 1) {
    const box = $('#cards'); box.innerHTML = '<p class="muted">Loading…</p>';
    const [sort, dir] = $('#sort').value.split('|');
    try {
      const r = await api('/medicines?' + new URLSearchParams({ page, limit: 12, q: $('#q').value, category_id: $('#cat').value, manufacturer: $('#mfr').value, sort, dir }));
      box.innerHTML = r.data.length ? r.data.map(m => {
        const off = m.mrp > m.selling_price ? Math.round((1 - m.selling_price / m.mrp) * 100) : 0, stock = Number(m.stock_available);
        return `<div class="card med-card"><h3><a href="medicine.html?id=${m.medicine_id}">${esc(m.name)}</a></h3><span class="muted">${esc([m.strength, m.dosage_form].filter(Boolean).join(' · '))}</span>
          <span class="muted">${esc(m.manufacturer || m.brand || '')}</span><div><span class="price">${money(m.selling_price)}</span>${off ? `<span class="mrp">${money(m.mrp)}</span> ${badge(off + '% off', 'ok')}` : ''}</div>
          <div>${m.prescription_required ? badge('Prescription required', 'warn') + ' ' : ''}${stock <= 0 ? badge('Out of stock', 'bad') : stock <= 10 ? badge('Only ' + stock + ' left', 'warn') : badge('In stock', 'ok')}</div>
          <div class="row-actions">${user && user.role === 'customer' && stock > 0 ? `<button data-act="add" data-id="${m.medicine_id}">Add to cart</button>` : `<a class="btn btn-ghost" href="medicine.html?id=${m.medicine_id}">View details</a>`}</div></div>`;
      }).join('') : '<div class="card state">No medicines found. Try a different search or filter.</div>';
      renderPager($('#pager'), r.pagination, load);
    } catch (e) { box.innerHTML = `<div class="card error-text">${esc(errMsg(e))}</div>`; }
  }
  onAction($('#cards'), { add: async (id, b) => { b.disabled = true; await addToCart(id, 1); b.disabled = false; } });
  ['cat', 'mfr', 'sort'].forEach(i => $('#' + i).addEventListener('change', () => load(1)));
  $('#q').addEventListener('input', debounce(() => load(1)));
  load(1);
})();
