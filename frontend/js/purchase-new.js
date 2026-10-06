(async () => {
  const user = await requireUser(['admin', 'pharmacist']); layout(user, 'purchases');
  const editId = new URLSearchParams(location.search).get('id');
  let meds = [], lines = [];
  const blank = () => ({ medicine_id: '', batch_number: '', manufacturing_date: '', expiry_date: '', quantity: '', purchase_price: '', selling_price: '', reorder_level: '10' });
  const medById = (id) => meds.find(m => m.medicine_id == id);

  try {
    const [sups, all] = await Promise.all([fetchAll('/suppliers?status=active'), fetchAll('/medicines?status=active&sort=name')]);
    meds = all; $('#supplier_id').innerHTML = '<option value="">— select supplier —</option>' + sups.map(s => `<option value="${s.supplier_id}">${esc(s.supplier_name)}</option>`).join('');
  } catch (e) { return toast(errMsg(e), 'error'); }

  if (editId) {
    try {
      const p = (await api('/purchases/' + editId)).data;
      if (p.status !== 'Draft') { location.href = 'purchase-details.html?id=' + editId; return; }
      $('#title').textContent = `Edit draft purchase #${p.purchase_id}`;
      if (!$(`#supplier_id option[value="${p.supplier_id}"]`)) $('#supplier_id').innerHTML += `<option value="${p.supplier_id}">${esc(p.supplier_name)} (inactive)</option>`;
      $('#supplier_id').value = p.supplier_id; $('#purchase_date').value = fdate(p.purchase_date); $('#invoice_number').value = p.invoice_number || ''; $('#notes').value = p.notes || '';
      lines = p.items.map(i => ({ medicine_id: String(i.medicine_id), batch_number: i.batch_number || '', manufacturing_date: i.manufacturing_date ? fdate(i.manufacturing_date) : '', expiry_date: fdate(i.expiry_date),
        quantity: String(i.quantity), purchase_price: String(i.purchase_price), selling_price: i.selling_price ? String(i.selling_price) : '', reorder_level: i.reorder_level === null ? '' : String(i.reorder_level) }));
    } catch (e) { return toast(errMsg(e), 'error'); }
  } else { $('#purchase_date').value = new Date().toLocaleDateString('en-CA'); lines = [blank()]; }

  const FIELDS = [['batch_number', 'Batch number *', 'text'], ['manufacturing_date', 'Manufacturing date', 'date'], ['expiry_date', 'Expiry date *', 'date'], ['quantity', 'Quantity *', 'number'],
    ['purchase_price', 'Purchase price (₹) *', 'number'], ['selling_price', 'Selling price (₹)', 'number'], ['reorder_level', 'Reorder level', 'number']];
  const lineTotalPaise = (l) => Math.round(Number(l.purchase_price || 0) * 100) * (parseInt(l.quantity, 10) || 0);

  function totals() {
    const t = lines.reduce((a, l) => a + lineTotalPaise(l), 0), u = lines.reduce((a, l) => a + (parseInt(l.quantity, 10) || 0), 0);
    $('#total').textContent = money(t / 100); $('#units').textContent = `· ${lines.length} line(s), ${u} unit(s)`;
    lines.forEach((l, i) => { const el = $(`[data-lt="${i}"]`); if (el) el.textContent = 'Line total ' + money(lineTotalPaise(l) / 100); });
  }
  function render() {
    $('#lines').innerHTML = lines.map((l, i) => {
      const m = medById(l.medicine_id);
      return `<section class="card line" data-i="${i}"><div class="line-head"><strong>Item ${i + 1}</strong>${lines.length > 1 ? `<button type="button" class="btn-sm btn-danger" data-act="rm" data-i="${i}" aria-label="Remove item ${i + 1}">Remove</button>` : ''}</div>
        <div class="line-grid"><div class="wide"><label for="m${i}">Medicine *</label><select id="m${i}" data-k="medicine_id" data-i="${i}"><option value="">— select medicine —</option>${meds.map(x =>
          `<option value="${x.medicine_id}" ${x.medicine_id == l.medicine_id ? 'selected' : ''}>${esc(x.name)}${x.strength ? ' ' + esc(x.strength) : ''}${x.dosage_form ? ' (' + esc(x.dosage_form) + ')' : ''}</option>`).join('')}</select>
          <div class="hint">${m ? `MRP ${money(m.mrp)} · current price ${money(m.selling_price)} · in stock ${m.stock_available}` : ''}</div><div class="field-error" data-err="items[${i}].medicine_id"></div></div>
        ${FIELDS.map(([k, label, type]) => `<div><label for="${k}${i}">${label}</label><input id="${k}${i}" data-k="${k}" data-i="${i}" type="${type}" value="${esc(l[k])}" ${type === 'number' ? `min="0" step="${k.includes('price') ? '0.01' : '1'}"` : ''} ${k === 'batch_number' ? 'maxlength="50"' : ''}>
          <div class="field-error" data-err="items[${i}].${k}"></div></div>`).join('')}</div><div class="line-total" data-lt="${i}"></div></section>`;
    }).join(''); totals();
  }
  $('#lines').addEventListener('input', (ev) => { const t = ev.target; if (!t.dataset.k) return; lines[t.dataset.i][t.dataset.k] = t.value; const er = $(`[data-err="items[${t.dataset.i}].${t.dataset.k}"]`); if (er) er.textContent = ''; totals(); });
  $('#lines').addEventListener('change', (ev) => { // choosing a medicine pre-fills its selling price and refreshes the hint
    const t = ev.target; if (t.dataset.k !== 'medicine_id') return; const l = lines[t.dataset.i]; l.medicine_id = t.value; const m = medById(t.value);
    if (m && !l.selling_price) l.selling_price = String(m.selling_price); render(); });
  onAction($('#lines'), { rm: (_, b) => { lines.splice(+b.dataset.i, 1); render(); } });
  $('#addLine').addEventListener('click', () => { lines.push(blank()); render(); const last = $('#lines').lastElementChild; if (last) last.querySelector('select').focus(); });

  const clearErr = () => { document.querySelectorAll('.field-error').forEach(x => x.textContent = ''); $('#problem').hidden = true; };
  const payload = (confirm) => ({ supplier_id: $('#supplier_id').value, purchase_date: $('#purchase_date').value || undefined, invoice_number: $('#invoice_number').value.trim() || undefined, notes: $('#notes').value.trim() || undefined, confirm,
    items: lines.map(l => ({ medicine_id: l.medicine_id, batch_number: l.batch_number.trim(), manufacturing_date: l.manufacturing_date || undefined, expiry_date: l.expiry_date, quantity: l.quantity, purchase_price: l.purchase_price, selling_price: l.selling_price || undefined, reorder_level: l.reorder_level || undefined })) });
  async function save(confirm) {
    clearErr(); const btns = [$('#draftBtn'), $('#confirmBtn')]; btns.forEach(b => b.disabled = true);
    try {
      const r = await api(editId ? '/purchases/' + editId : '/purchases', { method: editId ? 'PUT' : 'POST', body: payload(confirm) });
      toast(r.message); location.href = 'purchase-details.html?id=' + r.data.purchase_id;
    } catch (e) {
      const p = $('#problem'); p.hidden = false; p.textContent = e.message; p.scrollIntoView({ block: 'nearest' });
      (e.errors || []).forEach(x => { const t = $(`[data-err="${x.field}"]`); if (t) t.textContent = x.message.replace(/^Line \d+: /, ''); });
    } finally { btns.forEach(b => b.disabled = false); }
  }
  $('#draftBtn').addEventListener('click', () => save(false));
  $('#f').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const sup = $('#supplier_id').selectedOptions[0].textContent, t = $('#total').textContent;
    if (await confirmBox(`Confirm this purchase from ${sup} for ${t}? Stock will be added to inventory immediately.`, 'Confirm & add stock', false)) save(true);
  });
  render();
})();
