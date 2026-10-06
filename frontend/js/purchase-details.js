(async () => {
  const user = await requireUser(['admin', 'pharmacist']); layout(user, 'purchases');
  const id = new URLSearchParams(location.search).get('id'), box = $('#box');
  async function load() {
    let p;
    try { if (!/^\d+$/.test(id || '')) throw new Error('Purchase not found'); p = (await api('/purchases/' + id)).data; }
    catch (e) { box.innerHTML = `<div class="card"><h1>Purchase not found</h1><p>${esc(e.message)}</p></div>`; return; }
    box.innerHTML = `<div class="page-head"><h1>Purchase #${p.purchase_id} ${purchaseBadge(p.status)}</h1><div id="actions"></div></div>
      ${p.status === 'Draft' ? '<div class="banner warn">This is a draft. No stock has been added yet. Confirm it when the goods have arrived.</div>' : ''}
      ${p.status === 'Cancelled' ? '<div class="banner bad">This purchase was cancelled.</div>' : ''}
      <section class="card"><dl class="detail-grid" style="margin:0"><div><dt>Supplier</dt><dd>${esc(p.supplier_name)}<small>${esc(p.company_name || '')}</small></dd></div><div><dt>Purchase date</dt><dd>${fdate(p.purchase_date)}</dd></div>
        <div><dt>Invoice no.</dt><dd>${esc(p.invoice_number || '—')}</dd></div><div><dt>Created by</dt><dd>${esc(p.created_by_name || '—')}</dd></div>
        ${p.confirmed_at ? `<div><dt>Confirmed</dt><dd>${fdatetime(p.confirmed_at)}<small>${esc(p.confirmed_by_name || '')}</small></dd></div>` : ''}
        ${p.notes ? `<div style="grid-column:1/-1"><dt>Notes</dt><dd>${esc(p.notes)}</dd></div>` : ''}</dl></section>
      <section class="card" style="margin-top:1rem"><h2>Items</h2><div class="table-wrap"><table><thead><tr><th>Medicine</th><th>Batch</th><th>Mfg</th><th>Expiry</th><th>Qty</th><th>Cost</th><th>Selling</th><th>Subtotal</th><th></th></tr></thead><tbody>${p.items.map(i =>
        `<tr><td>${esc(i.medicine_name)}<small>${esc([i.strength, i.dosage_form].filter(Boolean).join(' · '))}</small></td><td>${esc(i.batch_number || '—')}</td><td>${fdate(i.manufacturing_date)}</td><td>${fdate(i.expiry_date)}</td><td>${i.quantity}</td>
         <td>${money(i.purchase_price)}</td><td>${i.selling_price ? money(i.selling_price) : '—'}</td><td>${money(i.subtotal)}</td><td>${i.batch_id && p.status !== 'Draft' ? `<a class="btn btn-sm btn-ghost" href="admin-transactions.html?batch_id=${i.batch_id}">Movements</a>` : ''}</td></tr>`).join('')}</tbody></table></div>
        <div class="sum-row sum-total"><span>Total (${p.units} units)</span><span>${money(p.total_amount)}</span></div></section>`;
    const act = $('#actions', box), add = (el) => act.append(el, ' ');
    const btn = (text, cls, fn) => { const b = document.createElement('button'); b.textContent = text; if (cls) b.className = cls; b.addEventListener('click', async () => { b.disabled = true; try { await fn(); } finally { b.disabled = false; } }); return b; };
    if (p.status === 'Draft') {
      const e = document.createElement('a'); e.className = 'btn btn-ghost'; e.href = 'purchase-new.html?id=' + p.purchase_id; e.textContent = 'Edit'; add(e);
      add(btn('Confirm & add stock', '', async () => { if (!await confirmBox(`Confirm purchase #${p.purchase_id} (${money(p.total_amount)})? ${p.units} unit(s) will be added to stock immediately.`, 'Confirm & add stock', false)) return;
        try { const r = await api(`/purchases/${p.purchase_id}/confirm`, { method: 'POST' }); toast(r.message); load(); } catch (er) { toast(errMsg(er), 'error'); } }));
      add(btn('Discard draft', 'btn-danger', async () => { if (!await confirmBox('Discard this draft? It will be marked as cancelled.', 'Discard')) return;
        try { await api(`/purchases/${p.purchase_id}/cancel`, { method: 'POST', body: {} }); toast('Draft discarded'); load(); } catch (er) { toast(errMsg(er), 'error'); } }));
    } else if (p.status === 'Confirmed' && user.role === 'admin') {
      add(btn('Cancel purchase', 'btn-danger', async () => openForm({ title: `Cancel purchase #${p.purchase_id}`, submitLabel: 'Cancel purchase & reverse stock',
        intro: '<p>This removes the purchased units from stock again. It only works if none of them have been sold or adjusted.</p>', fields: [{ name: 'reason', label: 'Reason', required: true, full: true, maxlength: 200 }],
        onSubmit: async (v) => { await api(`/purchases/${p.purchase_id}/cancel`, { method: 'POST', body: v }); toast('Purchase cancelled'); load(); } })));
    }
  }
  load();
})();
